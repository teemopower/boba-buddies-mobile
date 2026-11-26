// bb-proof/verify-audio.mjs — smoke test for the Nov 25 audio fix:
//   - SFX players are release()d (not just remove()d) so native players
//     don't leak on Android.
//   - setMusicMode skips replace() when the mode's source is unchanged
//     (all modes share the Cozy Hearth loop) and mode switches are
//     serialized.
//   - A playbackStatusUpdate listener + 3s watchdog + AppState resume
//     restart music if it ever stops while it should be playing.
// Web can't prove the Android native leak is gone, but it proves the
// service initializes, tab switches (which drive setMusicMode) and
// SFX taps run without JS errors, and no audio asset fails to load.
// Usage: node verify-audio.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CHROME = '/home/hatch/chrome/linux-158.0.8127.36/chrome-linux64/chrome';
const PORT = 8906;

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--directory', DIST], { stdio: 'ignore' });
}

async function waitServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not come up');
}

const server = startServer();
let browser = null;
const consoleErrors = [];
const consoleAudioWarns = [];
const pageErrors = [];
const failedRequests = [];
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Record every HTMLAudioElement play/pause so the background test can
  // tell the music loop (loop=true, Cozy Hearth file) from one-shot SFX.
  await page.addInitScript(() => {
    window.__audioCalls = [];
    const origPlay = HTMLAudioElement.prototype.play;
    const origPause = HTMLAudioElement.prototype.pause;
    HTMLAudioElement.prototype.play = function (...args) {
      window.__audioCalls.push({ action: 'play', loop: this.loop, src: this.currentSrc || this.src || '', t: Date.now() });
      return origPlay.apply(this, args);
    };
    HTMLAudioElement.prototype.pause = function (...args) {
      window.__audioCalls.push({ action: 'pause', loop: this.loop, src: this.currentSrc || this.src || '', t: Date.now() });
      return origPause.apply(this, args);
    };
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    if (text.includes('[audio]')) consoleAudioWarns.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) => failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('audio')) failedRequests.push(`${res.url()} :: HTTP ${res.status()}`);
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000); // let the app mount + audio init

  const roomVisible = await page.evaluate(() => document.body.innerText.includes('Room') || document.body.innerText.length > 200);
  console.log('APP_MOUNTED:', roomVisible);

  // Drive the exact paths from the bug report: tab switches (each fires
  // setMusicMode) and lots of taps (each fires a fresh SFX player).
  async function clickTab(label) {
    const el = page.locator(`text=${label}`).last();
    if (await el.count()) {
      await el.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
    return false;
  }
  for (const tab of ['Play', 'Shop', 'Pals', 'Room', 'Play', 'Room']) {
    await clickTab(tab);
    await page.waitForTimeout(1200);
  }
  console.log('TAB_SWITCHES_DONE');

  // Hammer taps: 30 rapid button presses to exercise SFX create/play/release.
  const body = await page.locator('body');
  for (let i = 0; i < 30; i++) {
    await body.click({ position: { x: 195, y: 400 } }).catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(4000); // let SFX lifetimes + watchdog ticks run

  // Background test (Nov 25 bug #2 — music kept playing after Home):
  // hide the document (React Native Web's AppState maps this to
  // 'background'), expect the loop to pause and NOT restart while
  // hidden, then show it again and expect the loop to resume.
  const musicCalls = () => page.evaluate(() => (window.__audioCalls || []).filter((c) => c.loop || c.src.includes('cozy')));
  const callsBeforeHide = await musicCalls();
  console.log('MUSIC_CALLS_BEFORE_HIDE:', JSON.stringify(callsBeforeHide));
  const hideAt = Date.now();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1500);
  const callsWhileHidden = (await musicCalls()).filter((c) => c.t >= hideAt);
  console.log('MUSIC_CALLS_WHILE_HIDDEN:', JSON.stringify(callsWhileHidden));
  const pausedOnHide = callsWhileHidden.some((c) => c.action === 'pause');
  const restartedWhileHidden = callsWhileHidden.some((c) => c.action === 'play');
  const showAt = Date.now();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(3000); // resumeAudio is async; watchdog is 3s
  const callsAfterShow = (await musicCalls()).filter((c) => c.t >= showAt);
  console.log('MUSIC_CALLS_AFTER_SHOW:', JSON.stringify(callsAfterShow));
  const resumedOnShow = callsAfterShow.some((c) => c.action === 'play');
  console.log('BACKGROUND_TEST:', JSON.stringify({ musicWasPlaying: callsBeforeHide.some((c) => c.action === 'play'), pausedOnHide, restartedWhileHidden, resumedOnShow }));

  console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2));
  console.log('AUDIO_WARNINGS:', JSON.stringify(consoleAudioWarns, null, 2));
  console.log('PAGE_ERRORS:', JSON.stringify(pageErrors, null, 2));
  console.log('FAILED_AUDIO_REQUESTS:', JSON.stringify(failedRequests, null, 2));

  const ok = roomVisible && pageErrors.length === 0 && consoleErrors.length === 0 && failedRequests.length === 0
    && callsBeforeHide.some((c) => c.action === 'play') && pausedOnHide && !restartedWhileHidden && resumedOnShow;
  console.log(ok ? 'SMOKE_TEST: PASS' : 'SMOKE_TEST: FAIL');
  process.exitCode = ok ? 0 : 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
