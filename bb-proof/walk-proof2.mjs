// bb-proof/walk-proof2.mjs — proof for the Nov 25 walk fix, round 2.
// Records Momo + Kiki walking in happy / sad / grumpy moods on the Room
// screen, idle, no actions. Generalised from walk-proof.mjs (pet param).
//   momo-happy  (60 s idle — expect ~2 walks, 15-30 s apart)
//   momo-sad    (45 s idle — slow sad walk)
//   momo-grumpy (45 s idle — grumpy stomp walk)
//   kiki-happy  (60 s idle)
//   kiki-sad    (45 s idle)
// Output: proof/animations/walk2-<case>.webm (+ timings, JS errors).
// Analysis: bb-proof/analyze-walk2.py (FULL 25 fps — the round-1 proof
// sampled at 1 fps and missed the flicker; never do that again).
// Serves ../dist on :8907. Run AFTER a fresh web export.
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
const PORT = 8907;
const ALL_PETS = ['momo', 'kiki', 'boba', 'yuki', 'taro', 'purin', 'sora', 'miso', 'hana', 'nori'];
const NAMES = { momo: 'Momo', kiki: 'Kiki', boba: 'Boba', purin: 'Purin' };
const CASES = [
  { name: 'momo-happy', pet: 'momo', mood: 'happy', idleMs: 60000 },
  { name: 'momo-sad', pet: 'momo', mood: 'sad', idleMs: 45000 },
  { name: 'momo-grumpy', pet: 'momo', mood: 'grumpy', idleMs: 45000 },
  { name: 'kiki-happy', pet: 'kiki', mood: 'happy', idleMs: 60000 },
  { name: 'kiki-sad', pet: 'kiki', mood: 'sad', idleMs: 45000 },
  // Art-fix verification (round 2): tired walk (hungry mood) + sad walks
  // for the redrawn B panels.
  { name: 'kiki-tired', pet: 'kiki', mood: 'hungry', idleMs: 45000 },
  { name: 'boba-sad', pet: 'boba', mood: 'sad', idleMs: 45000 },
  { name: 'purin-sad', pet: 'purin', mood: 'sad', idleMs: 45000 },
  // Final verification (Nov 25): redrawn/translated pairs not covered above.
  { name: 'boba-happy', pet: 'boba', mood: 'happy', idleMs: 60000 },
  { name: 'purin-grumpy', pet: 'purin', mood: 'grumpy', idleMs: 45000 },
];

/** Wall-clock walk log: Playwright video runs ~10-16% slow (frame
 *  duplication), so video-time gaps overstate the wander pause. The
 *  poller below samples the pet's translateX from the DOM every 200 ms
 *  with Date.now() — the cadence the user actually experiences. */
async function startWalkLogger(page) {
  await page.evaluate(() => {
    window.__walkLog = [];
    window.__walkT0 = Date.now();
    const el = document.querySelector('[data-testid="pet-stage"] > div:first-child');
    window.__walkTimer = setInterval(() => {
      if (!el) return;
      let tx = 0;
      const t = getComputedStyle(el).transform;
      if (t && t !== 'none') {
        const m = t.match(/matrix\(([^)]+)\)/);
        if (m) tx = parseFloat(m[1].split(',')[4]);
      }
      window.__walkLog.push([Date.now() - window.__walkT0, tx]);
    }, 200);
  });
}

async function stopWalkLogger(page) {
  return page.evaluate(() => {
    clearInterval(window.__walkTimer);
    return window.__walkLog || [];
  });
}

/** Walk intervals from wall-clock [ms, tx] samples: sustained
 *  |dtx/dt| above 4 px/s for >= 0.5 s, merged across < 1 s gaps. */
