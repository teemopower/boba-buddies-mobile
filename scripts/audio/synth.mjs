#!/usr/bin/env node
/**
 * Boba Buddies Mobile — original audio synthesizer.
 *
 * Renders ALL audio for the app from scratch in code: no downloaded files,
 * no licensed samples, no assets with unclear rights. Every sound is built
 * from sine/triangle oscillators and seeded pseudo-random noise, so the
 * output is 100% original and reproducible (same seed => same WAV bytes).
 *
 * Sound design: MUSIC-BOX style. Every pitched note is a sine fundamental
 * with a soft octave harmonic (and a faint 3rd harmonic), a fast attack
 * (~4 ms) and a long exponential decay — the classic music-box "plink".
 *
 * Usage:
 *   node scripts/audio/synth.mjs [--out <dir>]
 *
 * Output: 44.1 kHz, 16-bit, mono WAV files (PCM headers written by hand —
 * no ffmpeg, no libraries, zero dependencies).
 *
 *   assets/audio/music-daytime.wav   ~34 s cheerful C-major pentatonic loop
 *   assets/audio/music-lullaby.wav   ~36 s slow sparse music-box lullaby
 *   assets/audio/music-playtime.wav  ~30 s bouncier loop for the Play tab
 *   assets/audio/sfx-*.wav           21 short effects (0.1–1.2 s)
 *
 * Loop seamlessness: each music loop is an exact whole number of bars,
 * ends on the tonic with the final note given a full bar of decay, and
 * gets a 100 ms fade to silence at the very end while the loop start is
 * silence (first note attacks from 0). The loop point is therefore
 * inaudible — no click, no pop.
 *
 * Extension parity: the 14 Web Audio SFX in
 * ~/workspace/extensions/pocket-pals/extension/sounds.js (click, pop,
 * chomp, slurp, gulp, ding, hatch, squeak, win, lose, yawn, scrub,
 * scold, sparkle) are all covered here, plus 7 mobile-only extras
 * (coin, hop, giggle, footsteps, potty, heart, error).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = join(ROOT, 'assets', 'audio');

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reproducible noise, identical WAVs
// every run.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xb0ba);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function makeBuffer(seconds) {
  return new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
}

/** Music-box pluck: sine + soft octave harmonic + faint 3rd harmonic. */
function pluck(buf, t0, freq, dur, vol, tau = 0.55, harmonic2 = 0.32, harmonic3 = 0.1) {
  const start = Math.floor(t0 * SAMPLE_RATE);
  const end = Math.min(buf.length, start + Math.ceil(dur * SAMPLE_RATE));
  const attack = 0.004;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / tau);
    const ph = 2 * Math.PI * freq * t;
    buf[i] +=
      vol *
      env *
      (Math.sin(ph) + harmonic2 * Math.sin(2 * ph) + harmonic3 * Math.sin(3 * ph));
  }
}

/** Sine/triangle tone with optional exponential pitch glide. */
function tone(buf, t0, freq, dur, vol, { slideTo = null, type = 'sine' } = {}) {
  const start = Math.floor(t0 * SAMPLE_RATE);
  const end = Math.min(buf.length, start + Math.ceil(dur * SAMPLE_RATE));
  const attack = 0.008;
  let phase = 0;
  let prevT = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const f = slideTo ? freq * Math.pow(slideTo / freq, t / dur) : freq;
    phase += 2 * Math.PI * f * (t - prevT);
    prevT = t;
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / (dur / 3));
    let v = Math.sin(phase);
    if (type === 'triangle') v = (2 / Math.PI) * Math.asin(Math.sin(phase));
    else if (type === 'soft-square') v = Math.tanh(1.6 * Math.sin(phase));
    buf[i] += vol * env * v;
  }
}

