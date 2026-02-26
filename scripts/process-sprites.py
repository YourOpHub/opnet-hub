"""Remove gradient backgrounds from miner sprites, crop & center on transparent canvas."""
from PIL import Image
import numpy as np
from collections import deque

def flood_fill_mask(img_array, start_points, tolerance=45):
    """Flood fill from multiple start points, returning a mask of background pixels."""
    h, w = img_array.shape[:2]
    visited = np.zeros((h, w), dtype=bool)
    mask = np.zeros((h, w), dtype=bool)
    queue = deque()
    
    for sx, sy in start_points:
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
                for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((nx, ny))
    return mask

def remove_bg_and_center(input_path, output_path, tolerance=45, padding=20):
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    rgb = arr[:, :, :3]
    h, w = rgb.shape[:2]
    
    # Flood fill from all 4 corners + edge midpoints
    starts = [
        (0, 0), (w-1, 0), (0, h-1), (w-1, h-1),
        (w//2, 0), (w//2, h-1), (0, h//2), (w-1, h//2),
        (w//4, 0), (3*w//4, 0), (w//4, h-1), (3*w//4, h-1),
        (0, h//4), (0, 3*h//4), (w-1, h//4), (w-1, 3*h//4),
    ]
    
    bg_mask = flood_fill_mask(rgb, starts, tolerance=tolerance)
    
    # Also do a second pass with slightly different tolerance from more edge points
    for x in range(0, w, 40):
        starts.append((x, 0))
        starts.append((x, h-1))
    for y in range(0, h, 40):
        starts.append((0, y))
        starts.append((w-1, y))
    
    bg_mask2 = flood_fill_mask(rgb, starts, tolerance=tolerance)
    bg_mask = bg_mask | bg_mask2
    
    # Set background pixels to transparent
    arr[bg_mask, 3] = 0
    
    # Find bounding box of non-transparent pixels
    alpha = arr[:, :, 3]
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    
    if not rows.any():
        print(f"WARNING: All pixels removed for {input_path}")
        return
    
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    
    # Crop to bounding box
    cropped = Image.fromarray(arr[rmin:rmax+1, cmin:cmax+1])
    
    # Center on square canvas with padding
    cw, ch = cropped.size
    side = max(cw, ch) + padding * 2
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ox = (side - cw) // 2
    oy = (side - ch) // 2
    canvas.paste(cropped, (ox, oy), cropped)
    
    # Resize to 512x512 for consistent display
    canvas = canvas.resize((512, 512), Image.LANCZOS)
    canvas.save(output_path)
    print(f"✓ {input_path} → {output_path} ({cw}x{ch} character → 512x512)")

# Process both sprites
remove_bg_and_center('public/miner-idle.png', 'public/miner-idle.png', tolerance=48)
remove_bg_and_center('public/miner-hit.png', 'public/miner-hit.png', tolerance=48)
remove_bg_and_center('public/mining-rig.png', 'public/mining-rig.png', tolerance=48)
print("Done!")
