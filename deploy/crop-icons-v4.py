"""Crop icons v4 — simple tile extraction, no bg processing.
User: just crop centered, they'll handle bg themselves.

Image: Gemini_Generated_Image_h5w5s5h5w5s5h5w5.png (2816x1536)
"""
from PIL import Image
import os

SRC = 'public/Gemini_Generated_Image_h5w5s5h5w5s5h5w5.png'
OUT = 'public/icons'
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC)

# All boxes: (left, top, right, bottom)
# Row 1 icons: y=95-380, Row 2 icons: y=555-845
# Icon columns: C1=905-1167, C2=1291-1574, C3=1704-1946, C4=2084-2346, C5=2464-2744

ICONS = {
    'hero-illustration': (24, 38, 748, 865),

    # Row 1
    'icon-swap':  (905, 95, 1167, 380),
    'icon-stake': (1291, 95, 1574, 380),
    'icon-build': (1704, 95, 1946, 380),
    'icon-mine':  (2084, 95, 2346, 380),

    # Row 2
    'icon-market':    (905, 555, 1167, 845),
    'icon-tools':     (1291, 555, 1574, 845),
    'icon-multisend': (1704, 555, 1946, 845),
    'icon-xchain':    (2084, 555, 2346, 845),
    'icon-news':      (2464, 555, 2744, 845),

    # Bottom row: y=1010-1450, col gaps at x: ~635, ~1268, ~1900, ~2348
    'empty-orders': (20, 1010, 634, 1450),
    'empty-vault':  (1288, 1010, 1900, 1450),  # open vault (col 3)
    'token-mine':   (1923, 1010, 2347, 1450),
    'token-vibe':   (2379, 1010, 2795, 1450),
}


def center_on_square(pil_img):
    w, h = pil_img.size
    size = max(w, h)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(pil_img, ((size - w) // 2, (size - h) // 2))
    return canvas


for name, box in ICONS.items():
    crop = img.crop(box).convert('RGBA')
    centered = center_on_square(crop)
    centered = centered.resize((512, 512), Image.LANCZOS)

    path = os.path.join(OUT, f'{name}.png')
    centered.save(path, 'PNG')
    print(f'{name}: {crop.size} -> 512x512')

print('\nDone!')
for f in sorted(os.listdir(OUT)):
    print(f'  {f}: {os.path.getsize(os.path.join(OUT, f)):,} bytes')
