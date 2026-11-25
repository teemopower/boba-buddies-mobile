// bb-proof/pet-stills.mjs — capture the nuzzle (petting) panel mid-action.
// The pet sequence is [petting 500ms, base 300ms] looping, so a shot at
// +250ms after the Pet tap lands inside the petting panel. (The
// motion-check stills at +600ms land in the base window — see
// motion-<pet>-pet.png — so this script exists to prove the nuzzle
// itself renders in-app.)
// Usage: node pet-stills.mjs [momo,kiki,...]
// Saves proof/animations/pet-<pet>-nuzzle.png. Serves ../dist on :8904.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
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
    await page.waitForTimeout(800);
    await page.getByTestId('btn-pet').click();
    await page.waitForTimeout(250); // inside the 500ms petting panel
    await page.screenshot({ path: path.join(OUT, `pet-${petId}-nuzzle.png`) });
    await page.close();
    await context.close();
    console.log(`captured pet-${petId}-nuzzle.png`);
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
