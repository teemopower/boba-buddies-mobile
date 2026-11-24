// bb-proof/listing-shots.mjs — Play store listing screenshots (1080x1920).
// Serves ../dist on :8903, seeds localStorage (all pets owned, Momo active
// Adult, meters 95), then screenshots Room / Play / Shop / Pals at
// 540x960 @2x = exactly 1080x1920.
// Usage: node listing-shots.mjs
// Output: ../play-listing/screenshot-{room,play,shop,pals}.png
//
// Note on the Pals shot: on the web build RevenueCat has no native module,
// so the Pals tab shows a "Payments not set up yet" notice that never
// appears on Android (where RevenueCat is configured). The shot scrolls
// the roster grid into view so the notice is off-frame; the grid itself
// (all 10 pets, Owned state) is the real UI as it appears on device.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'play-listing');
const CHROME = '/home/hatch/chrome/linux-158.0.8127.36/chrome-linux64/chrome';
const PORT = 8903;
const ALL_PETS = ['momo', 'kiki', 'boba', 'yuki', 'taro', 'purin', 'sora', 'miso', 'hana', 'nori'];

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
  return page.evaluate(([allPets]) => {
    const raw = localStorage.getItem('bobaBuddiesMobile');
    if (!raw) return false;
    const data = JSON.parse(raw);
    const save = data.state.save;
    const now = Date.now();
    save.ownedPets = allPets;
    save.activePet = 'momo';
    for (const p of Object.values(save.pets)) {
      p.bornAt = now - 5 * 86400000; // Adult stage
      p.meters = { hunger: 95, thirst: 95, energy: 95, happiness: 95, cleanliness: 95, health: 95 };
      p.lightsOut = false;
      p.lastSeen = now;
      p.lastInteract = now;
    }
    localStorage.setItem('bobaBuddiesMobile', JSON.stringify(data));
    return true;
  }, [ALL_PETS]);
}

fs.mkdirSync(OUT, { recursive: true });
const server = startServer();
const errors = [];
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
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
  await page.waitForFunction(
    () => document.querySelector('[data-testid="pet-name"]')?.textContent === 'Momo',
    { timeout: 10000 },
  );
  await page.waitForTimeout(1500); // let all pet layers paint
  await page.screenshot({ path: path.join(OUT, 'screenshot-room.png') });
  console.log('shot screenshot-room.png');

  await page.getByText('Play', { exact: true }).click();
  await page.waitForSelector('[data-testid="game-star"]', { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'screenshot-play.png') });
  console.log('shot screenshot-play.png');

  await page.getByText('Shop', { exact: true }).click();
  await page.waitForSelector('[data-testid^="shop-item-"]', { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'screenshot-shop.png') });
  console.log('shot screenshot-shop.png');

  await page.getByText('Pals', { exact: true }).click();
  await page.waitForSelector('[data-testid="pal-momo"]', { timeout: 10000 });
  await page.waitForTimeout(1200); // let all 10 pet images load
  // Scroll the roster grid into view so the web-only "payments not set
  // up yet" notice (never shown on Android) is off-frame.
  await page.evaluate(() => {
    document.querySelector('[data-testid="pal-momo"]')?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'screenshot-pals.png') });
  console.log('shot screenshot-pals.png');

  await browser.close();
} finally {
  server.kill();
}
if (errors.length) {
  console.error('JS ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — no JS errors');
