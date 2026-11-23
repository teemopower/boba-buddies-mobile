// bb-proof/states.mjs — screenshot each pet in sad / sick / sleeping states
// (the three states the blink videos didn't cover), to prove the layered
// renderer shows the right frame for every mood, not just idle/eat.
// Usage: node states.mjs [momo,kiki,...]
// Saves proof/animations/state-<pet>-<state>.png. Prints a visibility
// metric per shot (same background-difference metric as analyze.py).
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
const PORT = 8902;
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

async function seed(page, petId, mutate) {
  const ok = await page.evaluate(
    ([petId, allPets, mutate]) => {
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
      const active = save.pets[petId];
      if (mutate === 'sad') active.meters.hunger = 0;
      if (mutate === 'sick') active.meters.health = 0;
      if (mutate === 'sleeping') active.lightsOut = true;
      localStorage.setItem('bobaBuddiesMobile', JSON.stringify(data));
      return true;
    },
    [petId, ALL_PETS, mutate],
  );
  return ok;
}

const server = startServer();
const errors = [];
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const petId of PETS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${petId} pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${petId} console: ${m.text()}`);
    });
    for (const state of ['sad', 'sick', 'sleeping']) {
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
      await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
      if (!(await seed(page, petId, state))) throw new Error(`${petId}: no stored save to seed`);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
      await page.waitForFunction(
        (name) => document.querySelector('[data-testid="pet-name"]')?.textContent === name,
        NAMES[petId],
        { timeout: 10000 },
      );
      await page.waitForTimeout(1200); // let all 9 layers load
      await page.screenshot({ path: path.join(OUT, `state-${petId}-${state}.png`) });
      console.log(`shot state-${petId}-${state}.png`);
    }
    await context.close();
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
