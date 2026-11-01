#!/usr/bin/env python3
"""Turn green-screen mp4 clips into tight transparent looping webm files for the pet page.

  python3 scripts/pet-mkclip.py <videos_dir> <images_dir>

Each <videos_dir>/<name>.mp4 (e.g. adult-ok.mp4) is matched to <images_dir>/<name>.jpg|png, the still it was made from.
The still tells us where the character stands; the clip may be any size or aspect (it is assumed to show the still fitted and centred).
Output: public/pet/clips/<name>.webm and an entry in lib/pet/clips.json. Needs ffmpeg and Pillow.
"""
import json, os, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/pet/clips')
IDX = os.path.join(ROOT, 'lib/pet/clips.json')
M = 0.08  # margin around the standing character (paws and sparkles move outside the box)

def standing_box(path):
    im = Image.open(path).convert('RGBA'); px = im.load(); W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if g - max(r, b) > 60: px[x, y] = (0, 0, 0, 0)
    return im.getbbox(), (W, H)

def probe(clip):
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', clip], capture_output=True, text=True, check=True).stdout.strip()
    w, h = o.split(','); return int(w), int(h)

def make(name, img, clip):
    (l, t, r, b), (W, H) = standing_box(img); bw, bh = r - l, b - t
    cw0, ch0 = probe(clip)
    s = min(cw0 / W, ch0 / H); ox, oy = (cw0 - W * s) / 2, (ch0 - H * s) / 2
    cx, cy = max(0, int(ox + (l - bw * M) * s)), max(0, int(oy + (t - bh * M) * s))
    cw, ch = int(bw * (1 + 2 * M) * s), int(bh * (1 + 2 * M) * s)
    cw, ch = min(cw, cw0 - cx), min(ch, ch0 - cy); cw -= cw % 2; ch -= ch % 2
    out = os.path.join(OUT, name + '.webm')
    vf = (f"[0:v]crop={cw}:{ch}:{cx}:{cy},scale=-2:480,chromakey=0x00ff00:0.16:0.08,despill=type=green:mix=0.6:expand=0:brightness=0,"
          "split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', clip, '-filter_complex', vf, '-map', '[v]', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '35', '-auto-alt-ref', '0', out], check=True)
    return {'bodyFrac': round(bh * s / ch, 4), 'aspect': round(cw / ch, 4), 'margin': M}

if __name__ == '__main__':
    vids, imgs = sys.argv[1], sys.argv[2]
    os.makedirs(OUT, exist_ok=True)
    idx = json.load(open(IDX)) if os.path.exists(IDX) else {}
    for f in sorted(os.listdir(vids)):
        if not f.lower().endswith(('.mp4', '.mov', '.webm')): continue
        name = os.path.splitext(f)[0]
        img = next((os.path.join(imgs, name + e) for e in ('.jpg', '.png') if os.path.exists(os.path.join(imgs, name + e))), None)
        if not img: print('skip (no source image):', name); continue
        idx[name] = make(name, img, os.path.join(vids, f)); print('ok', name, os.path.getsize(os.path.join(OUT, name + '.webm')) // 1024, 'KB')
    json.dump(idx, open(IDX, 'w'), indent=1)