/** Low-passed white-noise burst (crunches, swishes, thuds). */
function noiseBurst(buf, t0, dur, vol, cutoff = 1200) {
  const start = Math.floor(t0 * SAMPLE_RATE);
  const end = Math.min(buf.length, start + Math.ceil(dur * SAMPLE_RATE));
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE); // one-pole LP
  let y = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const env = Math.sin((Math.PI * t) / dur); // raised-cosine envelope
    y += a * ((rand() * 2 - 1) - y);
    buf[i] += vol * env * y;
  }
}

/** Low sine thump (footsteps, chew body, potty plip body). */
function thump(buf, t0, freq, dur, vol) {
  tone(buf, t0, freq, dur, vol, { type: 'sine' });
}

/** Gentle fade of the last `ms` milliseconds to exactly 0 (no loop click). */
function fadeOutTail(buf, ms = 100) {
  const n = Math.floor((ms / 1000) * SAMPLE_RATE);
  for (let i = 0; i < n && buf.length - 1 - i >= 0; i++) {
    buf[buf.length - 1 - i] *= i / n;
  }
}

/** Soft-limit + normalize to a peak of 0.92 so nothing clips. */
function finalize(buf) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0.92 ? 0.92 / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * gain * 1.05);
  return buf;
}

// ---------------------------------------------------------------------------
// WAV writer — 44.1 kHz, 16-bit, mono PCM, header written by hand.
// ---------------------------------------------------------------------------
function writeWav(path, samples) {
  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  const pcm = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  writeFileSync(path, Buffer.concat([header, pcm]));
}

// ---------------------------------------------------------------------------
// MUSIC — composed melodies (original; C major / A minor pentatonic).
// Notes are [bar, beat, midi, beats, vol?]. Bars are 0-based.
// ---------------------------------------------------------------------------

/** Render a melody+bass arrangement into a loop of `bars` bars. */
function renderLoop({ bpm, beatsPerBar, bars, melody, bass, sparkleBeats = [] }) {
  const beatSec = 60 / bpm;
  const totalSec = bars * beatsPerBar * beatSec;
  const buf = makeBuffer(totalSec + 0.05);
  const at = (bar, beat) => (bar * beatsPerBar + beat) * beatSec;
  for (const [bar, beat, m, len, vol = 0.3] of melody) {
    pluck(buf, at(bar, beat), midi(m), len * beatSec + 0.9, vol, 0.6);
  }
  for (const [bar, beat, m, len, vol = 0.16] of bass) {
    pluck(buf, at(bar, beat), midi(m - 12), len * beatSec + 0.5, vol, 0.45, 0.2, 0.05);
  }
  // Shimmer: a soft octave-up echo on accented melody notes.
  for (const [bar, beat, m] of sparkleBeats) {
    pluck(buf, at(bar, beat), midi(m + 12), 1.2, 0.07, 0.5);
  }
  fadeOutTail(buf, 100);
  return finalize(buf);
}

