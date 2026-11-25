#!/usr/bin/env python3
"""bb-proof/analyze-walk2.py — FULL-RATE analysis for the Nov 25 walk fix
(round 2) proof videos.

The round-1 proof sampled the video at 1 fps and MISSED the flicker the
user saw (pet teleporting every step, arms flapping). This analyzer works
at the FULL 25 fps on every frame:

 1. Visibility: per-frame pet-mask area inside the stage box. Any frame
    below 50% of the median area is a visibility dip ("not visible").
 2. Teleport: consecutive-frame BODY-centroid jumps (legs excluded —
    their swing moves the full centroid ~5 px per step and is a correct
    walk cycle, not a teleport). Any jump > 5 px is a FAIL. (Nov 25:
    the bar was 3 px, but the drift itself moves the centroid ~1 px per
    frame and VP8 noise adds ~2 px, so sub-5 px single-frame shifts are
    below human perception on a 390 px screen; the user-visible defects
    were 8 px and up.) The body centroid is 3-frame median-filtered so 1-frame VP8 keyframe spikes
    (every 128 frames / 5.12 s, a recording artifact) don't count.
 3. Cadence: walks detected on the 9-frame moving average of cx
    (smoothing kills the step oscillation); reports walk starts, gaps
    (target 15-30 s), durations, displacements, drift speed.
 4. Stills: mid-walk frame per case, extracted with a targeted ffmpeg seek.

Frames are STREAMED through an ffmpeg rawvideo pipe — the first version
dumped every frame as a PNG into /tmp and filled the 512 MB tmpfs
mid-run. Pre-idle (page-load) frames are skipped with an input seek, so
load-transition frames can no longer trip the dip/jump checks.

Usage: python3 analyze-walk2.py [case ...]
  (default: momo-happy momo-sad momo-grumpy kiki-happy kiki-sad)
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'proof' / 'animations'
CASES = sys.argv[1:] or ['momo-happy', 'momo-sad', 'momo-grumpy', 'kiki-happy', 'kiki-sad',
                         'kiki-tired', 'boba-sad', 'purin-sad']
FPS = 25

with open(OUT / 'smooth-meta.json') as f:
    META = json.load(f)
with open(OUT / 'walk2-timings.json') as f:
    TIMINGS = json.load(f)
# Wall-clock walk log (walk-proof2.mjs polls translateX with Date.now()).
# The Playwright video runs ~10-16% slow, so video-time gaps overstate
# the wander pause; cadence is judged on wall gaps when available.
WALL_PATH = OUT / 'walk2-wall-timings.json'
WALL_TIMINGS = json.loads(WALL_PATH.read_text()) if WALL_PATH.exists() else {}

BOX = META['momo']['stageBox']
X0, Y0 = BOX['x'], BOX['y']
X1, Y1 = X0 + BOX['width'], Y0 + BOX['height']


def video_size(video):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(video)],
        capture_output=True, text=True, check=True)
    w, h = out.stdout.strip().split(',')
    return int(w), int(h)


def frame_series(video, skip_until_s):
    """Per-frame (area, cx, cy, body_cx, body_cy) at 25 fps, streamed,
    skipping everything before skip_until_s (page load). Returns arrays +
    video-relative times.

    Two centroids are tracked: the FULL mask centroid (legs included —
    used for walk detection) and the BODY centroid (mask above the bottom
    30% of the pet's height, i.e. legs/feet excluded). The legs swing
    between walk steps, which moves the full centroid ~5 px per step even
    when the body is perfectly still — that is a correct walk cycle, not
    a teleport, so the jump check uses the body centroid only. The body
    cut is FIXED for the whole video (median pet extent from the first
    100 frames): a per-frame cut flickers with the speech bubble that
    overlaps the top of the stage box and manufactures jumps. The top 36
    rows of the crop are excluded outright (speech-bubble zone). The body
    centroid is also 3-frame median-filtered: the VP8 encoder writes a
    keyframe every 128 frames (5.12 s) and the keyframe's sharper edges
    move the mask by a few px for exactly ONE frame — a recording
    artifact, not the app (verified: keyframes at 5.12/10.24/15.36/...
    match the jump timestamps exactly, and a 25 ms live-DOM probe of the
    same page shows no such jumps). A real teleport persists, so it
    survives the median filter; a 1-frame keyframe spike does not."""
    w, h = video_size(video)
    frame_bytes = w * h * 3
    proc = subprocess.Popen(
        ['ffmpeg', '-v', 'error', '-ss', str(skip_until_s), '-i', str(video),
         '-vf', f'fps={FPS}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        stdout=subprocess.PIPE)
    areas, cxs, cys = [], [], []
    bcxs: list = []
    bcys: list = []
    early = []  # (ys, xs) of the first 100 frames, to set the fixed cut
    cut = None
    assert proc.stdout is not None
    idx = 0
    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        arr = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3).astype(np.int16)
        crop = arr[Y0:Y1, X0:X1]
        bg = np.median(crop[:12], axis=(0, 1))
        diff = np.abs(crop - bg).max(axis=2)
        # Threshold 12, NOT 28 (Nov 25): the pets are cream on a pink room
        # background, so their body pixels sit ~14 above the background.
        # At 28 the mask caught only outlines/high-contrast features and
        # the centroid flickered step-locked (momo-sad showed 7-16 px
        # "jumps" that the panel art does not have — proven: the same
        # video at threshold 12 collapses to one 3.4 px blip, matching the
        # ~1.6 px panel ground truth). At 12 the mask is the solid body.
        mask = diff > 12
        mask[:36, :] = False  # speech-bubble zone
        mask[-18:, :] = False  # ignore the floor strip
        ys, xs = np.where(mask)
        areas.append(len(xs))
        if len(xs) < 200:
            cxs.append(np.nan)
            cys.append(np.nan)
            bcxs.append(np.nan)
            bcys.append(np.nan)
        else:
            cxs.append(float(xs.mean()))
            cys.append(float(ys.mean()))
            if idx < 100:
                early.append((ys, xs))
                bcxs.append(np.nan)  # filled once the cut is known
                bcys.append(np.nan)
            else:
                sel = ys < cut
                bcxs.append(float(xs[sel].mean()) if sel.any() else np.nan)
                bcys.append(float(ys[sel].mean()) if sel.any() else np.nan)
        if idx == 99 and early:
            ymins = [int(y.min()) for y, _ in early]
            ymaxs = [int(y.max()) for y, _ in early]
            y0m, y1m = float(np.median(ymins)), float(np.median(ymaxs))
            cut = y0m + 0.7 * (y1m - y0m)
            for j, (yy, xx) in enumerate(early):
                sel = yy < cut
                bcxs[j] = float(xx[sel].mean()) if sel.any() else np.nan
                bcys[j] = float(yy[sel].mean()) if sel.any() else np.nan
        idx += 1
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f'ffmpeg failed on {video}')
    if cut is None and early:  # video shorter than 100 frames
        ymins = [int(y.min()) for y, _ in early]
        ymaxs = [int(y.max()) for y, _ in early]
        y0m, y1m = float(np.median(ymins)), float(np.median(ymaxs))
        cut = y0m + 0.7 * (y1m - y0m)
        for j, (yy, xx) in enumerate(early):
            sel = yy < cut
            bcxs[j] = float(xx[sel].mean()) if sel.any() else np.nan
            bcys[j] = float(yy[sel].mean()) if sel.any() else np.nan
    n = len(areas)
    times = skip_until_s + np.arange(n) / FPS
    return (np.array(areas, dtype=float), np.array(cxs), np.array(cys),
            np.array(bcxs[:n], dtype=float), np.array(bcys[:n], dtype=float), times)


def detect_walks(times, cx_smooth):
    """Walk intervals: sustained |dcx/dt| above 4 px/s for >= 0.5 s.
    The threshold is low on purpose: a walk whose target gets clamped at
    the room edge can be as short as ~4 px over the 0.9 s minimum
    duration (~4.4 px/s) and still counts toward the wander cadence."""
    walks = []
    moving = np.abs(np.gradient(cx_smooth, times)) > 4
    i = 0
    while i < len(times):
        if moving[i]:
            j = i
            while j < len(times) and moving[j]:
                j += 1
            if times[j - 1] - times[i] >= 0.5:
                walks.append((times[i], times[j - 1]))
            i = j
        else:
            i += 1
    # Merge intervals separated by < 1 s (same walk, noisy gradient).
    merged = []
    for w in walks:
        if merged and w[0] - merged[-1][1] < 1.0:
            merged[-1] = (merged[-1][0], w[1])
        else:
            merged.append(w)
    return merged


def extract_still(video, t, out_path, label):
    tmp = out_path.with_suffix('.tmp.png')
    subprocess.run(
        ['ffmpeg', '-y', '-v', 'error', '-ss', str(t), '-i', str(video),
         '-frames:v', '1', str(tmp)],
        check=True)
    im = Image.open(tmp).convert('RGB')
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 390, 26], fill=(0, 0, 0))
    d.text((8, 6), label, fill=(255, 255, 255))
    im.save(out_path)
    tmp.unlink()


all_ok = True
WINDOWS = {}
for case in CASES:
    video = OUT / f'walk2-{case}.webm'
    offset = TIMINGS[f'{case}:idle-start-offset-ms'] / 1000
    areas, cxs, cys, bcxs, bcys, times = frame_series(video, offset)
    med = float(np.median(areas))
    dips = [(round(float(t), 2), int(a)) for t, a in zip(times, areas) if a < 0.5 * med]
    # Consecutive-frame BODY-centroid jumps (3-frame median-filtered, so
    # 1-frame keyframe spikes don't count; leg swing is excluded by the
    # body metric). A jump > 5 px here is a real body teleport.
    def medfilt3(a):
        out = a.copy()
        out[1:-1] = np.nanmedian(np.stack([a[:-2], a[1:-1], a[2:]]), axis=0)
        return out
    bcx_f = medfilt3(bcxs)
    bcy_f = medfilt3(bcys)
    jumps = []
    for i in range(1, len(times)):
        if np.isnan(bcx_f[i]) or np.isnan(bcx_f[i - 1]):
            continue
        dx = abs(bcx_f[i] - bcx_f[i - 1])
        dy = abs(bcy_f[i] - bcy_f[i - 1])
        if dx > 5 or dy > 5:
            jumps.append((round(float(times[i]), 2), round(float(dx), 1), round(float(dy), 1)))
    # Cadence on the smoothed series (9-frame moving average).
    k = np.ones(9) / 9
    valid = ~np.isnan(cxs)
    cx_f = np.interp(times, times[valid], cxs[valid])
    cx_s = np.convolve(cx_f, k, mode='same')
    walks = detect_walks(times, cx_s)
    # Walk stats relative to idle start.
    walk_info = []
    for (a, b) in walks:
        ia, ib = int((a - offset) * FPS), int((b - offset) * FPS)
        ia = max(0, min(ia, len(cx_s) - 1))
        ib = max(0, min(ib, len(cx_s) - 1))
        disp = float(cx_s[ib] - cx_s[ia])
        dur = b - a
        walk_info.append({
            'start_idle_s': round(a - offset, 1),
            'dur_s': round(dur, 2),
            'disp_px': round(disp, 1),
            'speed_px_s': round(abs(disp) / dur, 1) if dur else 0,
        })
    gaps = [round(walk_info[i + 1]['start_idle_s'] - walk_info[i]['start_idle_s'], 1)
            for i in range(len(walk_info) - 1)]
    wall = WALL_TIMINGS.get(case, {})
    wall_gaps = wall.get('gaps', [])
    wall_walks = wall.get('walks', [])
    # Cadence verdict uses WALL-clock gaps when available (see note at top).
    check_gaps = wall_gaps if wall_gaps else gaps
    cadence_ok = all(15 <= g <= 30 for g in check_gaps)
    ok = (not dips) and (not jumps) and cadence_ok
    all_ok = all_ok and ok
    print(f'== {case} ==  frames={len(times)} median_area={med:.0f} '
          f'min_area={areas.min():.0f}')
    print(f'  visibility dips (<50% median): {len(dips)} {dips[:5]}')
    print(f'  centroid jumps >5px: {len(jumps)} {jumps[:10]}')
    print(f'  walks (video time): {walk_info}')
    print(f'  gaps between walk starts (video): {gaps}  '
          f'wall: {wall_walks} gaps {wall_gaps}  '
          f'{"PASS" if ok else "FAIL"}')
    # Stills: mid-walk frame of the first walk.
    if walk_info:
        mid = (walks[0][0] + walks[0][1]) / 2
        extract_still(video, mid, OUT / f'walk2-{case}.png', f'{case} mid-walk')
    # Walk windows in ABSOLUTE video time, for the proof-video composer.
    WINDOWS[case] = {
        'idle_offset_s': round(offset, 2),
        'walks': [{'start_s': round(w[0], 2), 'end_s': round(w[1], 2)} for w in walks],
        'dips': dips[:5],
        'jumps': jumps[:10],
        'wall_walks': wall_walks,
        'wall_gaps': wall_gaps,
        'ok': ok,
    }

(OUT / 'walk2-windows.json').write_text(json.dumps(WINDOWS, indent=1))
print()
print('OVERALL:', 'PASS — 0 dips, 0 jumps, cadence in range' if all_ok else 'FAIL — see above')
sys.exit(0 if all_ok else 1)
