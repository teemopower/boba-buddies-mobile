// bb-proof/wander-check.mjs — focused wander proof for specific pets.
// Seeds the pet, then idles 14 s (no actions) so the wander cycle has
// time for 2-3 drift/pause/turn rounds, and records video.
// Usage: node wander-check.mjs taro,sora
// Output: proof/animations/wander-check-<pet>.webm (+ stage box in meta).
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
const PETS = (process.argv[2] || 'taro,sora').split(',');
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

const server = startServer();
const errors = [];
const metaPath = path.join(OUT, 'smooth-meta.json');
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const petId of PETS) {
    const videoDir = fs.mkdtempSync('/tmp/bb-wander-check-');
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
    const seeded = await page.evaluate(
      ([petId, allPets]) => {
        const raw = localStorage.getItem('bobaBuddiesMobile');
        if (!raw) return false;
        const data = JSON.parse(raw);
        const save = data.state.save;
        const now = Date.now();
        save.ownedPets = allPets;
        save.activePet = petId;
        for (const p of Object.values(save.pets)) {
          p.bornAt = now - 5 * 86400000;
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
    if (!seeded) throw new Error(`${petId}: no stored save to seed`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
    await page.waitForFunction(
      (name) => document.querySelector('[data-testid="pet-name"]')?.textContent === name,
      NAMES[petId],
      { timeout: 10000 },
    );
    meta[petId] = { stageBox: await page.getByTestId('pet-stage').boundingBox() };
    await page.waitForTimeout(14000); // idle 14 s — 2-3 wander rounds
    await page.close();
    await context.close();
    const files = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length !== 1) throw new Error(`${petId}: expected 1 video, got ${files.length}`);
    fs.copyFileSync(path.join(videoDir, files[0]), path.join(OUT, `wander-check-${petId}.webm`));
    fs.rmSync(videoDir, { recursive: true, force: true });
    console.log(`recorded wander-check-${petId}.webm`);
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  await browser.close();
} finally {
  server.kill();
}
if (errors.length) {
  console.error('JS ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — no JS errors');
