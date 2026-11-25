#!/usr/bin/env python3
"""bb-proof/motion-walk.py — visibility + wander analysis for motion videos.

For each motion-after-<pet>.webm (recorded by motion-check.mjs):
 1. Visibility: same background-difference metric as analyze.py, sampled
    at 25 fps. Reports median/min and counts frames below 60% of the
    median (dips) and below 25% (blanks), skipping the first 2s of page
    load. The Nov 24 hard-cut fix should give ZERO dips during motion —
    the old 80ms crossfade dipped on every frame change.
 2. Wander: over the last 12s of the video (the idle/wander window),
    computes the pet's horizontal centroid per frame and saves the frame
    with the largest displacement from the window median as
    motion-<pet>-walk.png, reporting the displacement in px. A real
    wander drift is 25–64px; <10px means the pet never drifted on camera.

Usage: python3 motion-walk.py [pet ...]  (default: all 10)
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'proof' / 'animations'
PETS = sys.argv[1:] or ['momo', 'kiki', 'boba', 'yuki', 'taro', 'purin',
                        'sora', 'miso', 'hana', 'nori']
CROP = (80, 150, 230, 245)
BG_PT = (30, 200)
FPS = 25


def color_dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def analyze(pet):
    video = OUT / f'motion-after-{pet}.webm'
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        subprocess.run(
            ['ffmpeg', '-y', '-v', 'error', '-i', str(video),
             '-vf', f'fps={FPS}', str(tmp / '%04d.png')],
            check=True)
        frames = sorted(tmp.glob('*.png'))
        n = len(frames)
        metrics, centroids = [], []
        for f in frames:
            im = Image.open(f).convert('RGB')
            bg = im.getpixel(BG_PT)
            crop = im.crop((CROP[0], CROP[1], CROP[0] + CROP[2], CROP[1] + CROP[3]))
            px = list(crop.getdata())
            w, h = crop.size
            diff_x, diff_n = 0, 0
            for i, p in enumerate(px):
                if color_dist(p, bg) > 30:
                    diff_n += 1
                    diff_x += i % w
            metrics.append(diff_n / len(px))
            centroids.append(diff_x / diff_n if diff_n else None)
        # Visibility: skip the first 5s. The video starts at context
        # creation; page load + seed + reload + pet-name wait put t0
        # (first action) at ~5s, so anything before that is load/reload
        # timing, not a motion blink.
        vis = metrics[int(5 * FPS):]
        s = sorted(vis)
        median = s[len(s) // 2]
        minimum = s[0]
        dips = [i for i, m in enumerate(vis) if m < 0.60 * median]
        blanks = [i for i, m in enumerate(vis) if m < 0.25 * median]
        print(f'{pet}: {n} frames @25fps | visibility median={median:.3f} '
              f'min={minimum:.3f} | dips<60%: {len(dips)} {dips[:10]} '
              f'| blanks<25%: {len(blanks)}')
        # Wander: last 12s of the video.
        tail = centroids[-int(12 * FPS):]
        xs = [c for c in tail if c is not None]
        if not xs:
            print(f'  walk: no pet pixels found in idle window')
            return 1 if (dips or blanks) else 0
        xs_sorted = sorted(xs)
        med_x = xs_sorted[len(xs_sorted) // 2]
        devs = [abs(c - med_x) for c in xs]
        best = max(range(len(devs)), key=lambda i: devs[i])
        print(f'  walk: max centroid displacement {devs[best]:.1f}px '
              f'(median x={med_x:.1f})')
        # Save the best-displacement frame as the walk proof still.
        idx = n - len(tail) + best
        src = Image.open(frames[idx])
        src.save(OUT / f'motion-{pet}-walk.png')
        print(f'  walk still: motion-{pet}-walk.png (frame {idx + 1}/{n}, '
              f't={idx / FPS:.1f}s)')
        return 1 if (dips or blanks) else 0


rc = 0
for pet in PETS:
    rc |= analyze(pet)
sys.exit(rc)
