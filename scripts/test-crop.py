from PIL import Image
import numpy as np

def process_idle():
    img = Image.open('scripts/temp/miner-idle-orig.png').convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    
    # 1. Base crop to remove text and bottom sprites
    # Main character is roughly y=80..480, x=50..590
    top, bot = 80, 480
    left, right = 50, 590
    cropped = arr[top:bot, left:right].copy()
    
    # 2. Precise color-based background removal
    # Instead of flood fill, the background is a dark bluish gradient.
    # The character is mostly light brown/orange/yellow/white.
    # Let's remove pixels where Blue channel is dominant and overall brightness is low.
    r, g, b = cropped[:,:,0], cropped[:,:,1], cropped[:,:,2]
    
    # Background is mostly: R < 70, G < 70, B > R and B > G
    # Or very dark pixels (R,G,B < 25)
    is_dark = (r < 25) & (g < 25) & (b < 25)
    is_blue_bg = (b > r) & (b > g) & (b < 100)
    
    # Also remove some artifact speckles (isolated pixels)
    # We can just use a simple threshold for the background gradient
    brightness = r.astype(int) + g.astype(int) + b.astype(int)
    is_bg = brightness < 150  # adjust this threshold
    
    # Let's try a different approach: the background is a smooth gradient.
    # We can detect edges using Sobel, but simpler:
    # Just mask out the specific background colors.
    
    # For now, let's just make the known dark/blue background transparent
    bg_mask = (r < 60) & (g < 60) & (b < 90)
    
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
        side = max(tw, th) + 20
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(tight, ((side-tw)//2, (side-th)//2), tight)
        canvas = canvas.resize((512, 512), Image.NEAREST) # Use NEAREST for pixel art
        canvas.save('scripts/temp/miner-idle-test.png')
        print("Saved scripts/temp/miner-idle-test.png")

process_idle()
