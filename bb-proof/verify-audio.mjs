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

  console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2));
  console.log('AUDIO_WARNINGS:', JSON.stringify(consoleAudioWarns, null, 2));
  console.log('PAGE_ERRORS:', JSON.stringify(pageErrors, null, 2));
  console.log('FAILED_AUDIO_REQUESTS:', JSON.stringify(failedRequests, null, 2));

  const ok = roomVisible && pageErrors.length === 0 && consoleErrors.length === 0 && failedRequests.length === 0;
  console.log(ok ? 'SMOKE_TEST: PASS' : 'SMOKE_TEST: FAIL');
  process.exitCode = ok ? 0 : 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
