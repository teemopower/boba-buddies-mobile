#!/usr/bin/env python3
"""bb-proof/analyze.py — check every video frame for a missing pet.

Extracts frames at 10 fps from a proof video, crops the pet-stage region,
and measures how much of the crop differs from the room background color.
A frame where the pet vanished shows (almost) only background, so its
metric collapses toward zero. Prints the metric distribution and flags
any frame below 25% of the median metric as BLANK.

Usage: python3 analyze.py <video.webm> [crop x y w h] [bg x y]
Defaults are calibrated for a 390x844 video of the Room screen.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

VIDEO = Path(sys.argv[1])
# Stage crop (1x coords, 390x844 video): sprite is ~230px wide, centered.
CROP = tuple(int(v) for v in sys.argv[2].split(',')) if len(sys.argv) > 2 else (80, 150, 230, 245)
BG_PT = tuple(int(v) for v in sys.argv[3].split(',')) if len(sys.argv) > 3 else (30, 200)


def extract(video, outdir, fps=10):
    subprocess.run(
        ['ffmpeg', '-y', '-v', 'error', '-i', str(video), '-vf', f'fps={fps}',
         str(Path(outdir) / '%04d.png')],
        check=True,
    )
    return sorted(Path(outdir).glob('*.png'))


def color_dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        frames = extract(VIDEO, tmp)
        metrics = []
        for f in frames:
            im = Image.open(f).convert('RGB')
            bg = im.getpixel(BG_PT)
            crop = im.crop((CROP[0], CROP[1], CROP[0] + CROP[2], CROP[1] + CROP[3]))
            px = list(crop.getdata())
            diff = sum(1 for p in px if color_dist(p, bg) > 30)
            metrics.append(diff / len(px))
        metrics.sort()
        n = len(metrics)
        median = metrics[n // 2]
        p10 = metrics[n // 10]
        minimum = metrics[0]
        threshold = 0.25 * median
        blanks = [i for i, m in enumerate(metrics) if m < threshold]
        print(f'{VIDEO.name}: {n} frames @10fps | median={median:.3f} p10={p10:.3f} min={minimum:.3f} threshold={threshold:.3f}')
        if blanks:
            print(f'  BLANK frames: {len(blanks)} at indexes {blanks[:20]}')
        else:
            print('  BLANK frames: 0')
        return 1 if blanks else 0


if __name__ == '__main__':
    sys.exit(main())
