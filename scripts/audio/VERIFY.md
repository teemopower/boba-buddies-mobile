# Boba Buddies Mobile — Audio Verification Log

Generated: 2026-11-23. Regenerate audio with `node scripts/audio/synth.mjs`,
then re-run the checks below.

## What was verified, and how

1. **WAV headers (ffprobe + Node header read, all 24 files):** every file is
   a valid RIFF/WAVE, PCM 16-bit (`pcm_s16le`), 44,100 Hz, mono. ffprobe
   durations match the sample counts in the table below. Peak sample level
   across all files is 0.22–0.73 (no clipping; soft-limited to 0.92 max).
2. **Loop points (sample-level check):** for the 3 music loops, the first
   and last 5 samples are all ≈ 0.0000 (first note attacks from silence,
   final tonic decays through a full bar, plus a 100 ms fade to zero at
   the end), so the loop point has no click/pop. Seamlessness was checked
   at the sample level, not by ear.
3. **Actual playback (headless Chromium, all 24 files):** each WAV was
   served over HTTP and played in a real `<audio>` element via CDP
   (test harness: `/tmp/playtest/verify.mjs`, Chromium from the
   ms-playwright cache, `--autoplay-policy=no-user-gesture-required`).
   For every file `play()` succeeded (`paused === false`) and
   `currentTime` advanced between two samples 300 ms apart (short SFX
   that finished inside the window are marked played-to-end instead).
   Result: **24 passed, 0 failed.**
   - Note: in that harness Chrome reports `duration === Infinity` for
     the three long music files (the test HTTP server does not implement
     Range requests, so Chrome streams them without a known length).
     Playback still advanced normally; the durations below are the
     authoritative ffprobe/WAV-header values.
4. **Typecheck:** `npx tsc --noEmit` reports **zero errors in this
   task's files** (`scripts/audio/`, `src/audio/`). It does NOT pass
   repo-wide: 4 pre-existing errors in `scripts/verify-logic.ts`
   (a file from another agent's concurrent work, outside this task's
   scope — `Cannot find name 'node:child_process'` etc., missing
   `@types/node`). That file was not touched. The expo-audio wiring
   itself is therefore **code-only until integration**: it is typed
   against the installed expo-audio 58.0.12 declarations and compiles,
   but it has not yet played through `expo-audio` on a device/dev
   build — that proof comes at integration time.

## Files

| File | Duration | Size | Format | Play test |
|---|---|---|---|---|
| music-daytime.wav | 34.34 s | 2957.5 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| music-lullaby.wav | 36.05 s | 3105.1 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| music-playtime.wav | 30.53 s | 2629.3 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-button.wav | 0.12 s | 10.4 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-chew.wav | 0.60 s | 51.7 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-coin.wav | 0.50 s | 43.1 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-ding.wav | 0.55 s | 47.4 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-error.wav | 0.55 s | 47.4 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-footsteps.wav | 0.55 s | 47.4 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-giggle.wav | 0.70 s | 60.3 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-gulp.wav | 0.40 s | 34.5 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-hatch.wav | 0.95 s | 81.9 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-heart.wav | 0.85 s | 73.3 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-hop.wav | 0.40 s | 34.5 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-lose.wav | 0.60 s | 51.7 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-potty.wav | 0.35 s | 30.2 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-scold.wav | 0.35 s | 30.2 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-scrub.wav | 0.65 s | 56.0 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-slurp.wav | 0.60 s | 51.7 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-sparkle.wav | 0.50 s | 43.1 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-squeak.wav | 0.40 s | 34.5 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-tap.wav | 0.16 s | 13.8 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-win.wav | 1.05 s | 90.5 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |
| sfx-yawn.wav | 0.75 s | 64.6 KB | 44100 Hz / 16-bit / 1ch PCM | PLAYED (currentTime advanced) |

**Total: 24 files, 9.46 MB.** Sample rate kept at 44.1 kHz (not 22.05 kHz):
music-box harmonics reach ~8 kHz, and 9.46 MB total is acceptable for
the app bundle — no quality compromise was needed.

## Coverage vs. the browser extension

All 14 extension SFX from `extensions/pocket-pals/extension/sounds.js`
are covered: click → `sfx-button`, pop → `sfx-tap`, chomp → `sfx-chew`,
slurp → `sfx-slurp`, gulp → `sfx-gulp`, ding → `sfx-ding`,
hatch → `sfx-hatch`, squeak → `sfx-squeak`, win → `sfx-win`,
lose → `sfx-lose`, yawn → `sfx-yawn`, scrub → `sfx-scrub`,
scold → `sfx-scold`, sparkle → `sfx-sparkle`. Mobile-only extras:
`coin`, `hop`, `giggle`, `footsteps`, `potty`, `heart`, `error`.

## Not verified (honest gaps)

- **expo-audio playback on device:** the player service
  (`src/audio/player.ts`) compiles against expo-audio 58.0.12 and every
  call is guarded so a missing file logs instead of crashing, but no
  sound has yet played through `expo-audio` on iOS/Android/web. That
  needs a dev build / Expo Go run at integration time.
- **Seamless looping by ear:** the loop point is sample-silent
  (see §2), but nobody has listened to a loop boundary on a device yet.
- **tsc repo-wide:** blocked by the unrelated `scripts/verify-logic.ts`
  errors noted in §4.
