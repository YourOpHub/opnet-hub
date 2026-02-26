"""More aggressive cleanup of miner-idle.png - remove text remnants and edge artifacts."""
from PIL import Image
import numpy as np
from collections import deque
from scipy import ndimage

def flood_fill_mask(img_array, start_points, tolerance=40):
    h, w = img_array.shape[:2]
    visited = np.zeros((h, w), dtype=bool)
    mask = np.zeros((h, w), dtype=bool)
    queue = deque()
    for sx, sy in start_points:
        if sx < 0 or sx >= w or sy < 0 or sy >= h or visited[sy, sx]:
            continue
        seed_color = img_array[sy, sx].astype(np.int16)
        queue.append((sx, sy))
        visited[sy, sx] = True
        while queue:
            x, y = queue.popleft()
            px = img_array[y, x].astype(np.int16)
            if np.abs(px - seed_color).max() <= tolerance:
                mask[y, x] = True
                for ddx, ddy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)]:
                    nx, ny = x+ddx, y+ddy
                    if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((nx, ny))
    return mask

import subprocess
subprocess.run(['git', 'checkout', 'HEAD~1', '--', 'public/miner-idle.png'], cwd=r'c:\vibe', capture_output=True)

img = Image.open('public/miner-idle.png').convert('RGBA')
arr = np.array(img)

# Crop MORE aggressively: remove text row and sprite row
# Text "MINER SPRITES" is in top ~70px, sprites are bottom ~150px
# Main char is roughly y=75..485, x=50..580
top = 80
bot = 480
left = 50
right = 590
cropped = arr[top:bot, left:right].copy()
ch, cw = cropped.shape[:2]
rgb = cropped[:, :, :3]
print(f"Cropped: {cw}x{ch}")

# Flood fill bg from dense edge points  
starts = []
for x in range(0, cw, 3):
    starts.extend([(x, 0), (x, 1), (x, 2), (x, ch-1), (x, ch-2), (x, ch-3)])
for y in range(0, ch, 3):
    starts.extend([(0, y), (1, y), (2, y), (cw-1, y), (cw-2, y), (cw-3, y)])

bg_mask = flood_fill_mask(rgb, starts, tolerance=55)

# Remove isolated small opaque clusters (text remnants, noise)
# These are small connected components of non-bg pixels
non_bg = ~bg_mask
labeled, num_features = ndimage.label(non_bg)
# Keep only the largest connected component (the character)
sizes = ndimage.sum(non_bg, labeled, range(1, num_features + 1))
if len(sizes) > 0:
    largest_label = np.argmax(sizes) + 1
    # Remove all small components (anything < 5% of largest)
    threshold = sizes[largest_label - 1] * 0.02
    for i in range(1, num_features + 1):
        if sizes[i - 1] < threshold:
            bg_mask[labeled == i] = True
    print(f"Kept largest component ({int(sizes[largest_label-1])} px), removed {sum(1 for s in sizes if s < threshold)} small fragments")

cropped[bg_mask, 3] = 0

# Tight bbox
alpha = cropped[:, :, 3]
rows = np.any(alpha > 0, axis=1)
cols = np.any(alpha > 0, axis=0)
rmin, rmax = np.where(rows)[0][[0, -1]]
cmin, cmax = np.where(cols)[0][[0, -1]]
tight = Image.fromarray(cropped[rmin:rmax+1, cmin:cmax+1])
tw, th = tight.size
print(f"Tight: {tw}x{th}")

# Center on 512x512
padding = 20
side = max(tw, th) + padding * 2
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
canvas.paste(tight, ((side-tw)//2, (side-th)//2), tight)
canvas = canvas.resize((512, 512), Image.LANCZOS)
canvas.save('public/miner-idle.png')
print("✓ miner-idle.png cleaned")

# Now fix mining-rig.png - remove the light circuit traces at bottom
subprocess.run(['git', 'checkout', 'HEAD~1', '--', 'public/mining-rig.png'], cwd=r'c:\vibe', capture_output=True)
rig = Image.open('public/mining-rig.png').convert('RGBA')
rig_arr = np.array(rig)
rh, rw = rig_arr.shape[:2]
rig_rgb = rig_arr[:, :, :3]

# Crop bottom 15% which has the circuit traces
rig_crop_bot = int(rh * 0.82)
rig_cropped = rig_arr[:rig_crop_bot, :].copy()
rch, rcw = rig_cropped.shape[:2]
rig_rgb2 = rig_cropped[:, :, :3]

starts2 = []
for x in range(0, rcw, 3):
    starts2.extend([(x, 0), (x, 1), (x, rch-1), (x, rch-2)])
for y in range(0, rch, 3):
    starts2.extend([(0, y), (1, y), (rcw-1, y), (rcw-2, y)])

rig_bg = flood_fill_mask(rig_rgb2, starts2, tolerance=50)

# Remove small artifacts
rig_non_bg = ~rig_bg
rig_labeled, rig_nf = ndimage.label(rig_non_bg)
rig_sizes = ndimage.sum(rig_non_bg, rig_labeled, range(1, rig_nf + 1))
if len(rig_sizes) > 0:
    rig_largest = np.argmax(rig_sizes) + 1
    rig_thresh = rig_sizes[rig_largest - 1] * 0.01
    for i in range(1, rig_nf + 1):
        if rig_sizes[i - 1] < rig_thresh:
            rig_bg[rig_labeled == i] = True

rig_cropped[rig_bg, 3] = 0

r_alpha = rig_cropped[:, :, 3]
r_rows = np.any(r_alpha > 0, axis=1)
r_cols = np.any(r_alpha > 0, axis=0)
r_rmin, r_rmax = np.where(r_rows)[0][[0, -1]]
r_cmin, r_cmax = np.where(r_cols)[0][[0, -1]]
rig_tight = Image.fromarray(rig_cropped[r_rmin:r_rmax+1, r_cmin:r_cmax+1])
rtw, rth = rig_tight.size

rside = max(rtw, rth) + 20
rcanvas = Image.new('RGBA', (rside, rside), (0, 0, 0, 0))
rcanvas.paste(rig_tight, ((rside-rtw)//2, (rside-rth)//2), rig_tight)
rcanvas = rcanvas.resize((512, 512), Image.LANCZOS)
rcanvas.save('public/mining-rig.png')
print("✓ mining-rig.png cleaned")
