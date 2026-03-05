"""Crop icons v5 — content-aware cropping with proper centering.
Find actual content bbox, pad uniformly, clamp to per-icon tile boundaries.
Image: Gemini_Generated_Image_h5w5s5h5w5s5h5w5.png (2816x1536)

Grid separator bands (brightness ~80-90):
  Top border:       y=0-35
  Row 1 tiles:      y=36-419
  Text labels:      y=420-539
  Row 2 tiles:      y=540-879
  Text/separator:   y=880-974
  Bottom tiles:     y=975-1458
  Bottom border:    y=1459+

  Hero col:         x=0-821
  Vert separator:   x=822-849
  Col separators:   x=1223-1244, x=1618-1641, x=2003-2024, x=2398-2424
  Bot separators:   x=633-657, x=1265-1291, x=1899-1925, x=2343-2381
  Right border:     x=2792-2816
"""
from PIL import Image
import numpy as np
import os

SRC = 'public/Gemini_Generated_Image_h5w5s5h5w5s5h5w5.png'
OUT = 'public/icons'
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC)
arr = np.array(img)
gray = arr[:,:,:3].mean(axis=2)
H, W = arr.shape[:2]


def find_content_bbox(x1, y1, x2, y2, threshold=40):
    """Find bounding box of non-dark content within a region."""
    region = gray[y1:y2, x1:x2]
    content = region > threshold
    rows = np.any(content, axis=1)
    cols = np.any(content, axis=0)
    if not rows.any() or not cols.any():
        return (x1, y1, x2, y2)
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    return (x1 + cmin, y1 + rmin, x1 + cmax + 1, y1 + rmax + 1)


def center_on_square(pil_img):
    w, h = pil_img.size
    size = max(w, h)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(pil_img, ((size - w) // 2, (size - h) // 2))
    return canvas


# (search_x1, search_y1, search_x2, search_y2, clamp_x1, clamp_y1, clamp_x2, clamp_y2)
# search = area to find content, clamp = max extent of padded crop
ICONS = {
    # Hero — full left column
    'hero-illustration': (5, 40, 818, 868,       0, 36, 821, 870),

    # Row 1 — inside column separators, y=55-405 safe zone
    'icon-swap':  (855, 55, 1220, 405,            850, 50, 1220, 410),
    'icon-stake': (1245, 55, 1615, 405,           1245, 50, 1615, 410),
    'icon-build': (1642, 55, 2000, 405,           1642, 50, 2000, 410),
    'icon-mine':  (2025, 55, 2395, 405,           2025, 50, 2395, 410),

    # Row 2 — inside column separators, y=555-865 safe zone
    'icon-market':    (855, 555, 1220, 865,       850, 550, 1220, 870),
    'icon-tools':     (1245, 555, 1615, 865,      1245, 550, 1615, 870),
    'icon-multisend': (1642, 555, 2000, 865,      1642, 550, 2000, 870),
    'icon-xchain':    (2025, 555, 2395, 865,      2025, 550, 2395, 870),
    'icon-news':      (2425, 555, 2790, 865,      2425, 550, 2790, 870),

    # Bottom row — fixed crop boxes (between separator bands)
    # Illustrations: full tile area (y=1005-1450, skip top separator)
    # Coins: tighter crop to center the coin (y=1020-1445)
    'empty-orders': (5, 1010, 625, 1450,           0, 1005, 628, 1455),
    'empty-vault':  (1298, 1010, 1892, 1450,      1295, 1005, 1895, 1455),
    'token-mine':   (1930, 1020, 2338, 1445,      1926, 1015, 2342, 1450),
    'token-vibe':   (2388, 1020, 2785, 1445,      2382, 1015, 2790, 1450),
}

PAD = 10


for name, bounds in ICONS.items():
    sx1, sy1, sx2, sy2, cx1, cy1, cx2, cy2 = bounds
    print(f'\n=== {name} ===')

    # Find actual content within search area
    bx1, by1, bx2, by2 = find_content_bbox(sx1, sy1, sx2, sy2, threshold=40)
    bw, bh = bx2 - bx1, by2 - by1
    print(f'  Content: ({bx1},{by1})-({bx2},{by2}) = {bw}x{bh}')

    # Add padding, clamp to tile bounds
    px1 = max(cx1, bx1 - PAD)
    py1 = max(cy1, by1 - PAD)
    px2 = min(cx2, bx2 + PAD)
    py2 = min(cy2, by2 + PAD)
    pw, ph = px2 - px1, py2 - py1
    print(f'  Crop:    ({px1},{py1})-({px2},{py2}) = {pw}x{ph}')

    # Crop, center, resize
    crop = img.crop((px1, py1, px2, py2)).convert('RGBA')
    centered = center_on_square(crop)
    centered = centered.resize((512, 512), Image.LANCZOS)

    path = os.path.join(OUT, f'{name}.png')
    centered.save(path, 'PNG')
    print(f'  Saved: 512x512')

print('\n=== ALL DONE ===')
for f in sorted(os.listdir(OUT)):
    sz = os.path.getsize(os.path.join(OUT, f))
    print(f'  {f}: {sz:,} bytes')