// --- Daytime: cheerful C-major pentatonic, 112 BPM, 4/4, 16 bars = 34.3 s
const DAYTIME_MELODY = [
  [0, 0, 76, 1], [0, 1, 79, 1], [0, 2, 81, 1.5], [0, 3.5, 79, 0.5],
  [1, 0, 76, 1], [1, 1, 74, 1], [1, 2, 72, 2],
  [2, 0, 74, 1], [2, 1, 76, 1], [2, 2, 79, 1], [2, 3, 76, 1],
  [3, 0, 74, 1.5], [3, 1.5, 72, 0.5], [3, 2, 74, 2],
  [4, 0, 76, 1], [4, 1, 79, 1], [4, 2, 81, 1.5], [4, 3.5, 79, 0.5],
  [5, 0, 81, 1], [5, 1, 79, 1], [5, 2, 76, 1], [5, 3, 74, 1],
  [6, 0, 76, 1], [6, 1, 74, 1], [6, 2, 72, 1], [6, 3, 74, 1],
  [7, 0, 76, 2], [7, 2, 79, 2],
  [8, 0, 81, 1], [8, 1, 79, 1], [8, 2, 76, 1.5], [8, 3.5, 74, 0.5],
  [9, 0, 76, 1], [9, 1, 74, 1], [9, 2, 72, 2],
  [10, 0, 74, 1], [10, 1, 76, 1], [10, 2, 79, 1], [10, 3, 81, 1],
  [11, 0, 79, 1.5], [11, 1.5, 76, 0.5], [11, 2, 74, 2],
  [12, 0, 76, 1], [12, 1, 79, 1], [12, 2, 81, 1], [12, 3, 84, 1],
  [13, 0, 81, 1], [13, 1, 79, 1], [13, 2, 76, 1], [13, 3, 74, 1],
  [14, 0, 76, 1], [14, 1, 74, 1], [14, 2, 72, 1], [14, 3, 74, 1],
  [15, 0, 72, 2], // final tonic, rests for the rest of the bar to decay
];
const DAYTIME_BASS_ROOTS = [48, 53, 55, 48, 45, 53, 55, 48, 48, 53, 55, 48, 45, 50, 55, 48];
const DAYTIME_SPARKLE = [[0, 2, 81], [4, 2, 81], [7, 2, 79], [12, 3, 84], [15, 0, 72]];

// --- Lullaby: slow + sparse, 60 BPM, 3/4, 12 bars = 36.0 s
const LULLABY_MELODY = [
  [0, 0, 76, 2], [0, 2, 79, 1],
  [1, 0, 81, 2], [1, 2, 79, 1],
  [2, 0, 76, 2], [2, 2, 74, 1],
  [3, 0, 72, 3],
  [4, 0, 74, 2], [4, 2, 76, 1],
  [5, 0, 79, 3],
  [6, 0, 76, 2], [6, 2, 74, 1],
  [7, 0, 72, 3],
  [8, 0, 76, 2], [8, 2, 79, 1],
  [9, 0, 81, 2], [9, 2, 79, 1],
  [10, 0, 76, 2], [10, 2, 74, 1],
  [11, 0, 72, 3], // final tonic, whole bar to decay
];
const LULLABY_BASS_ROOTS = [48, 45, 53, 55, 48, 45, 53, 55, 48, 53, 55, 48];

// --- Playtime: bouncier, 126 BPM, 4/4, 16 bars = 30.5 s
const PLAYTIME_MELODY = [
  [0, 0, 72, 0.5], [0, 0.5, 76, 0.5], [0, 1, 79, 0.5], [0, 1.5, 76, 0.5],
  [0, 2, 81, 1], [0, 3, 79, 1],
  [1, 0, 76, 0.5], [1, 0.5, 74, 0.5], [1, 1, 72, 1], [1, 2, 74, 1], [1, 3, 76, 1],
  [2, 0, 79, 0.5], [2, 0.5, 81, 0.5], [2, 1, 79, 0.5], [2, 1.5, 76, 0.5],
  [2, 2, 74, 1], [2, 3, 76, 1],
  [3, 0, 72, 2], [3, 2, 74, 1], [3, 3, 76, 1],
  [4, 0, 79, 1], [4, 1, 81, 1], [4, 2, 84, 1], [4, 3, 81, 1],
  [5, 0, 79, 0.5], [5, 0.5, 76, 0.5], [5, 1, 74, 1], [5, 2, 76, 1], [5, 3, 79, 1],
  [6, 0, 81, 1], [6, 1, 79, 1], [6, 2, 76, 1], [6, 3, 74, 1],
  [7, 0, 72, 2], [7, 2, 79, 2],
  [8, 0, 72, 0.5], [8, 0.5, 76, 0.5], [8, 1, 79, 0.5], [8, 1.5, 76, 0.5],
  [8, 2, 81, 1], [8, 3, 79, 1],
  [9, 0, 76, 0.5], [9, 0.5, 74, 0.5], [9, 1, 72, 1], [9, 2, 74, 1], [9, 3, 76, 1],
  [10, 0, 79, 1], [10, 1, 76, 1], [10, 2, 74, 1], [10, 3, 72, 1],
  [11, 0, 74, 1], [11, 1, 76, 1], [11, 2, 79, 1], [11, 3, 81, 1],
  [12, 0, 84, 1], [12, 1, 81, 1], [12, 2, 79, 1], [12, 3, 76, 1],
  [13, 0, 79, 0.5], [13, 0.5, 81, 0.5], [13, 1, 84, 1], [13, 2, 81, 1], [13, 3, 79, 1],
  [14, 0, 76, 1], [14, 1, 74, 1], [14, 2, 72, 1], [14, 3, 74, 1],
  [15, 0, 72, 2], // final tonic, rests to decay
];
const PLAYTIME_BASS_ROOTS = [48, 53, 55, 48, 45, 53, 55, 48, 48, 53, 55, 48, 45, 50, 55, 48];
const PLAYTIME_SPARKLE = [[4, 2, 84], [7, 2, 79], [12, 0, 84], [15, 0, 72]];

