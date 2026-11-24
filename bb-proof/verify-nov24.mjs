// bb-proof/verify-nov24.mjs — verification for the Nov 24 changes:
//   1. Cozy Hearth music (bundle + playback)
//   2. Bath animation (Momo + Kiki mid-bath screenshots)
//   3. Kiki legs fix (timed screenshots across the pet/celebrate window)
//   4. Smooth animation upgrade: crossfades + wander (videos, all 10 pets)
//   5. All 4 tabs render, 0 JS errors (390x900 @2x)
// Usage: node verify-nov24.mjs [momo,kiki,...]
// Output: proof/animations/smooth-<pet>.webm, bath-<pet>.png (momo,kiki),
//   kiki-pet-frame-<n>.png, momo-pet-frame-<n>.png, tabs-<tab>.png,
//   smooth-meta.json (pet-stage boxes for the wander analysis).
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
const PORT = 8904;
const PETS = (process.argv[2] || 'momo,kiki,boba,yuki,taro,purin,sora,miso,hana,nori').split(',');
const ALL_PETS = ['momo', 'kiki', 'boba', 'yuki', 'taro', 'purin', 'sora', 'miso', 'hana', 'nori'];
const NAMES = { momo: 'Momo', kiki: 'Kiki', hana: 'Hana', boba: 'Boba', yuki: 'Yuki', taro: 'Taro', purin: 'Purin', sora: 'Sora', miso: 'Miso', nori: 'Nori' };

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

async function seed(page, petId) {
  return page.evaluate(
    ([petId, allPets]) => {
      const raw = localStorage.getItem('bobaBuddiesMobile');
      if (!raw) return false;
      const data = JSON.parse(raw);
      const save = data.state.save;
      const now = Date.now();
      save.ownedPets = allPets;
      save.activePet = petId;
      for (const p of Object.values(save.pets)) {
        p.bornAt = now - 5 * 86400000; // Adult stage
        p.meters = { hunger: 95, thirst: 95, energy: 95, happiness: 95, cleanliness: 95, health: 95 };
        p.lightsOut = false;
        p.lastSeen = now;
        p.lastInteract = now;
      }
      localStorage.setItem('bobaBuddiesMobile', JSON.stringify(data));
      return true;
    },
    [petId, ALL_PETS],
  );
}

