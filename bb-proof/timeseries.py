#!/usr/bin/env python3
"""bb-proof/timeseries.py — metric per frame over time, to find dips at transitions.

Usage: python3 timeseries.py <video.webm> [fps]
Prints timestamp + metric for every frame below 60% of the median (after
skipping the first 2s of page load), plus the overall min/median.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

VIDEO = Path(sys.argv[1])
FPS = int(sys.argv[2]) if len(sys.argv) > 2 else 25
CROP = (80, 150, 230, 245)
BG_PT = (30, 200)


def color_dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ['ffmpeg', '-y', '-v', 'error', '-i', str(VIDEO), '-vf', f'fps={FPS}',
             str(Path(tmp) / '%04d.png')],
            check=True,
        )
        frames = sorted(Path(tmp).glob('*.png'))
        metrics = []
        for f in frames:
            im = Image.open(f).convert('RGB')
            bg = im.getpixel(BG_PT)
            crop = im.crop((CROP[0], CROP[1], CROP[0] + CROP[2], CROP[1] + CROP[3]))
            px = list(crop.getdata())
            diff = sum(1 for p in px if color_dist(p, bg) > 30)
            metrics.append(diff / len(px))
        n = len(metrics)
        med = sorted(metrics)[n // 2]
        print(f'{VIDEO.name}: {n} frames @{FPS}fps, median={med:.3f}')
        # Skip first 2s (page load), then list dips.
        dips = [(i, m) for i, m in enumerate(metrics) if i / FPS > 2.0 and m < 0.6 * med]
        print(f'  dips below 60% of median (after 2s): {len(dips)}')
        for i, m in dips:
            print(f'    t={i / FPS:5.2f}s frame={i:4d} metric={m:.3f} ({100 * m / med:.0f}% of median)')


if __name__ == '__main__':
    main()
