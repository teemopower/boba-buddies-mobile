from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random

OUT = '.'
# ---------- feature graphic 1024x500 ----------
W, H = 1024, 500
# vertical gradient: soft cream-pink top -> deeper pink bottom (app theme)
top = (253, 243, 246)   # #FDF3F6
bot = (249, 198, 216)   # #F9C6D8
bg = Image.new('RGB', (W, H))
px = bg.load()
for y in range(H):
    t = y / (H - 1)
    px_x = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    for x in range(W):
        px[x, y] = px_x
# soft decorative circles (very light, low contrast)
ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(ov)
random.seed(7)
for _ in range(14):
    r = random.randint(14, 46)
    x = random.randint(-20, W - 20)
    y = random.randint(0, H - 20)
    d.ellipse([x, y, x + 2 * r, y + 2 * r], fill=(255, 255, 255, 26))
ov = ov.filter(ImageFilter.GaussianBlur(6))
bg = Image.alpha_composite(bg.convert('RGBA'), ov)

d = ImageDraw.Draw(bg)
title_font = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoSans-Black.ttf', 104)
title = 'Boba Buddies'
# soft white halo behind the title for readability
bbox = d.textbbox((0, 0), title, font=title_font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
tx, ty = (W - tw) // 2, 34
d.text((tx + 3, ty + 4), title, font=title_font, fill=(255, 255, 255, 200))
d.text((tx, ty), title, font=title_font, fill=(164, 74, 94, 255))  # brand #A44A5E

# five pets in a row along the bottom
pets = ['momo', 'kiki', 'boba', 'yuki', 'hana']
size = 200
gap = 6
total = len(pets) * size + (len(pets) - 1) * gap
x0 = (W - total) // 2
y0 = H - size - 12
for i, pet in enumerate(pets):
    im = Image.open(f'../assets/pets/{pet}.png').convert('RGBA')
    im = im.resize((size, size), Image.LANCZOS)
    bg.paste(im, (x0 + i * (size + gap), y0), im)
bg.convert('RGB').save(f'{OUT}/feature-graphic-1024x500.png')

# ---------- icon 512x512 ----------
icon = Image.open('../assets/icon.png').convert('RGB')
icon = icon.resize((512, 512), Image.LANCZOS)
icon.save(f'{OUT}/icon-512x512.png')
print('done')
