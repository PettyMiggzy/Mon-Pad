#!/usr/bin/env python3
"""Auto-frame green-screen pet clips (no source stills needed) into transparent looping webm.

  python3 -I scripts/pet-autoclip.py <videos_dir> name1 name2 ...

For each <videos_dir>/<name>.mp4 it measures the character's box over time, trims any zoomed-in opening
(until the whole character is in frame with a margin), crops to where the character moves, keys out the green,
and ping-pongs for a seamless loop. Clips that never fit are skipped. Output: public/pet/clips/<name>.webm + lib/pet/clips.json.
"""
import json, os, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/pet/clips')
IDX = os.path.join(ROOT, 'lib/pet/clips.json')
SW, SH, FPS = 480, 270, 4
EDGE = 4          # px (at 480x270) the character must stay away from the frame edge
MAXTRIM = 2.5     # give up if more than this many seconds must be cut
M = 0.06

def frames(clip):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', clip, '-vf', f'fps={FPS},scale={SW}:{SH}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, SH, SW, 3).astype(int)

def box(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    fg = ~((g > 110) & (g > r + 50) & (g > b + 50))
    cols, rows = np.where(fg.sum(0) >= 6)[0], np.where(fg.sum(1) >= 6)[0]
    if len(rows) < 10 or len(cols) < 10: return None
    return cols.min(), rows.min(), cols.max(), rows.max()

def inside(bx): return bx and bx[0] > EDGE and bx[1] > EDGE and bx[2] < SW - 1 - EDGE and bx[3] < SH - 1 - EDGE

def make(name, clip):
    fr = frames(clip); bxs = [box(f) for f in fr]
    good = [inside(b) for b in bxs]
    start = next((i for i in range(len(good)) if all(good[i:])), None)
    if start is None or start / FPS > MAXTRIM: print('skip', name, 'never fully in frame'); return None
    use = [b for b in bxs[start:]]
    l, t = min(b[0] for b in use), min(b[1] for b in use); r, b_ = max(b[2] for b in use), max(b[3] for b in use)
    w, h = r - l, b_ - t
    cl, ct = max(0, l - w * M), max(0, t - h * M); cr, cb = min(SW, r + w * M), min(SH, b_ + h * M)
    k = 1920 / SW
    cx, cy, cw, ch = int(cl * k), int(ct * k), int((cr - cl) * k), int((cb - ct) * k); cw -= cw % 2; ch -= ch % 2
    out = os.path.join(OUT, name + '.webm'); ss = start / FPS
    vf = (f"[0:v]crop={cw}:{ch}:{cx}:{cy},scale=-2:480,chromakey=0x00ff00:0.16:0.08,despill=type=green:mix=0.6:expand=0:brightness=0,"
          "split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{ss:.2f}', '-i', clip, '-filter_complex', vf, '-map', '[v]', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '36', '-auto-alt-ref', '0', out], check=True)
    print('ok', name, f'trim {ss:.2f}s', os.path.getsize(out) // 1024, 'KB')
    return {'bodyFrac': round((h * k) / ch, 4), 'aspect': round(cw / ch, 4), 'margin': M}

def bust(name, clip):
    """Waist-up mode: keep full height, crop sideways to where the character moves. The player fades the bottom edge."""
    fr = frames(clip); bxs = [b for b in (box(f) for f in fr) if b]
    if not bxs: print('skip', name, 'no character'); return None
    t, bt = min(b[1] for b in bxs), max(b[3] for b in bxs)
    if (bt - t) / SH < 0.8 and all(inside(b) for b in bxs):  # whole character fits: use the full-body framing so his size matches the stills
        res = make(name, clip)
        if res: return res
    l, r = min(b[0] for b in bxs), max(b[2] for b in bxs)
    if (r - l) > SW * 0.85: print('skip', name, 'extreme close-up'); return None
    w = r - l; cl, cr = max(0, l - w * 0.05), min(SW, r + w * 0.05)
    k = 1920 / SW; cx, cw = int(cl * k), int((cr - cl) * k); cw -= cw % 2
    out = os.path.join(OUT, name + '.webm')
    vf = (f"[0:v]crop={cw}:1080:{cx}:0,scale=-2:480,chromakey=0x00ff00:0.16:0.08,despill=type=green:mix=0.6:expand=0:brightness=0,"
          "split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', clip, '-filter_complex', vf, '-map', '[v]', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '36', '-auto-alt-ref', '0', out], check=True)
    print('ok bust', name, os.path.getsize(out) // 1024, 'KB')
    return {'bodyFrac': 1, 'aspect': round(cw / 1080, 4), 'margin': 0, 'bust': True}

if __name__ == '__main__':
    mode = 'bust' if sys.argv[1] == '--bust' else 'fit'
    argv = sys.argv[2:] if mode == 'bust' else sys.argv[1:]
    vids, names = argv[0], argv[1:]
    os.makedirs(OUT, exist_ok=True)
    idx = json.load(open(IDX)) if os.path.exists(IDX) else {}
    for n in names:
        res = (bust if mode == 'bust' else make)(n, os.path.join(vids, n + '.mp4'))
        if res: idx[n] = res
    json.dump(idx, open(IDX, 'w'), indent=1)
