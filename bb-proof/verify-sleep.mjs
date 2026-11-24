// bb-proof/verify-sleep.mjs — verification for the Nov 24 sleep fix:
//   Sleeping now restores energy via the 5s live tick (+2/5s, +4 blanket),
//   ported from the extension popup.js live tick.
// Seeds Momo at energy 20, puts her to sleep, and watches the meter rise.
// Usage: node verify-sleep.mjs
// Output: proof/animations/sleep-energy-before.png, sleep-energy-after.png
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'proof', 'animations');
const CHROME = '/home/hatch/chrome/linux-158.0.8127.36/chrome-linux64/chrome';
const PORT = 8905;

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--directory', DIST], { stdio: 'ignore' });
}

async function waitServer(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not come up');
}

async function seed(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bobaBuddiesMobile');
    if (!raw) return false;
    const data = JSON.parse(raw);
    const save = data.state.save;
    const now = Date.now();
    save.ownedPets = ['momo', 'kiki', 'boba', 'yuki', 'taro', 'purin', 'sora', 'miso', 'hana', 'nori'];
    save.activePet = 'momo';
    for (const p of Object.values(save.pets)) {
      p.bornAt = now - 5 * 86400000; // Adult stage
      p.meters = { hunger: 95, thirst: 95, energy: 95, happiness: 95, cleanliness: 95, health: 95 };
      p.lightsOut = false;
      p.lastSeen = now;
      p.lastInteract = now;
    }
    save.pets.momo.meters.energy = 20; // low energy so recovery is visible
    localStorage.setItem('bobaBuddiesMobile', JSON.stringify(data));
    return true;
  });
}

/** Read the numeric Energy meter value from the Room screen. */
async function readEnergy(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('div')];
    const label = els.find((el) => el.textContent === '⚡ Energy');
    if (!label || !label.parentElement) return null;
    const val = [...label.parentElement.querySelectorAll('div')]
      .map((d) => d.textContent.trim())
      .find((t) => /^\d+$/.test(t));
    return val ? parseInt(val, 10) : null;
  });
}

async function readMood(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="mood-chip"]');
    return el ? el.textContent : null;
  });
}

fs.mkdirSync(OUT, { recursive: true });
const server = startServer();
const errors = [];
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
  if (!(await seed(page))) throw new Error('no stored save to seed');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
  await page.waitForTimeout(1000);

  const before = await readEnergy(page);
  console.log('energy before sleep:', before);
  if (before !== 20) throw new Error(`expected seeded energy 20, got ${before}`);

  await page.click('[data-testid="btn-sleep"]');
  await page.waitForTimeout(500);
  const mood = await readMood(page);
  console.log('mood after Sleep tap:', mood);
  if (!mood || !/sleeping/i.test(mood)) throw new Error(`expected Sleeping mood, got ${mood}`);
  await page.screenshot({ path: path.join(OUT, 'sleep-energy-before.png') });

  // Sample the meter every 5s for ~35s: expect +2 per tick (20 -> ~34).
  const samples = [before];
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(5000);
    samples.push(await readEnergy(page));
  }
  console.log('energy samples (every 5s while asleep):', samples.join(' -> '));
  const after = samples[samples.length - 1];
  await page.screenshot({ path: path.join(OUT, 'sleep-energy-after.png') });
  if (!(after >= 32)) throw new Error(`energy did not rise enough while asleep: 20 -> ${after} (expected >= 32)`);
  if (errors.length > 0) throw new Error('JS errors: ' + errors.join(' | '));
  console.log(`PASS sleep recovery: energy 20 -> ${after} in ~35s asleep, 0 JS errors`);
  await browser.close();
} finally {
  server.kill();
}
