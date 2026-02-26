from PIL import Image
import numpy as np

def mask_from_magic_wand(img_array, tolerance=30):
    # Just grab top-left color
    tl = img_array[0,0][:3].astype(int)
    
    r = img_array[:,:,0].astype(int)
    g = img_array[:,:,1].astype(int)
    b = img_array[:,:,2].astype(int)
    
    diff = np.abs(r-tl[0]) + np.abs(g-tl[1]) + np.abs(b-tl[2])
    return diff < tolerance * 3

def extract_sprite(input_path, output_path, crop_box=None):
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    
    if crop_box:
        t, b, l, r = crop_box
        cropped = arr[t:b, l:r].copy()
    else:
        cropped = arr.copy()
        
    bg_mask = mask_from_magic_wand(cropped, tolerance=35)
    
    # We want to do a proper flood fill to avoid removing internal colors
    from collections import deque
    h, w = cropped.shape[:2]
    visited = np.zeros((h, w), dtype=bool)
    mask = np.zeros((h, w), dtype=bool)
    q = deque()
    
    # Add borders
    for x in range(w): q.extend([(x,0), (x,h-1)])
    for y in range(h): q.extend([(0,y), (w-1,y)])
    
    for x,y in q: visited[y,x] = True
        
    seed = cropped[0,0][:3].astype(int)
    
    while q:
        x, y = q.popleft()
        px = cropped[y,x][:3].astype(int)
        if np.abs(px - seed).max() < 40:
            mask[y,x] = True
            for dx, dy in [(0,1),(0,-1),(1,0),(-1,0)]:
                nx, ny = x+dx, y+dy
                if 0<=nx<w and 0<=ny<h and not visited[ny,nx]:
                    visited[ny,nx] = True
                    q.append((nx,ny))
                    
    cropped[mask, 3] = 0
    
    alpha = cropped[:,:,3]
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    
    if np.any(rows):
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        tight = Image.fromarray(cropped[rmin:rmax+1, cmin:cmax+1])
        
        tw, th = tight.size
        side = max(tw, th) + 16
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(tight, ((side-tw)//2, (side-th)//2), tight)
        canvas = canvas.resize((512, 512), Image.NEAREST)
        canvas.save(output_path)
        print(f"Saved {output_path}")

extract_sprite('scripts/temp/miner-idle-orig.png', 'public/miner-idle.png', crop_box=(80, 480, 50, 590))
extract_sprite('scripts/temp/miner-hit-orig.png', 'public/miner-hit.png')
extract_sprite('scripts/temp/mining-rig-orig.png', 'public/mining-rig.png', crop_box=(0, 520, 0, 640))
