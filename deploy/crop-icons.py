"""
Final icon crop script — precise coordinates from pixel analysis.
"""
from PIL import Image
import os

src = Image.open('C:/vibe/public/Gemini_Generated_Image_j6ttlzj6ttlzj6tt.png')
out = 'C:/vibe/public/icons'
os.makedirs(out, exist_ok=True)

def trim_and_center(img, target_size, pad=8):
    """Remove whitespace/transparency, center on transparent canvas."""
    # Get bounding box of non-transparent content
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Find non-transparent, non-white pixels
    pixels = img.load()
    w, h = img.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 20 and not (r > 240 and g > 240 and b > 240):
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)

    if max_x <= min_x or max_y <= min_y:
        return img.resize((target_size, target_size), Image.LANCZOS)

    # Crop to content
    cropped = img.crop((min_x, min_y, max_x + 1, max_y + 1))
    cw, ch = cropped.size

    # Scale to fit target with padding
    inner = target_size - pad * 2
    scale = min(inner / cw, inner / ch)
    new_w = int(cw * scale)
    new_h = int(ch * scale)
    scaled = cropped.resize((new_w, new_h), Image.LANCZOS)

    # Center on transparent canvas
    canvas = Image.new('RGBA', (target_size, target_size), (0, 0, 0, 0))
    offset_x = (target_size - new_w) // 2
    offset_y = (target_size - new_h) // 2
    canvas.paste(scaled, (offset_x, offset_y), scaled)
    return canvas


def trim_rect(img, pad=8):
    """Trim white/transparent borders, keep aspect ratio."""
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    pixels = img.load()
    w, h = img.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 20 and not (r > 240 and g > 240 and b > 240):
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if max_x <= min_x:
        return img
    return img.crop((max(0, min_x - pad), max(0, min_y - pad),
                      min(w, max_x + 1 + pad), min(h, max_y + 1 + pad)))


# ═══════════════════════════════════════════
# 9 feature icons (128x128, on transparent bg)
# ═══════════════════════════════════════════
icons_9 = {
    'icon-swap':      (636, 1063, 900, 1320),
    'icon-stake':     (944, 1063, 1208, 1320),
    'icon-build':     (1252, 1063, 1516, 1320),
    'icon-mine':      (636, 1390, 900, 1646),
    'icon-market':    (944, 1390, 1208, 1646),
    'icon-tools':     (1252, 1390, 1516, 1646),
    'icon-multisend': (636, 1715, 900, 1971),
    'icon-xchain':    (944, 1715, 1208, 1971),
    'icon-news':      (1252, 1715, 1516, 1971),
}

for name, box in icons_9.items():
    crop = src.crop(box)
    # These icons have dark backgrounds — keep them as-is but trim and center
    result = trim_and_center(crop, 128, pad=4)
    result.save(os.path.join(out, f'{name}.png'))
    print(f'  [OK] {name}.png (128x128)')


# ═══════════════════════════════════════════
# Token icons (256x256, trimmed circle)
# ═══════════════════════════════════════════
tokens = {
    'token-mine': (1550, 69, 2048, 492),
    'token-vibe': (1550, 577, 2048, 992),
}

for name, box in tokens.items():
    crop = src.crop(box)
    result = trim_and_center(crop, 256, pad=8)
    result.save(os.path.join(out, f'{name}.png'))
    print(f'  [OK] {name}.png (256x256)')


# ═══════════════════════════════════════════
# Empty states (400x300, trimmed)
# ═══════════════════════════════════════════
empty = {
    'empty-orders': (0, 140, 600, 583),
    'empty-vault':  (0, 1403, 600, 1972),
}

for name, box in empty.items():
    crop = src.crop(box)
    trimmed = trim_rect(crop, pad=4)
    # Scale to max 400px wide
    w, h = trimmed.size
    scale = min(400 / w, 300 / h)
    new_w, new_h = int(w * scale), int(h * scale)
    result = trimmed.resize((new_w, new_h), Image.LANCZOS)
    result.save(os.path.join(out, f'{name}.png'))
    print(f'  [OK] {name}.png ({new_w}x{new_h})')


# ═══════════════════════════════════════════
# Hero illustration (800x600, trimmed)
# ═══════════════════════════════════════════
hero_crop = src.crop((450, 0, 1400, 800))
hero_trimmed = trim_rect(hero_crop, pad=8)
w, h = hero_trimmed.size
scale = min(800 / w, 600 / h)
hero_result = hero_trimmed.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
hero_result.save(os.path.join(out, 'hero-illustration.png'))
print(f'  [OK] hero-illustration.png ({hero_result.size[0]}x{hero_result.size[1]})')


# ═══════════════════════════════════════════
# Cleanup temp files
# ═══════════════════════════════════════════
import glob
for f in glob.glob(os.path.join(out, '*-raw.png')) + glob.glob(os.path.join(out, '_quad_*.png')) + glob.glob(os.path.join(out, '_center_*.png')):
    os.remove(f)
    print(f'  [DEL] {os.path.basename(f)}')

print(f'\nDone! {len(icons_9) + len(tokens) + len(empty) + 1} icons saved to {out}/')
