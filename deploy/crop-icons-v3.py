"""Crop icons v3 — exact content bboxes from pixel analysis + generous padding.

Image: Gemini_Generated_Image_fkn8z7fkn8z7fkn8.png (2816x1536)

Icon bounding boxes detected via non-white pixel analysis:
Row 1 (neon icons):
  Col 0 (swap):   x=907-1166,  y=99-360
  Col 1 (stake):  x=1292-1572, y=87-377
  Col 2 (build):  x=1704-1940, y=101-355
  Col 3 (mine):   x=2090-2340, y=98-363
  Col 4 (skip):   duplicate mine variant

Row 2 (neon icons):
  Col 0 (market):    x=889-1186, y=443-851
  Col 1 (tools):     x=1294-1566, y=442-862
  Col 2 (multisend): x=1674-1965, y=442-862
  Col 3 (xchain):    x=2067-2353, y=442-869
  Col 4 (news):      x=2475-2733, y=442-864

Bottom row (white column gaps at x: 635-654, 1267-1287, 1901-1923, 2346-2378):
  empty-orders: x=22-634
  empty-vault:  x=655-1266
  (skip duplicate vault)
  token-mine:   x=1924-2345
  token-vibe:   x=2379-2792
  y: 1010-1420

Hero: x=23-822, y=35-865
"""
from PIL import Image
import numpy as np
import os

SRC = 'public/Gemini_Generated_Image_fkn8z7fkn8z7fkn8.png'
OUT = 'public/icons'
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC)
W, H = img.size

PAD = 40  # generous padding

def pad_box(x1, y1, x2, y2, top=PAD, bot=PAD, left=PAD, right=PAD):
    """Add directional padding and clamp to image bounds."""
    return (max(0, x1 - left), max(0, y1 - top), min(W, x2 + right), min(H, y2 + bot))


# Row 1 icons: text labels START below y~370-380, so cap bottom at y=380
# Row 2 icons: text labels END above y~485, so cap top at y=488
# Row 2 icons: glow fades by y~855, text labels below y~830, cap bottom at y=870

ICONS = {
    # Row 1 — pad all sides except bottom (text labels below)
    'icon-swap':  pad_box(907, 99, 1166, 360,   top=50, bot=20, left=50, right=50),
    'icon-stake': pad_box(1292, 87, 1572, 377,   top=50, bot=15, left=50, right=50),
    'icon-build': pad_box(1704, 101, 1940, 355,  top=50, bot=20, left=50, right=50),
    'icon-mine':  pad_box(2090, 98, 2340, 363,   top=50, bot=20, left=50, right=50),

    # Row 2 — NO padding on top (text labels above), generous elsewhere
    # Text labels for row 1 end at ~y=478, icon glow starts ~y=490
    'icon-market':    (849, 488, 1226, 870),
    'icon-tools':     (1254, 488, 1606, 870),
    'icon-multisend': (1634, 488, 2005, 870),
    'icon-xchain':    (2027, 488, 2393, 870),
    'icon-news':      (2435, 488, 2773, 870),

    # Hero — dark bg
    'hero-illustration': (23, 35, 822, 865),

    # Bottom row — exact boundaries from white-column analysis
    'empty-orders': (22, 1010, 634, 1420),
    'empty-vault':  (655, 1010, 1266, 1420),
    'token-mine':   (1924, 1010, 2345, 1420),
    'token-vibe':   (2379, 1010, 2792, 1420),
}

# Categories
NEON_ICONS = {'icon-swap', 'icon-stake', 'icon-build', 'icon-mine',
              'icon-market', 'icon-tools', 'icon-multisend', 'icon-xchain', 'icon-news'}
DARK_BG = {'hero-illustration', 'empty-orders', 'empty-vault'}
TOKEN_COINS = {'token-mine', 'token-vibe'}

# Sizes
SIZE_SMALL = 256
SIZE_LARGE = 512


def make_white_transparent(img_rgba, threshold=245):
    """Make near-white pixels transparent. Higher threshold = preserve more glow."""
    arr = np.array(img_rgba)
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    white = (r > threshold) & (g > threshold) & (b > threshold)
    arr[white, 3] = 0
    return Image.fromarray(arr)


def trim_transparent(img_rgba, pad=6):
    """Trim fully transparent edges."""
    arr = np.array(img_rgba)
    alpha = arr[:,:,3]
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    if not rows.any() or not cols.any():
        return img_rgba
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    rmin = max(0, rmin - pad)
    rmax = min(arr.shape[0] - 1, rmax + pad)
    cmin = max(0, cmin - pad)
    cmax = min(arr.shape[1] - 1, cmax + pad)
    return img_rgba.crop((cmin, rmin, cmax + 1, rmax + 1))


def trim_dark(img_rgba, threshold=30, pad=4):
    """Trim near-black edges (for dark-bg images)."""
    arr = np.array(img_rgba)
    content = arr[:,:,:3].mean(axis=2) > threshold
    rows = np.any(content, axis=1)
    cols = np.any(content, axis=0)
    if not rows.any() or not cols.any():
        return img_rgba
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    rmin = max(0, rmin - pad)
    rmax = min(arr.shape[0] - 1, rmax + pad)
    cmin = max(0, cmin - pad)
    cmax = min(arr.shape[1] - 1, cmax + pad)
    return img_rgba.crop((cmin, rmin, cmax + 1, rmax + 1))


def center_on_square(img_rgba):
    """Center on square transparent canvas (max dimension)."""
    w, h = img_rgba.size
    size = max(w, h)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(img_rgba, ((size - w) // 2, (size - h) // 2), img_rgba)
    return canvas


for name, box in ICONS.items():
    print(f'\n=== {name} ===')
    print(f'  Crop region: {box}')

    crop = img.crop(box).convert('RGBA')
    print(f'  Raw crop: {crop.size}')

    if name in NEON_ICONS or name in TOKEN_COINS:
        crop = make_white_transparent(crop, threshold=245)
        trimmed = trim_transparent(crop, pad=4)
    elif name in DARK_BG:
        trimmed = trim_dark(crop, threshold=30, pad=2)
    else:
        trimmed = crop

    print(f'  After trim: {trimmed.size}')

    # Center on square
    centered = center_on_square(trimmed)

    # Resize to target
    target = SIZE_SMALL if name.startswith('icon-') else SIZE_LARGE
    if centered.size[0] != target:
        centered = centered.resize((target, target), Image.LANCZOS)

    path = os.path.join(OUT, f'{name}.png')
    centered.save(path, 'PNG')
    print(f'  Saved: {path} ({target}x{target})')

print('\n=== ALL DONE ===')
for f in sorted(os.listdir(OUT)):
    sz = os.path.getsize(os.path.join(OUT, f))
    print(f'  {f}: {sz:,} bytes')