function bassPattern(roots, beatsPerBar, vol = 0.16) {
  const out = [];
  roots.forEach((root, bar) => {
    out.push([bar, 0, root, 1, vol]);
    out.push([bar, 2, root + 7, 1, vol * 0.8]); // fifth on beat 3
  });
  return out;
}

// ---------------------------------------------------------------------------
// SFX — each returns a finalized Float32Array. Durations 0.1–1.2 s.
// ---------------------------------------------------------------------------
function sfxBuffer(seconds) {
  return makeBuffer(seconds);
}

const SFX = {
  // Extension parity: click -> button tap (short 660 Hz sine blip).
  'sfx-button': () => {
    const b = sfxBuffer(0.12);
    tone(b, 0, 660, 0.06, 0.28);
    return b;
  },
  // Extension parity: pop (800 -> 1400 Hz sweep).
  'sfx-tap': () => {
    const b = sfxBuffer(0.16);
    tone(b, 0, 800, 0.09, 0.35, { slideTo: 1400 });
    return b;
  },
  // Two-note coin ding: B5 -> E6.
  'sfx-coin': () => {
    const b = sfxBuffer(0.5);
    pluck(b, 0, midi(83), 0.14, 0.35, 0.25);
    pluck(b, 0.1, midi(88), 0.3, 0.35, 0.3);
    return b;
  },
  // Extension parity: chomp -> chew. Two soft crunches: filtered noise
  // burst + low thump, twice.
  'sfx-chew': () => {
    const b = sfxBuffer(0.6);
    noiseBurst(b, 0, 0.07, 0.5, 900);
    thump(b, 0, 150, 0.09, 0.35);
    noiseBurst(b, 0.2, 0.07, 0.45, 800);
    thump(b, 0.2, 130, 0.09, 0.3);
    return b;
  },
  // Extension parity: slurp (480 -> 950, then 950 -> 1300).
  'sfx-slurp': () => {
    const b = sfxBuffer(0.6);
    tone(b, 0, 480, 0.3, 0.3, { slideTo: 950 });
    tone(b, 0.3, 950, 0.14, 0.25, { slideTo: 1300 });
    return b;
  },
  // Extension parity: gulp (220 -> 130), twice, soft.
  'sfx-gulp': () => {
    const b = sfxBuffer(0.4);
    tone(b, 0, 220, 0.16, 0.35, { slideTo: 130 });
    tone(b, 0.2, 200, 0.12, 0.22, { slideTo: 120 });
    return b;
  },
  // Extension parity: ding (880 + 1318).
  'sfx-ding': () => {
    const b = sfxBuffer(0.55);
    pluck(b, 0, 880, 0.14, 0.35, 0.3);
    pluck(b, 0.1, 1318.5, 0.3, 0.35, 0.35);
    return b;
  },
  // Extension parity: hatch — C E G C arpeggio sparkle.
  'sfx-hatch': () => {
    const b = sfxBuffer(0.95);
    [72, 76, 79, 84].forEach((m, i) =>
      pluck(b, i * 0.11, midi(m), 0.25, 0.35, 0.4));
    return b;
  },
  // Extension parity: squeak (1150 -> 1900, 1500 -> 2100).
  'sfx-squeak': () => {
    const b = sfxBuffer(0.4);
    tone(b, 0, 1150, 0.13, 0.3, { slideTo: 1900 });
    tone(b, 0.1, 1500, 0.1, 0.22, { slideTo: 2100 });
    return b;
  },
  // Extension parity: win — rising 5-note sparkle arpeggio.
  'sfx-win': () => {
    const b = sfxBuffer(1.05);
    [72, 76, 79, 84, 88].forEach((m, i) =>
      pluck(b, i * 0.09, midi(m), 0.25, 0.35, 0.45));
    return b;
  },
  // Extension parity: lose — soft descending two-note.
  'sfx-lose': () => {
    const b = sfxBuffer(0.6);
    tone(b, 0, 400, 0.16, 0.28, { slideTo: 300 });
    tone(b, 0.14, 300, 0.2, 0.28, { slideTo: 220 });
    return b;
  },
  // Extension parity: yawn — long soft downward slide.
  'sfx-yawn': () => {
    const b = sfxBuffer(0.75);
    tone(b, 0, 420, 0.55, 0.25, { slideTo: 200 });
    noiseBurst(b, 0.05, 0.4, 0.05, 500); // faint breath
    return b;
  },
  // Three quick high plinks.
  'sfx-giggle': () => {
    const b = sfxBuffer(0.7);
    [93, 96, 98].forEach((m, i) => pluck(b, i * 0.12, midi(m), 0.16, 0.3, 0.25));
    return b;
  },
  // Two soft thuds.
  'sfx-footsteps': () => {
    const b = sfxBuffer(0.55);
    thump(b, 0, 105, 0.1, 0.4);
    noiseBurst(b, 0, 0.04, 0.12, 600);
    thump(b, 0.24, 95, 0.1, 0.38);
    noiseBurst(b, 0.24, 0.04, 0.1, 600);
    return b;
  },
  // Extension parity: scrub — three soft noise swishes + wiggle tones.
  'sfx-scrub': () => {
    const b = sfxBuffer(0.65);
    noiseBurst(b, 0, 0.1, 0.3, 1800);
    tone(b, 0, 700, 0.09, 0.18, { slideTo: 520 });
    noiseBurst(b, 0.12, 0.1, 0.3, 1800);
    tone(b, 0.12, 520, 0.09, 0.18, { slideTo: 720 });
    noiseBurst(b, 0.24, 0.1, 0.3, 1800);
    tone(b, 0.24, 700, 0.09, 0.18, { slideTo: 520 });
    return b;
  },
  // Extension parity: scold — low soft thud.
  'sfx-scold': () => {
    const b = sfxBuffer(0.35);
    tone(b, 0, 180, 0.18, 0.3, { slideTo: 120, type: 'soft-square' });
    return b;
  },
  // Extension parity: sparkle (1568 + 2093).
  'sfx-sparkle': () => {
    const b = sfxBuffer(0.5);
    pluck(b, 0, 1568, 0.14, 0.3, 0.25);
    pluck(b, 0.08, 2093, 0.22, 0.3, 0.3);
    return b;
  },
  // Tiny plip: quick high-to-low drop + droplet.
  'sfx-potty': () => {
    const b = sfxBuffer(0.35);
    tone(b, 0, 950, 0.09, 0.32, { slideTo: 420 });
    tone(b, 0.12, 700, 0.07, 0.18, { slideTo: 380 });
    return b;
  },
  // Quick boing: pitch sweep up with a little overshoot wobble.
  'sfx-hop': () => {
    const b = sfxBuffer(0.4);
    tone(b, 0, 280, 0.2, 0.32, { slideTo: 720 });
    tone(b, 0.05, 560, 0.12, 0.12, { slideTo: 900 });
    return b;
  },
  // Warm soft pluck: C major chord, low + high, long decay.
  'sfx-heart': () => {
    const b = sfxBuffer(0.85);
    pluck(b, 0, midi(60), 0.5, 0.22, 0.5, 0.2, 0.05);
    pluck(b, 0, midi(76), 0.6, 0.28, 0.6);
    pluck(b, 0.02, midi(79), 0.6, 0.24, 0.6);
    pluck(b, 0.02, midi(84), 0.6, 0.16, 0.6);
    return b;
  },
  // Muted buzz: two short low detuned tones, quiet.
  'sfx-error': () => {
    const b = sfxBuffer(0.55);
    tone(b, 0, 150, 0.13, 0.2, { type: 'soft-square' });
    tone(b, 0, 158, 0.13, 0.2, { type: 'soft-square' });
    tone(b, 0.19, 140, 0.15, 0.2, { type: 'soft-square' });
    tone(b, 0.19, 147, 0.15, 0.2, { type: 'soft-square' });
    return b;
  },
};

