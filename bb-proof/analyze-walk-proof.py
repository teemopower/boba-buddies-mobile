#!/usr/bin/env python3
"""bb-proof/analyze-walk-proof.py — analyze the Nov 24 walk-rework proof videos.

For each walk-proof-<case>.webm (recorded by walk-proof.mjs):
 1. Cadence: track the pet's horizontal centroid at 10 fps inside the
    stage box and detect walk intervals (sustained horizontal movement).
    Reports each walk's start (seconds after idle-start), duration,
    displacement and peak speed, plus the gaps between walk starts.
    The rework targets 15-30 s pauses between walks.
 2. Bob: vertical centroid range inside walk intervals vs idle pauses.
    The rework's step-synced bob is +/-2px; the old waddle was +/-3px
    on an unsynced loop plus the breathe bob — a big vertical range
    during walks would mean it still reads as dancing.
 3. Stills: saves the mid-walk frame of the first walk per case as
    walk-proof-<case>.png, a 4-frame walk-cycle strip (frames 160 ms
    apart during the first happy walk) as walk-proof-cycle-strip.png,
    and a happy-vs-sad side-by-side as walk-proof-sad-vs-happy.png.

Usage: python3 analyze-walk-proof.py [case ...]
  (default: momo-happy momo-sad momo-grumpy momo-tired)
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'proof' / 'animations'
CASES = sys.argv[1:] or ['momo-happy', 'momo-sad', 'momo-grumpy', 'momo-tired']
FPS = 10
BOX = None  # set from smooth-meta.json (momo stage box, video px)

with open(OUT / 'smooth-meta.json') as f:
    META = json.load(f)
with open(OUT / 'walk-proof-timings.json') as f:
    TIMINGS = json.load(f)


def centroid_series(video, box):
    """Return (times, cx, cy, frames_dir) at FPS over the whole video."""
    tmp = Path(tempfile.mkdtemp(prefix='bb-walk-'))
    subprocess.run(
        ['ffmpeg', '-y', '-v', 'error', '-i', str(video),
         '-vf', f'fps={FPS}', str(tmp / '%04d.png')],
        check=True)
    frames = sorted(tmp.glob('*.png'))
    x0, y0, x1, y1 = box
    times, cxs, cys = [], [], []
    for i, f in enumerate(frames):
        arr = np.array(Image.open(f).convert('RGB')).astype(np.int16)
        crop = arr[y0:y1, x0:x1]
        bg = np.median(crop[:12], axis=(0, 1))
        diff = np.abs(crop - bg).max(axis=2)
        mask = diff > 28
        mask[-18:, :] = False  # ignore the floor strip
        ys, xs = np.where(mask)
        if len(xs) < 200:
            times.append(i / FPS)
            cxs.append(None)
            cys.append(None)
            continue
        times.append(i / FPS)
        cxs.append(float(xs.mean()))
        cys.append(float(ys.mean()))
    return times, cxs, cys, tmp, frames


def fill_gaps(vals):
    """Forward-fill None (frames where the mask was lost)."""
    out, last = [], None
    for v in vals:
        if v is None:
            out.append(last)
        else:
            last = v
            out.append(v)
    # Leading Nones -> first real value.
    first = next((v for v in vals if v is not None), 0.0)
    return [first if v is None else v for v in out]


def moving_average(vals, window=9):
    """Centered moving average. Window 9 frames (0.9 s at 10 fps) kills the
    walk-cycle oscillation: the A/B frames are horizontal mirrors, so the
    mask centroid jumps ~+/-15 px every step (period 0.32-0.6 s) while the
    pet drifts. The drift (1-3 s walks) survives the average."""
    n = len(vals)
    half = window // 2
    out = []
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        out.append(sum(vals[lo:hi]) / (hi - lo))
    return out


def detect_walks(times, cx):
    """Walk = sustained horizontal movement. Returns list of dicts."""
    cx = moving_average(fill_gaps(cx))
    n = len(cx)
    # 3-frame moving average of per-frame dx (px/frame at 10 fps).
    dx = [0.0] * n
    for i in range(1, n):
        dx[i] = cx[i] - cx[i - 1]
    sm = [0.0] * n
    for i in range(n):
        lo, hi = max(0, i - 1), min(n, i + 2)
        sm[i] = sum(dx[lo:hi]) / (hi - lo)
    # Candidate frames: |smoothed dx| >= 0.8 px/frame (~8 px/s; a real
    # walk runs ~55 px/s = 5.5 px/frame, idle jitter is < 0.3).
    cand = [abs(v) >= 0.8 for v in sm]
    runs, i = [], 0
    while i < n:
        if not cand[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and (cand[j + 1] or (j + 2 < n and cand[j + 2])):
            j += 1
        disp = abs(cx[j] - cx[i])
        if disp >= 10 and (times[j] - times[i]) >= 0.5:
            runs.append({'i0': i, 'i1': j,
                         't0': times[i], 't1': times[j],
                         'disp': disp,
                         'peak': max(abs(v) for v in sm[i:j + 1]) * FPS})
        i = j + 1
    return runs


def main():
    box_meta = META['momo']['stageBox']
    x0 = max(0, int(box_meta['x']) - 80)
    x1 = min(390, int(box_meta['x'] + box_meta['width']) + 80)
    y0 = max(0, int(box_meta['y']) - 10)
    y1 = min(844, int(box_meta['y'] + box_meta['height']) + 10)
    box = (x0, y0, x1, y1)
    all_walks = {}
    for case in CASES:
        video = OUT / f'walk-proof-{case}.webm'
        if not video.exists():
            print(f'{case}: MISSING {video}')
            continue
        offset = TIMINGS.get(f'{case}:idle-start-offset-ms', 5000) / 1000.0
        times, cxs, cys, tmp, frames = centroid_series(video, box)
        # Ignore everything before idle-start: page load + seed + reload
        # move the stage around (pet mounting, layout shifts) and those
        # jumps are not walks.
        keep = [i for i, t in enumerate(times) if t >= offset]
        times = [times[i] for i in keep]
        cxs = [cxs[i] for i in keep]
        cys = [cys[i] for i in keep]
        frames = [frames[i] for i in keep]
        try:
            walks = detect_walks(times, cxs)
            all_walks[case] = (walks, offset, frames)
            starts = [w['t0'] - offset for w in walks]
            gaps = [round(b - a, 1) for a, b in zip(starts, starts[1:])]
            print(f'{case}: {len(walks)} walk(s); starts after idle-start: '
                  f'{[round(s, 1) for s in starts]}s; gaps between starts: {gaps}s')
            for w in walks:
                print(f"  walk {w['t0'] - offset:.1f}s..{w['t1'] - offset:.1f}s "
                      f"dur {w['t1'] - w['t0']:.1f}s disp {w['disp']:.0f}px "
                      f"peak {w['peak']:.0f}px/s")
            # Movement summary per 5 s bin after idle-start — catches walks
            # the detector missed. Uses the smoothed series (raw per-frame
            # dx is dominated by the A/B frame alternation, not the drift).
            cx = moving_average(fill_gaps(cxs))
            print(f'  movement per 5s bin (max |dx| px/frame, total |dx| px):')
            t = offset
            while t < times[-1]:
                seg = [(times[i], cx[i]) for i in range(len(times))
                       if t <= times[i] < t + 5 and cx[i] is not None]
                if len(seg) > 5:
                    dxs = [abs(b - a) for (_, a), (_, b) in zip(seg, seg[1:])]
                    tot = sum(dxs)
                    print(f'    {t - offset:5.1f}s..{t - offset + 5:5.1f}s '
                          f'max-dx {max(dxs):.2f} total {tot:.1f}')
                t += 5
            # Bob: vertical centroid range inside walks vs idle pauses,
            # on the smoothed series (frame switches jump the raw cy).
            # Trim 0.4 s off each end of each walk: the pose change at
            # walk start/end (idle frame -> walk frame) shifts the
            # silhouette's centroid once, which is not bobbing.
            cy = moving_average(fill_gaps(cys))
            if walks:
                wr = []
                for w in walks:
                    i0 = min(w['i1'], w['i0'] + int(0.4 * FPS))
                    i1 = max(w['i0'], w['i1'] - int(0.4 * FPS))
                    seg = cy[i0:i1 + 1] or cy[w['i0']:w['i1'] + 1]
                    wr.append(max(seg) - min(seg))
                idle = [cy[i] for i in range(len(cy))
                        if times[i] >= offset and not any(
                            w['i0'] <= i <= w['i1'] for w in walks)]
                ir = (max(idle) - min(idle)) if len(idle) > 5 else float('nan')
                print(f'  vertical centroid range during walks: '
                      f'{[round(v, 1) for v in wr]}px; during idle: {ir:.1f}px')
            # Mid-walk still of the first walk (full frame) + a persistent
            # stage-box crop (the temp frames are deleted below).
            if walks:
                w = walks[0]
                mid = (w['i0'] + w['i1']) // 2
                mid_img = Image.open(frames[mid]).convert('RGB')
                mid_img.save(OUT / f'walk-proof-{case}.png')
                mid_img.crop(box).save(OUT / f'walk-proof-{case}-midcrop.png')
                print(f'  still: walk-proof-{case}.png (mid-walk, '
                      f'{frames[mid].name})')
                if case == 'momo-happy':
                    # 4 cycle frames ~0.2 s apart during the first walk.
                    for k in range(4):
                        idx = min(w['i0'] + 2 * k, len(frames) - 1)
                        Image.open(frames[idx]).convert('RGB').crop(box).save(
                            OUT / f'walk-proof-cycle-{k}.png')
                    print('  cycle frames: walk-proof-cycle-0..3.png')
        finally:
            # /tmp is a 512 MB tmpfs — free the extracted frames per case.
            shutil.rmtree(tmp, ignore_errors=True)
    # Walk-cycle strip from the persistent happy-case cycle frames.
    cycle_files = [OUT / f'walk-proof-cycle-{k}.png' for k in range(4)]
    if all(f.exists() for f in cycle_files):
        crops = [Image.open(f) for f in cycle_files]
        w, h = crops[0].size
        strip = Image.new('RGB', (w, h * 4), (255, 255, 255))
        for j, c in enumerate(crops):
            strip.paste(c, (0, j * h))
        strip.save(OUT / 'walk-proof-cycle-strip.png')
        print('  cycle strip: walk-proof-cycle-strip.png '
              '(4 frames ~0.2s apart during first happy walk)')
    # Side-by-side: happy vs sad mid-walk, cropped to the stage box.
    happy_crop = OUT / 'walk-proof-momo-happy-midcrop.png'
    sad_crop = OUT / 'walk-proof-momo-sad-midcrop.png'
    if happy_crop.exists() and sad_crop.exists():
        happy = Image.open(happy_crop)
        sad = Image.open(sad_crop)
        w, h = happy.size
        comp = Image.new('RGB', (w * 2 + 30, h + 44), (255, 255, 255))
        d = ImageDraw.Draw(comp)
        comp.paste(happy, (0, 44))
        comp.paste(sad, (w + 30, 44))
        d.text((10, 10), 'HAPPY WALK', fill=(0, 0, 0))
        d.text((w + 40, 10), 'SAD WALK', fill=(0, 0, 0))
        comp.save(OUT / 'walk-proof-sad-vs-happy.png')
        print('  side-by-side: walk-proof-sad-vs-happy.png')


if __name__ == '__main__':
    main()