function wallWalks(log) {
  if (!log || log.length < 5) return { walks: [], gaps: [] };
  const t = log.map(([ms]) => ms / 1000);
  const x = log.map(([, tx]) => tx);
  const xs = x.map((_, i) => {
    const a = x[Math.max(0, i - 1)], b = x[i], c = x[Math.min(x.length - 1, i + 1)];
    return (a + b + c) / 3;
  });
  const walks = [];
  let i = 0;
  while (i < t.length) {
    const grad = i > 0 ? Math.abs((xs[i] - xs[i - 1]) / (t[i] - t[i - 1])) : 0;
    if (grad > 4) {
      let j = i;
      while (j < t.length) {
        const g = j > 0 ? Math.abs((xs[j] - xs[j - 1]) / (t[j] - t[j - 1])) : 0;
        if (g <= 4) break;
        j += 1;
      }
      if (t[j - 1] - t[i] >= 0.5) walks.push([t[i], t[j - 1]]);
      i = j;
    } else {
      i += 1;
    }
  }
  const merged = [];
  for (const w of walks) {
    if (merged.length && w[0] - merged[merged.length - 1][1] < 1.0) {
      merged[merged.length - 1][1] = w[1];
    } else {
      merged.push([...w]);
    }
  }
  const info = merged.map(([a, b]) => {
    const ia = Math.max(0, Math.round(a * 5));
    const ib = Math.min(xs.length - 1, Math.round(b * 5));
    return {
      start_s: Math.round(a * 10) / 10,
      dur_s: Math.round((b - a) * 100) / 100,
      disp_px: Math.round((xs[ib] - xs[ia]) * 10) / 10,
    };
  });
  const gaps = [];
  for (let n = 1; n < info.length; n += 1) {
    gaps.push(Math.round((info[n].start_s - info[n - 1].start_s) * 10) / 10);
  }
  return { walks: info, gaps };
}

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

async function seed(page, pet, mood) {
  return page.evaluate(
    ([allPets, pet, mood]) => {
      const raw = localStorage.getItem('bobaBuddiesMobile');
      if (!raw) return false;
      const data = JSON.parse(raw);
      const save = data.state.save;
      const now = Date.now();
      save.ownedPets = allPets;
      save.activePet = pet;
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
      const active = save.pets[pet];
      // Mood seeds (ppDeriveMood order: sick > grumpy > potty > sad > hungry...).
      if (mood === 'sad') active.meters.happiness = 0; // any meter at 0 -> sad
      if (mood === 'grumpy') active.tantrumUntil = now + 600000;
      if (mood === 'hungry') active.meters.hunger = 15; // <30, >0 -> hungry (tired walk)
      localStorage.setItem('bobaBuddiesMobile', JSON.stringify(data));
      return true;
    },
    [ALL_PETS, pet, mood],
  );
}

const server = startServer();
const errors = [];
const timings = {};
const wallTimings = {};
try {
  await waitServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const c of CASES) {
    const videoT0 = Date.now();
    const videoDir = fs.mkdtempSync('/tmp/bb-walk2-proof-');
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
    if (!(await seed(page, c.pet, c.mood))) throw new Error(`${c.name}: no stored save to seed`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-testid="pet-stage"]', { timeout: 20000 });
    await page.waitForFunction(
      (name) => document.querySelector('[data-testid="pet-name"]')?.textContent === name,
      NAMES[c.pet],
      { timeout: 10000 },
    );
    await page.waitForTimeout(800); // let all 12 layers load
    const t0 = Date.now();
    timings[`${c.name}:idle-start`] = 0;
    timings[`${c.name}:idle-start-offset-ms`] = t0 - videoT0;
    await startWalkLogger(page);
    await page.waitForTimeout(c.idleMs);
    timings[`${c.name}:end`] = Date.now() - t0;
    const wallLog = await stopWalkLogger(page);
    wallTimings[c.name] = wallWalks(wallLog);
    const moodLabel = await page.evaluate(
      () => document.querySelector('[data-testid="mood-chip"]')?.textContent ?? '(no mood testid)',
    );
    timings[`${c.name}:mood-label`] = moodLabel;
    await page.close();
    await context.close();
    const files = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length !== 1) throw new Error(`${c.name}: expected 1 video, got ${files.length}`);
    fs.copyFileSync(path.join(videoDir, files[0]), path.join(OUT, `walk2-${c.name}.webm`));
    fs.rmSync(videoDir, { recursive: true, force: true });
    console.log(`recorded walk2-${c.name}.webm (${c.idleMs / 1000}s idle, mood label: ${moodLabel})`);
  }
  await browser.close();
} finally {
  server.kill();
}
fs.writeFileSync(path.join(OUT, 'walk2-timings.json'), JSON.stringify(timings, null, 1));
fs.writeFileSync(path.join(OUT, 'walk2-wall-timings.json'), JSON.stringify(wallTimings, null, 1));
console.log('WALL-CLOCK WALKS (s):\n' + JSON.stringify(wallTimings, null, 1));
console.log('PHASE TIMINGS (ms after t0):\n' + JSON.stringify(timings, null, 1));
if (errors.length) {
  console.error('JS ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — no JS errors');
