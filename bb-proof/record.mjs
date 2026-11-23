// bb-proof/record.mjs — drive the Room screen through frame transitions and
// record one video per pet. Usage:
//   node record.mjs [momo,kiki,hana,boba] [tag]
// Serves ../dist on :8901, seeds localStorage (all pets owned, Adult stage,
// meters 95), then drives: idle 4.5s -> Meal -> Pet -> Drink -> Meal -> idle.
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
const PORT = 8901;
const PETS = (process.argv[2] || 'momo,kiki,hana,boba').split(',');
const TAG = process.argv[3] || 'before';
const ALL_PETS = ['momo', 'kiki', 'boba', 'yuki', 'taro', 'purin', 'sora', 'miso', 'hana', 'nori'];
const NAMES = { momo: 'Momo', kiki: 'Kiki', hana: 'Hana', boba: 'Boba', yuki: 'Yuki', taro: 'Taro', purin: 'Purin', sora: 'Sora', miso: 'Miso', nori: 'Nori' };

function startServer() {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', DIST], {
    stdio: 'ignore',
  });
  return srv;
}

async function waitServer(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not come up');
}

async function seed(page, petId) {
  const ok = await page.evaluate(
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
  return ok;
}

const server = startServer();
const errors = [];
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const petId of PETS) {
    const videoDir = fs.mkdtempSync('/tmp/bb-video-');
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
    // Seed + reload so the store rehydrates with this pet active.
    const seeded = await seed(page, petId);
    if (!seeded) throw new Error(`${petId}: no stored save to seed`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
    await page.waitForFunction(
      (name) => document.querySelector('[data-testid="pet-name"]')?.textContent === name,
      NAMES[petId],
      { timeout: 10000 },
    );
    await page.waitForTimeout(500); // let the first frame paint

    // Drive transitions. Idle first (blink cycle: base 3850ms + blink 150ms).
    await page.waitForTimeout(4500);
    await page.getByTestId('btn-meal').click(); // eat 1400ms — chew cycle
    await page.waitForTimeout(1700);
    await page.getByTestId('btn-pet').click(); // celebrate 900ms — panel -> happy
    await page.waitForTimeout(1200);
    await page.getByTestId('btn-drink').click(); // drink 1600ms — drink -> base
    await page.waitForTimeout(1900);
    await page.getByTestId('btn-meal').click(); // eat again
    await page.waitForTimeout(1700);
    await page.waitForTimeout(1500); // back to idle
    await page.close();
    await context.close();
    const files = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length !== 1) throw new Error(`${petId}: expected 1 video, got ${files.length}`);
    fs.copyFileSync(path.join(videoDir, files[0]), path.join(OUT, `blink-${TAG}-${petId}.webm`));
    fs.rmSync(videoDir, { recursive: true, force: true });
    console.log(`recorded blink-${TAG}-${petId}.webm`);
  }
  await browser.close();
} finally {
  server.kill();
}
if (errors.length) {
  console.error('JS ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — no JS errors');
