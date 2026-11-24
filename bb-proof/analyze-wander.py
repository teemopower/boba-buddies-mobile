#!/usr/bin/env python3
"""Analyze smooth-<pet>.webm videos for the Nov 24 wander proof.

For each video, extract frames at 5 fps over the idle window (the first
~7 s, when the pet is idle and wandering), mask the pet silhouette
against the room background inside the pet-stage box (from
smooth-meta.json, expanded horizontally by the wander range), and report
the pet's centroid x per frame. A wandering pet's centroid range must be
> 20 px; a stationary pet stays within a few px.
Also extracts a 3-frame wander contact strip (t=1s, 3s, 5.5s) per pet.
Usage: python3 analyze-wander.py [pet ...]
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "proof", "animations")
# Usage: VIDEO_PREFIX=wander-check START=3 END=16 python3 analyze-wander.py [pet ...]
VIDEO_PREFIX = os.environ.get("VIDEO_PREFIX", "smooth")
START = float(os.environ.get("START", "0"))
END = float(os.environ.get("END", "7"))
PETS = [a for a in sys.argv[1:] if not a.startswith("-")] or [
    "momo", "kiki", "boba", "yuki", "taro",
    "purin", "sora", "miso", "hana", "nori",
]

with open(os.path.join(OUT, "smooth-meta.json")) as f:
    meta = json.load(f)

os.makedirs("/tmp/bb-wander", exist_ok=True)


def frames(video, fps=5, start=START, end=END):
    d = f"/tmp/bb-wander/{VIDEO_PREFIX}-{os.path.basename(video)}-frames"
    os.makedirs(d, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", video,
         "-vf", f"fps={fps}", "-ss", str(start), "-t", str(end - start),
         f"{d}/f%03d.png"],
        check=True,
    )
    return sorted(os.path.join(d, f) for f in os.listdir(d))


def centroid_x(img, box):
    """box = (x0, y0, x1, y1) in video px. Mask = pixels far from the room bg."""
    crop = img.crop(box)
    arr = np.array(crop).astype(np.int16)
    # Room bg: median of the top 12 rows of the crop (above the pet).
    bg = np.median(arr[:12], axis=(0, 1))
    diff = np.abs(arr - bg).max(axis=2)
    mask = diff > 28
    # Ignore the floor strip at the bottom of the room (solid band).
    mask[-18:, :] = False
    ys, xs = np.where(mask)
    if len(xs) < 200:
        return None, 0
    return float(xs.mean()), int(len(xs))


for pet in PETS:
    video = os.path.join(OUT, f"{VIDEO_PREFIX}-{pet}.webm")
    box = meta[pet]["stageBox"]
    # Video is 390x844 (CSS px); stage box is in the same coordinates.
    # Expand horizontally by the wander range + margin.
    x0 = max(0, int(box["x"]) - 80)
    x1 = min(390, int(box["x"] + box["width"]) + 80)
    y0 = max(0, int(box["y"]) - 10)
    y1 = min(844, int(box["y"] + box["height"]) + 10)
    xs = []
    flist = frames(video)
    for i, f in enumerate(flist):
        img = Image.open(f).convert("RGB")
        cx, n = centroid_x(img, (x0, y0, x1, y1))
        if cx is not None:
            xs.append((START + i * 0.2, cx))
    if not xs:
        print(f"{pet:6} NO PET MASK FOUND")
        continue
    vals = [c for _, c in xs]
    print(
        f"{pet:6} centroid-x range {min(vals):6.1f}..{max(vals):6.1f} "
        f"(span {max(vals) - min(vals):5.1f}px over {len(xs)} frames) "
        f"{'WANDERS' if max(vals) - min(vals) > 20 else 'STATIONARY?'}"
    )
    # Contact strip: frames at ~15%, 50%, 85% of the analyzed window.
    picks = [flist[int(len(flist) * f)] for f in (0.15, 0.5, 0.85) if flist]
    strip = Image.new("RGB", (390 * len(picks), 844), (255, 255, 255))
    for j, p in enumerate(picks):
        strip.paste(Image.open(p).convert("RGB"), (390 * j, 0))
    strip.save(os.path.join(OUT, f"wander-{pet}-strip.png"))
print("strips saved to proof/animations/wander-<pet>-strip.png")