// ---------------------------------------------------------------------------
// Render everything.
// ---------------------------------------------------------------------------
const TRACKS = [
  {
    file: 'music-daytime.wav',
    desc: 'Daytime loop — cheerful C-major pentatonic, 112 BPM, 16 bars',
    render: () =>
      renderLoop({
        bpm: 112,
        beatsPerBar: 4,
        bars: 16,
        melody: DAYTIME_MELODY,
        bass: bassPattern(DAYTIME_BASS_ROOTS, 4),
        sparkleBeats: DAYTIME_SPARKLE,
      }),
  },
  {
    file: 'music-lullaby.wav',
    desc: 'Lullaby loop — slow sparse music-box, 60 BPM, 3/4, 12 bars',
    render: () =>
      renderLoop({
        bpm: 60,
        beatsPerBar: 3,
        bars: 12,
        melody: LULLABY_MELODY,
        bass: LULLABY_BASS_ROOTS.map((r, bar) => [bar, 0, r, 2, 0.13]),
        sparkleBeats: [[11, 0, 72]],
      }),
  },
  {
    file: 'music-playtime.wav',
    desc: 'Playtime loop — bouncier variation, 126 BPM, 16 bars',
    render: () =>
      renderLoop({
        bpm: 126,
        beatsPerBar: 4,
        bars: 16,
        melody: PLAYTIME_MELODY,
        bass: bassPattern(PLAYTIME_BASS_ROOTS, 4, 0.18),
        sparkleBeats: PLAYTIME_SPARKLE,
      }),
  },
  ...Object.entries(SFX).map(([file, render]) => ({
    file: `${file}.wav`,
    desc: `SFX ${file.replace('sfx-', '')}`,
    render,
  })),
];

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;
  mkdirSync(outDir, { recursive: true });

  console.log(`Rendering ${TRACKS.length} tracks -> ${outDir}`);
  console.log('Sample rate: 44100 Hz, 16-bit, mono (kept at 44.1 kHz: music-box');
  console.log('harmonics reach ~8 kHz, and the total stays ~10 MB — no quality');
  console.log('compromise needed; 22.05 kHz would halve size but dull the plinks.)');
  let totalBytes = 0;
  for (const track of TRACKS) {
    const samples = finalize(track.render());
    const path = join(outDir, track.file);
    writeWav(path, samples);
    const seconds = samples.length / SAMPLE_RATE;
    const bytes = 44 + samples.length * 2;
    totalBytes += bytes;
    console.log(
      `  ${track.file.padEnd(22)} ${seconds.toFixed(2).padStart(6)}s  ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${track.desc}`,
    );
  }
  console.log(`Total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${TRACKS.length} files.`);
  console.log('Done. All audio is synthesized in code — no external audio used.');
}

main();
