from PIL import Image
import numpy as np

def clean_sprite(input_path, output_path, is_rig=False):
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    
    # 1. Base Crop
    if 'idle' in input_path:
        top, bot, left, right = 80, 480, 50, 590
    elif 'hit' in input_path:
        top, bot, left, right = 0, 640, 0, 640
    elif is_rig:
        top, bot, left, right = 0, 520, 0, 640
        
    cropped = arr[top:bot, left:right].copy()
    
    # 2. Precise color-based background removal
    r = cropped[:,:,0].astype(int)
    g = cropped[:,:,1].astype(int)
    b = cropped[:,:,2].astype(int)
    
    # Background gradient in all images is mostly very dark or dark blue/grey
    # We want to KEEP the yellow/orange/brown/white character pixels
    
    if is_rig:
        # Rig has a more uniform dark grey background
        # Bg is mostly r,g,b < 60 and relatively low variance between channels
        variance = np.var([r, g, b], axis=0)
        bg_mask = (r < 65) & (g < 65) & (b < 65) & (variance < 100)
    else:
        # Miner has a dark blue/grey background
        # Let's target pixels where Blue is dominant OR pixels are very dark
        is_very_dark = (r < 30) & (g < 30) & (b < 30)
        is_blue_bg = (b > r) & (b >= g) & (b < 100)
        is_grey_bg = (r < 75) & (g < 75) & (b < 95) & (np.abs(r-g) < 15)
        
        bg_mask = is_very_dark | is_blue_bg | is_grey_bg
        
    cropped[bg_mask, 3] = 0
    
    # 3. Find bounding box of remaining pixels
    alpha = cropped[:, :, 3]
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    
    if np.any(rows):
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        tight = Image.fromarray(cropped[rmin:rmax+1, cmin:cmax+1])
        
        # 4. Center on 512x512
        tw, th = tight.size
        side = max(tw, th) + 30
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(tight, ((side-tw)//2, (side-th)//2), tight)
        
        # Use NEAREST to preserve pixel art look, but since it's already "pixel art"
        # that was likely upscaled, LANCZOS might be safer for arbitrary resize.
        # But let's stick to NEAREST if we want pure pixels.
        canvas = canvas.resize((512, 512), Image.NEAREST)
        canvas.save(output_path)
        print(f"Saved {output_path}")

clean_sprite('scripts/temp/miner-idle-orig.png', 'scripts/temp/miner-idle-test.png')
clean_sprite('scripts/temp/miner-hit-orig.png', 'scripts/temp/miner-hit-test.png')
clean_sprite('scripts/temp/mining-rig-orig.png', 'scripts/temp/mining-rig-test.png', is_rig=True)
