#!/usr/bin/env python3
"""scripts/floodfill-sheet.py — turn a generated white-background sprite
sheet into a transparent RGBA sheet matching the existing assets/pets sheets.

Same technique as the original sheet pipeline (Nov 22-23): border
flood-fill converts only white connected to the image border to
transparent, so cream pet bodies enclosed by their dark outline are kept,
while the white gaps between panels become transparent.

Usage: python3 scripts/floodfill-sheet.py <input> <output> [width [height [cols [rows]]]]
  One size arg = square sheet (legacy 2x2 behaviour). Rect sheets
  (e.g. a 2400x1600 3x2 walks sheet) pass width, height, cols, rows.
Prints size, transparent fraction, and per-panel opaque bounding boxes
(to catch art bleeding across the panel midlines).
"""
import sys
from PIL import Image, ImageDraw

SRC, DST = sys.argv[1], sys.argv[2]
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 1600
HEIGHT = int(sys.argv[4]) if len(sys.argv) > 4 else WIDTH
COLS = int(sys.argv[5]) if len(sys.argv) > 5 else 2
ROWS = int(sys.argv[6]) if len(sys.argv) > 6 else 2
SIZE = (WIDTH, HEIGHT)

im = Image.open(SRC).convert('RGBA')
if im.size != SIZE:
    # Keep aspect: centre-crop to the target ratio, then resize.
    tw, th = SIZE
    sw, sh = im.size
    if sw / sh > tw / th:
        nw = int(sh * tw / th)
        x0 = (sw - nw) // 2
        im = im.crop((x0, 0, x0 + nw, sh))
    else:
        nh = int(sw * th / tw)
        y0 = (sh - nh) // 2
        im = im.crop((0, y0, sw, y0 + nh))
    im = im.resize(SIZE, Image.LANCZOS)

rgb = im.convert('RGB')
# Flood-fill the border-connected near-white region: paste the art onto a
# white canvas, then flood-fill black from the four corners (threshold 32
# around the white seed) and use the filled area as the transparency mask.
work = Image.new('RGB', SIZE, (255, 255, 255))
work.paste(rgb, (0, 0))
d = ImageDraw.Draw(work)
for seed in [(0, 0), (SIZE[0] - 1, 0), (0, SIZE[1] - 1), (SIZE[0] - 1, SIZE[1] - 1)]:
    ImageDraw.floodfill(work, seed, (0, 0, 0), thresh=32)
filled = work.convert('L').point(lambda v: 255 if v == 0 else 0)

alpha = im.split()[3]
# Keep existing alpha, zero out flood-filled (border-connected white) pixels.
new_alpha = Image.composite(
    Image.new('L', SIZE, 0), alpha, filled)
im.putalpha(new_alpha)
im.save(DST)

px = list(new_alpha.getdata())
transparent = sum(1 for v in px if v == 0) / len(px)
print(f'{DST}: {im.size} RGBA, transparent={transparent:.1%}')
pw, ph = WIDTH // COLS, HEIGHT // ROWS
for r in range(ROWS):
    for c in range(COLS):
        qx, qy = c * pw, r * ph
        name = f'panel (col {c}, row {r})'
        xs, ys = [], []
        for y in range(qy, qy + ph, 2):
            for x in range(qx, qx + pw, 2):
                if new_alpha.getpixel((x, y)) > 16:
                    xs.append(x - qx)
                    ys.append(y - qy)
        if not xs:
            print(f'  {name}: EMPTY — no opaque content!')
            continue
        print(f'  {name}: opaque bbox x[{min(xs)}..{max(xs)}] y[{min(ys)}..{max(ys)}] '
              f'(panel 0..{pw - 1} x 0..{ph - 1})')
        for edge, val in [('left', min(xs)), ('right', max(xs)),
                          ('top', min(ys)), ('bottom', max(ys))]:
            lim = pw - 1 if edge in ('left', 'right') else ph - 1
            if edge in ('left', 'top') and val < 6:
                print(f'    WARNING: content touches {edge} edge ({val}px)')
            if edge in ('right', 'bottom') and val > lim - 6:
                print(f'    WARNING: content touches {edge} edge ({val}px)')