fs.mkdirSync(OUT, { recursive: true });
const server = startServer();
const errors = [];
const meta = {};
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  // -- Music playback check (hashed Cozy Hearth asset from dist) ---------
  const audioFiles = fs.readdirSync(path.join(DIST, 'assets', 'assets', 'audio'))
    .filter((f) => f.startsWith('music-'));
  console.log('music assets in dist:', audioFiles.join(', '));
  if (!audioFiles.some((f) => f.startsWith('music-cozy-hearth'))) {
    throw new Error('music-cozy-hearth.wav missing from dist');
  }
  if (audioFiles.some((f) => f.startsWith('music-morning-meadow'))) {
    throw new Error('music-morning-meadow.wav still in dist');
  }
  const musicUrl = `http://127.0.0.1:${PORT}/assets/assets/audio/${audioFiles.find((f) => f.startsWith('music-cozy-hearth'))}`;
  const musicCtx = await browser.newContext();
  const musicPage = await musicCtx.newPage();
  const music = await musicPage.evaluate(async (url) => {
    const a = new Audio(url);
    a.loop = true;
    await a.play();
    const t0 = a.currentTime;
    await new Promise((r) => setTimeout(r, 1500));
    const t1 = a.currentTime;
    return { duration: a.duration, t0, t1, advanced: t1 - t0 };
  }, musicUrl);
  console.log('music playback:', JSON.stringify(music));
  if (!(music.advanced > 1.0 && Math.abs(music.duration - 24.0) < 0.5)) {
    throw new Error('Cozy Hearth loop did not play cleanly: ' + JSON.stringify(music));
  }
  await musicCtx.close();

  // -- Per-pet videos + timed screenshots ---------------------------------
  for (const petId of PETS) {
    const videoDir = fs.mkdtempSync('/tmp/bb-smooth-');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${petId} pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${petId} console: ${m.text()}`);
    });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
    if (!(await seed(page, petId))) throw new Error(`${petId}: no stored save to seed`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
    await page.waitForFunction(
      (name) => document.querySelector('[data-testid="pet-name"]')?.textContent === name,
      NAMES[petId],
      { timeout: 10000 },
    );
    const box = await page.getByTestId('pet-stage').boundingBox();
    meta[petId] = { stageBox: box };
    await page.waitForTimeout(500);

    // Idle 6s — wander starts 1.2–3s in (drift, pause, turn).
    await page.waitForTimeout(6000);
    // Meal — chew cycle, now 100 ms steps + crossfades.
    await page.getByTestId('btn-meal').click();
    await page.waitForTimeout(1700);
    // Bath — scrub cycle + bubbles (screenshot mid-bath for momo/kiki).
    await page.getByTestId('btn-bath').click();
    await page.waitForTimeout(900);
    if (petId === 'momo' || petId === 'kiki') {
      await page.screenshot({ path: path.join(OUT, `bath-${petId}.png`) });
      console.log(`shot bath-${petId}.png`);
    }
    await page.waitForTimeout(1200);
    // Pet — celebrate 3-frame cycle; timed shots across the 900 ms window.
    await page.getByTestId('btn-pet').click();
    if (petId === 'momo' || petId === 'kiki') {
      const marks = [150, 350, 550, 750];
      for (let i = 0; i < marks.length; i++) {
        await page.waitForTimeout(i === 0 ? marks[0] : marks[i] - marks[i - 1]);
        await page.screenshot({ path: path.join(OUT, `${petId}-pet-frame-${i + 1}.png`) });
      }
      await page.waitForTimeout(1200 - 750);
    } else {
      await page.waitForTimeout(1200);
    }
    // Drink, then meal again, then idle.
    await page.getByTestId('btn-drink').click();
    await page.waitForTimeout(1900);
    await page.getByTestId('btn-meal').click();
    await page.waitForTimeout(1700);
    await page.waitForTimeout(1500);
    await page.close();
    await context.close();
    const files = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length !== 1) throw new Error(`${petId}: expected 1 video, got ${files.length}`);
    fs.copyFileSync(path.join(videoDir, files[0]), path.join(OUT, `smooth-${petId}.webm`));
    fs.rmSync(videoDir, { recursive: true, force: true });
    console.log(`recorded smooth-${petId}.webm`);
  }

  // -- All 4 tabs render, 390x900 @2x, 0 JS errors ------------------------
  const tabCtx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
  const tabPage = await tabCtx.newPage();
  tabPage.on('pageerror', (e) => errors.push(`tabs pageerror: ${e.message}`));
  tabPage.on('console', (m) => {
    if (m.type() === 'error') errors.push(`tabs console: ${m.text()}`);
  });
  await tabPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await tabPage.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
  if (!(await seed(tabPage, 'momo'))) throw new Error('tabs: no stored save to seed');
  await tabPage.reload({ waitUntil: 'load' });
  await tabPage.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
  await tabPage.waitForTimeout(1500);
  await tabPage.screenshot({ path: path.join(OUT, 'tabs-room.png') });
  await tabPage.getByText('Play', { exact: true }).click();
  await tabPage.waitForSelector('[data-testid="game-star"]', { timeout: 10000 });
  await tabPage.waitForTimeout(800);
  await tabPage.screenshot({ path: path.join(OUT, 'tabs-play.png') });
  await tabPage.getByText('Shop', { exact: true }).click();
  await tabPage.waitForSelector('[data-testid^="shop-item-"]', { timeout: 10000 });
  await tabPage.waitForTimeout(800);
  await tabPage.screenshot({ path: path.join(OUT, 'tabs-shop.png') });
  await tabPage.getByText('Pals', { exact: true }).click();
  await tabPage.waitForSelector('[data-testid="pal-momo"]', { timeout: 10000 });
  await tabPage.waitForTimeout(1200);
  await tabPage.screenshot({ path: path.join(OUT, 'tabs-pals.png') });
  console.log('shot tabs-room/play/shop/pals.png');
  await tabCtx.close();

  fs.writeFileSync(path.join(OUT, 'smooth-meta.json'), JSON.stringify(meta, null, 2));
  await browser.close();
} finally {
  server.kill();
}
if (errors.length) {
  console.error('JS ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — no JS errors');
