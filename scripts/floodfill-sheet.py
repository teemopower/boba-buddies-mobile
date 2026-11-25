#!/usr/bin/env python3
"""scripts/floodfill-sheet.py — turn a generated white-background sprite
sheet into a transparent RGBA sheet matching the existing assets/pets sheets.

Same technique as the original sheet pipeline (Nov 22-23): border
flood-fill converts only white connected to the image border to
transparent, so cream pet bodies enclosed by their dark outline are kept,
while the white gaps between panels become transparent.

Usage: python3 scripts/floodfill-sheet.py <input> <output> [size=1600]
Prints size, transparent fraction, and per-quadrant opaque bounding boxes
(to catch art bleeding across the 2x2 panel midlines).
"""
import sys
from PIL import Image, ImageDraw

SRC, DST = sys.argv[1], sys.argv[2]
SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 1600

im = Image.open(SRC).convert('RGBA')
if im.size[0] != im.size[1]:
    side = min(im.size)
    im = im.crop(((im.size[0] - side) // 2, (im.size[1] - side) // 2,
                  (im.size[0] + side) // 2, (im.size[1] + side) // 2))
if im.size != (SIZE, SIZE):
    im = im.resize((SIZE, SIZE), Image.LANCZOS)

rgb = im.convert('RGB')
# Flood-fill the border-connected near-white region: paste the art onto a
# white canvas, then flood-fill black from the four corners (threshold 32
# around the white seed) and use the filled area as the transparency mask.
work = Image.new('RGB', (SIZE, SIZE), (255, 255, 255))
work.paste(rgb, (0, 0))
d = ImageDraw.Draw(work)
for seed in [(0, 0), (SIZE - 1, 0), (0, SIZE - 1), (SIZE - 1, SIZE - 1)]:
    ImageDraw.floodfill(work, seed, (0, 0, 0), thresh=32)
filled = work.convert('L').point(lambda v: 255 if v == 0 else 0)

alpha = im.split()[3]
# Keep existing alpha, zero out flood-filled (border-connected white) pixels.
new_alpha = Image.composite(
    Image.new('L', (SIZE, SIZE), 0), alpha, filled)
im.putalpha(new_alpha)
im.save(DST)

px = list(new_alpha.getdata())
transparent = sum(1 for v in px if v == 0) / len(px)
print(f'{DST}: {im.size} RGBA, transparent={transparent:.1%}')
half = SIZE // 2
quads = [(0, 0), (half, 0), (0, half), (half, half)]
names = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
for (qx, qy), name in zip(quads, names):
    xs, ys = [], []
    for y in range(qy, qy + half, 2):
        for x in range(qx, qx + half, 2):
            if new_alpha.getpixel((x, y)) > 16:
                xs.append(x - qx)
                ys.append(y - qy)
    if not xs:
        print(f'  {name}: EMPTY — no opaque content!')
        continue
    print(f'  {name}: opaque bbox x[{min(xs)}..{max(xs)}] y[{min(ys)}..{max(ys)}] '
          f'(panel 0..{half - 1})')
    for edge, val in [('left', min(xs)), ('right', max(xs)),
                      ('top', min(ys)), ('bottom', max(ys))]:
        if edge in ('left', 'top') and val < 6:
            print(f'    WARNING: content touches {edge} edge ({val}px)')
        if edge in ('right', 'bottom') and val > half - 7:
            print(f'    WARNING: content touches {edge} edge ({val}px)')
