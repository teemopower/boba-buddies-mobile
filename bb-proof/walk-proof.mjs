// bb-proof/walk-proof.mjs — proof for the Nov 24 walk rework (build #5 feedback).
// Records Momo walking in four moods on the Room screen, idle, no actions:
//   momo-happy  (80 s idle — cadence: expect 2-3 walks, 15-30 s apart)
//   momo-sad    (45 s idle — sad walk)
//   momo-grumpy (45 s idle — grumpy stomp walk)
//   momo-tired  (45 s idle — hungry = tired trudge walk)
// Output: proof/animations/walk-proof-<case>.webm (+ phase timings, JS errors).
// Analysis + stills: bb-proof/analyze-walk-proof.py
// Serves ../dist on :8906. Run AFTER a fresh web export.
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
const PORT = 8906;
const ALL_PETS = ['momo', 'kiki', 'boba', 'yuki', 'taro', 'purin', 'sora', 'miso', 'hana', 'nori'];
const CASES = [
  { name: 'momo-happy', mood: 'happy', idleMs: 80000 },
  { name: 'momo-sad', mood: 'sad', idleMs: 45000 },
  { name: 'momo-grumpy', mood: 'grumpy', idleMs: 45000 },
  { name: 'momo-tired', mood: 'tired', idleMs: 45000 },
];

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

async function seed(page, mood) {
  return page.evaluate(
    ([allPets, mood]) => {
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
        p.tantrumUntil = 0;
        p.excitedUntil = 0;
        p.pottyPending = false;
      }
      const active = save.pets.momo;
      // Mood seeds (ppDeriveMood order: sick > grumpy > potty > sad > hungry...).
      if (mood === 'sad') active.meters.happiness = 0; // any meter at 0 -> sad
      if (mood === 'grumpy') active.tantrumUntil = now + 600000;
      if (mood === 'tired') active.meters.hunger = 20; // hunger < 30 -> hungry (tired walk)
      localStorage.setItem('bobaBuddiesMobile', JSON.stringify(data));
      return true;
    },
    [ALL_PETS, mood],
  );
}

const server = startServer();
const errors = [];
const timings = {};
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const c of CASES) {
    const videoT0 = Date.now(); // video starts when the context is created
    const videoDir = fs.mkdtempSync('/tmp/bb-walk-proof-');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${c.name} pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${c.name} console: ${m.text()}`);
    });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
    if (!(await seed(page, c.mood))) throw new Error(`${c.name}: no stored save to seed`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="pet-name"]')?.textContent === 'Momo',
      { timeout: 10000 },
    );
    await page.waitForTimeout(800); // let all 12 layers load
    const t0 = Date.now();
    timings[`${c.name}:idle-start`] = 0;
    timings[`${c.name}:idle-start-offset-ms`] = t0 - videoT0; // video time when idle begins
    await page.waitForTimeout(c.idleMs); // idle — wander only, no actions
    timings[`${c.name}:end`] = Date.now() - t0;
    // Sanity: confirm the derived mood label shown on screen.
    const moodLabel = await page.evaluate(
      () => document.querySelector('[data-testid="mood-chip"]')?.textContent ?? '(no mood testid)',
    );
    timings[`${c.name}:mood-label`] = moodLabel;
    await page.close();
    await context.close();
    const files = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length !== 1) throw new Error(`${c.name}: expected 1 video, got ${files.length}`);
    fs.copyFileSync(path.join(videoDir, files[0]), path.join(OUT, `walk-proof-${c.name}.webm`));
    fs.rmSync(videoDir, { recursive: true, force: true });
    console.log(`recorded walk-proof-${c.name}.webm (${c.idleMs / 1000}s idle, mood label: ${moodLabel})`);
  }
  await browser.close();
} finally {
  server.kill();
}
fs.writeFileSync(path.join(OUT, 'walk-proof-timings.json'), JSON.stringify(timings, null, 1));
console.log('PHASE TIMINGS (ms after t0):\n' + JSON.stringify(timings, null, 1));
if (errors.length) {
  console.error('JS ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — no JS errors');
