"""Fix miner-idle.png: crop to main character only, remove text + sprite row + artifacts."""
from PIL import Image
import numpy as np
from collections import deque

def flood_fill_mask(img_array, start_points, tolerance=40):
    h, w = img_array.shape[:2]
    visited = np.zeros((h, w), dtype=bool)
    mask = np.zeros((h, w), dtype=bool)
    queue = deque()
    
    for sx, sy in start_points:
        if sx < 0 or sx >= w or sy < 0 or sy >= h:
            continue
        if visited[sy, sx]:
            continue
        seed_color = img_array[sy, sx].astype(np.int16)
        queue.append((sx, sy))
        visited[sy, sx] = True
        
        while queue:
            x, y = queue.popleft()
            px = img_array[y, x].astype(np.int16)
            diff = np.abs(px - seed_color).max()
            
            if diff <= tolerance:
                mask[y, x] = True
                for ddx, ddy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)]:
                    nx, ny = x+ddx, y+ddy
                    if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((nx, ny))
    return mask

# Load ORIGINAL idle image (need to re-download or use backup)
# First check if we have a git backup
import subprocess, os

# Restore original from git
subprocess.run(['git', 'checkout', 'HEAD~1', '--', 'public/miner-idle.png'], cwd=r'c:\vibe', capture_output=True)

img = Image.open('public/miner-idle.png').convert('RGBA')
arr = np.array(img)
h, w = arr.shape[:2]
print(f"Original: {w}x{h}, mode={img.mode}")

# Step 1: Crop to main character area only (remove text at top, sprites at bottom)
# Main character is roughly in the center, from about y=50 to y=480 (out of 640)
# and x=80 to x=520
top_crop = 60
bot_crop = 490  # cuts off the sprite row
left_crop = 40
right_crop = 600

cropped = arr[top_crop:bot_crop, left_crop:right_crop].copy()
ch, cw = cropped.shape[:2]
print(f"Cropped to main char: {cw}x{ch}")

# Step 2: Remove background via flood fill from edges
rgb = cropped[:, :, :3]

starts = []
# Dense edge sampling
for x in range(0, cw, 5):
    starts.extend([(x, 0), (x, ch-1)])
for y in range(0, ch, 5):
    starts.extend([(0, y), (cw-1, y)])

bg_mask = flood_fill_mask(rgb, starts, tolerance=50)

# Step 3: Also remove near-white/light gray artifacts (the speckles)
# These are pixels that are very light (high brightness) and isolated
brightness = rgb.astype(np.float32).mean(axis=2)
light_mask = brightness > 180  # very light pixels
# Only remove light pixels that are NOT part of the character (e.g., helmet glow is OK)
# Use a heuristic: if a light pixel is surrounded by mostly background, it's an artifact
from scipy import ndimage
bg_dilated = ndimage.binary_dilation(bg_mask, iterations=2)
artifact_mask = light_mask & bg_dilated

final_mask = bg_mask | artifact_mask

cropped[final_mask, 3] = 0

# Step 4: Find tight bounding box
alpha = cropped[:, :, 3]
rows = np.any(alpha > 0, axis=1)
cols = np.any(alpha > 0, axis=0)
rmin, rmax = np.where(rows)[0][[0, -1]]
cmin, cmax = np.where(cols)[0][[0, -1]]

tight = Image.fromarray(cropped[rmin:rmax+1, cmin:cmax+1])
tw, th = tight.size
print(f"Tight crop: {tw}x{th}")

# Step 5: Center on square transparent canvas, resize to 512
padding = 16
side = max(tw, th) + padding * 2
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
ox = (side - tw) // 2
oy = (side - th) // 2
canvas.paste(tight, (ox, oy), tight)
canvas = canvas.resize((512, 512), Image.LANCZOS)
canvas.save('public/miner-idle.png')
print(f"✓ Saved miner-idle.png (512x512, transparent)")

# Also clean up mining-rig - remove the light line artifacts at bottom
subprocess.run(['git', 'checkout', 'HEAD~1', '--', 'public/mining-rig.png'], cwd=r'c:\vibe', capture_output=True)
rig = Image.open('public/mining-rig.png').convert('RGBA')
rig_arr = np.array(rig)
rh, rw = rig_arr.shape[:2]
rig_rgb = rig_arr[:, :, :3]

rig_starts = []
for x in range(0, rw, 5):
    rig_starts.extend([(x, 0), (x, rh-1)])
for y in range(0, rh, 5):
    rig_starts.extend([(0, y), (rw-1, y)])

rig_bg = flood_fill_mask(rig_rgb, rig_starts, tolerance=45)
# Remove light artifacts
rig_bright = rig_rgb.astype(np.float32).mean(axis=2)
rig_light = rig_bright > 200
rig_bg_dil = ndimage.binary_dilation(rig_bg, iterations=2)
rig_art = rig_light & rig_bg_dil
rig_final = rig_bg | rig_art
rig_arr[rig_final, 3] = 0

r_alpha = rig_arr[:, :, 3]
r_rows = np.any(r_alpha > 0, axis=1)
r_cols = np.any(r_alpha > 0, axis=0)
r_rmin, r_rmax = np.where(r_rows)[0][[0, -1]]
r_cmin, r_cmax = np.where(r_cols)[0][[0, -1]]

rig_tight = Image.fromarray(rig_arr[r_rmin:r_rmax+1, r_cmin:r_cmax+1])
rtw, rth = rig_tight.size
rside = max(rtw, rth) + 16
rcanvas = Image.new('RGBA', (rside, rside), (0, 0, 0, 0))
rcanvas.paste(rig_tight, ((rside-rtw)//2, (rside-rth)//2), rig_tight)
rcanvas = rcanvas.resize((512, 512), Image.LANCZOS)
rcanvas.save('public/mining-rig.png')
print(f"✓ Saved mining-rig.png (512x512, transparent)")
