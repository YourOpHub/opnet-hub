"""Crop icons from Gemini_Generated_Image_fkn8z7fkn8z7fkn8.png (2816x1536)

Layout (verified via pixel analysis):
- Hero: x=23-822, y=35-865 (dark bg)
- Small icons: 5 cols x 2 rows, right of hero
  - Row 1: y=35-435 (before text labels at y~443)
  - Row 2: y=500-820 (after text labels, avoiding artifacts)
  - Columns: x=860-2730, each ~374px wide
- Bottom: 5 items, y=1010-1420
  - White column gaps at x: 635-654, 1267-1287, 1901-1923, 2346-2378
"""
from PIL import Image
import numpy as np
import os

SRC = 'public/Gemini_Generated_Image_fkn8z7fkn8z7fkn8.png'
OUT = 'public/icons'
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC)

# === SMALL ICON GRID ===
ICON_X_START = 860
ICON_X_END = 2730
COL_W = (ICON_X_END - ICON_X_START) // 5  # 374

ROW1_Y = (35, 435)   # Before text labels
ROW2_Y = (500, 820)  # After text labels (was 480, pushed to 500 to avoid artifacts)

def get_icon_box(col, row_y):
    x1 = ICON_X_START + col * COL_W
    x2 = x1 + COL_W
    return (x1, row_y[0], x2, row_y[1])

# === BOTTOM ROW (exact boundaries from white-column analysis) ===
BOT_Y = (1010, 1420)
# Gaps: 635-654, 1267-1287, 1901-1923, 2346-2378
BOTTOM_ITEMS = {
    'empty-orders': (22, BOT_Y[0], 634, BOT_Y[1]),
    'empty-vault':  (655, BOT_Y[0], 1266, BOT_Y[1]),
    # skip col 3 (1288-1900) = empty-vault duplicate
    'token-mine':   (1924, BOT_Y[0], 2345, BOT_Y[1]),
    'token-vibe':   (2379, BOT_Y[0], 2792, BOT_Y[1]),
}

# === ALL REGIONS ===
REGIONS = {
    'hero-illustration': (23, 35, 822, 865),

    # Row 1: swap, stake, build, mine, (skip mine-variant)
    'icon-swap':  get_icon_box(0, ROW1_Y),
    'icon-stake': get_icon_box(1, ROW1_Y),
    'icon-build': get_icon_box(2, ROW1_Y),
    'icon-mine':  get_icon_box(3, ROW1_Y),

    # Row 2: market, tools, multisend, xchain, news
    'icon-market':    get_icon_box(0, ROW2_Y),
    'icon-tools':     get_icon_box(1, ROW2_Y),
    'icon-multisend': get_icon_box(2, ROW2_Y),
    'icon-xchain':    get_icon_box(3, ROW2_Y),
    'icon-news':      get_icon_box(4, ROW2_Y),

    # Bottom row (exact boundaries)
    **BOTTOM_ITEMS,
}


def trim_to_content(img_rgba, threshold=240, pad=4):
    """Trim whitespace/near-white from edges."""
    arr = np.array(img_rgba)
    if arr.shape[2] == 4:
        content_mask = (arr[:,:,:3].mean(axis=2) < threshold) | (arr[:,:,3] < 250)
    else:
        content_mask = arr[:,:,:3].mean(axis=2) < threshold

    rows = np.any(content_mask, axis=1)
    cols = np.any(content_mask, axis=0)

    if not rows.any() or not cols.any():
        return img_rgba

    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]

    rmin = max(0, rmin - pad)
    rmax = min(arr.shape[0] - 1, rmax + pad)
    cmin = max(0, cmin - pad)
    cmax = min(arr.shape[1] - 1, cmax + pad)

    return img_rgba.crop((cmin, rmin, cmax + 1, rmax + 1))


def make_white_transparent(img_rgba, threshold=235):
    """Make near-white pixels transparent (for white-bg icons)."""
    arr = np.array(img_rgba)
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    white_mask = (r > threshold) & (g > threshold) & (b > threshold)
    arr[white_mask, 3] = 0
    return Image.fromarray(arr)


def center_on_square(img_rgba, size=None):
    """Center image on a square transparent canvas."""
    w, h = img_rgba.size
    if size is None:
        size = max(w, h)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(img_rgba, ((size - w) // 2, (size - h) // 2), img_rgba)
    return canvas


# White-background icons need transparency
WHITE_BG = {
    'icon-swap', 'icon-stake', 'icon-build', 'icon-mine',
    'icon-market', 'icon-tools', 'icon-multisend', 'icon-xchain', 'icon-news',
}

# Dark-background icons (no transparency conversion)
DARK_BG = {'hero-illustration', 'empty-orders', 'empty-vault'}

# Token coins — white bg around the coin but coin itself is dark
TOKEN_ICONS = {'token-mine', 'token-vibe'}

# Target sizes
SIZE_SMALL = 256   # Feature card icons
SIZE_LARGE = 512   # Hero, empty states, tokens


for name, box in REGIONS.items():
    print(f'\n--- {name} ---')
    print(f'  Region: {box}')

    crop = img.crop(box).convert('RGBA')

    # White-to-transparent for appropriate icons
    if name in WHITE_BG or name in TOKEN_ICONS:
        crop = make_white_transparent(crop)

    # Trim: use appropriate threshold
    if name in DARK_BG:
        trimmed = trim_to_content(crop, threshold=30, pad=2)
    else:
        # After making white transparent, trim transparent edges
        trimmed = trim_to_content(crop, threshold=240, pad=4)

    print(f'  Trimmed: {trimmed.size}')

    # Target size
    target = SIZE_SMALL if name.startswith('icon-') else SIZE_LARGE

    # Center on square, resize
    centered = center_on_square(trimmed)
    if centered.size[0] != target:
        centered = centered.resize((target, target), Image.LANCZOS)

    out_path = os.path.join(OUT, f'{name}.png')
    centered.save(out_path, 'PNG')
    print(f'  Saved: {target}x{target}')

print('\n=== All icons cropped ===')
for f in sorted(os.listdir(OUT)):
    print(f'  {f}: {os.path.getsize(os.path.join(OUT, f)):,} bytes')
