// bb-proof/motion-check.mjs — prove the Nov 24 animation overhaul has no
// blinking DURING MOTION (not just static states): drive Bath, Pet, and
// idle wander per pet, record one video + stills, and log phase timings
// so the Python analysis can attribute any visibility dip to its phase.
// Usage: node motion-check.mjs [momo,kiki,...]
// Saves proof/animations/motion-<pet>-{bath,pet}.png and
// motion-after-<pet>.webm. The walk still is extracted from the video by
// motion-walk.py (picks the frame with max horizontal centroid shift
// during the idle/wander window).
// Serves ../dist on :8903.
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
const PORT = 8903;
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

const server = startServer();
const errors = [];
const timings = {};
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const petId of PETS) {
    const videoDir = fs.mkdtempSync('/tmp/bb-motion-');
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
    await page.waitForTimeout(800); // let all 11 layers load
    const t0 = Date.now();
    const mark = (label) => { timings[`${petId}:${label}`] = Date.now() - t0; };

    // Bath (1800ms action): tub + sponge cycle, scrub wiggle, bubbles.
    await page.getByTestId('btn-bath').click();
    mark('bath-start');
    await page.waitForTimeout(900); // mid-action
    await page.screenshot({ path: path.join(OUT, `motion-${petId}-bath.png`) });
    await page.waitForTimeout(1500); // action ends ~1800ms after click

    // Pet (1200ms action): nuzzle panel, gentle lean.
    await page.getByTestId('btn-pet').click();
    mark('pet-start');
    await page.waitForTimeout(600); // mid-action
    await page.screenshot({ path: path.join(OUT, `motion-${petId}-pet.png`) });
    await page.waitForTimeout(1200);

    // Idle wander: first drift starts after a 1.2–3s pause, drift takes
    // 1.2–2.5s, then a 1.5–4s pause before the next. 13s covers 2+ drifts.
    mark('idle-start');
    await page.waitForTimeout(13000);
    mark('end');

    await page.close();
    await context.close();
    const files = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length !== 1) throw new Error(`${petId}: expected 1 video, got ${files.length}`);
    fs.copyFileSync(path.join(videoDir, files[0]), path.join(OUT, `motion-after-${petId}.webm`));
    fs.rmSync(videoDir, { recursive: true, force: true });
    console.log(`recorded motion-after-${petId}.webm`);
  }
  await browser.close();
} finally {
  server.kill();
}
console.log('PHASE TIMINGS (ms after t0):\n' + JSON.stringify(timings, null, 1));
if (errors.length) {
  console.error('JS ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — no JS errors');
