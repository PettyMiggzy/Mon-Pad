import sys, math, random, subprocess, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
tier=sys.argv[1] if len(sys.argv)>1 else 'small'
CFG={'small':dict(loops=1,parts=26,glow=.5,shake=0,rings=0,coins=0),
     'big':dict(loops=2,parts=55,glow=.8,shake=2,rings=1,coins=0),
     'whale':dict(loops=3,parts=90,glow=1.1,shake=4,rings=2,coins=1)}[tier]
W=H=512;N=72;FPS=24;P=192
cat=Image.open('cat.png');S=1.0;cat=cat.resize((int(cat.width*S),int(cat.height*S)),Image.LANCZOS)
CX=335  # candle centre x on screen
catx=CX-int(305*S); caty=int(H*.5-cat.height*.42)
COIN=[Image.open(f'coin/{i:03d}.png').convert('RGBA') for i in range(1,61)]
CS={'small':110,'big':150,'whale':160}[tier]
GREEN=(46,230,110);DK=(14,16,24)
def bgbase():
    y=np.linspace(0,1,H)[:,None,None]
    top=np.array([12,13,22]);bot=np.array([30,18,52])
    return Image.fromarray((top*(1-y)+bot*y).repeat(W,1).astype('uint8'))
BG=bgbase()
rng=random.Random(7)
# parallax mini candles (tile height P*1.5 so they loop with scroll)
bgc=[(rng.randint(20,300),rng.randint(0,P*2),rng.choice([1,1,1,0]),rng.randint(18,60),rng.randint(6,12)) for _ in range(26)]
parts=[(rng.random(),rng.random(),rng.uniform(.6,2.2),rng.uniform(1.5,4)) for _ in range(CFG['parts'])]
def glowlayer(img,rad,k):
    g=img.filter(ImageFilter.GaussianBlur(rad));return ImageChops.add(img,g.point(lambda v:min(255,int(v*k))))
def frame(i):
    t=i/N; ph=2*math.pi*t
    sc=t*P*CFG['loops']
    im=BG.copy().convert('RGBA'); d=ImageDraw.Draw(im,'RGBA')
    # grid lines drifting down
    for k in range(-1,H//P*2+3):
        y=(k*P/2+sc*.5)%(H+P)-P/2
        d.line([(0,y),(W,y)],fill=(255,255,255,12),width=1)
    # far mini candles drifting down (parallax .55)
    for x,y0,up,hgt,w in bgc:
        y=(y0+sc*.55)%(P*2*2)-P*1.2
        y=y%(H+120)-60
        col=(46,230,110,70) if up else (240,70,80,60)
        d.line([(x+w//2,y-hgt*.7),(x+w//2,y+hgt*1.4)],fill=col,width=2)
        d.rectangle([x,y,x+w,y+hgt],fill=col)
    # rising glow behind candle
    gl=Image.new('RGBA',(W,H),(0,0,0,0));gd=ImageDraw.Draw(gl)
    gd.rectangle([CX-22,0,CX+22,H],fill=(40,255,120,int(150*CFG['glow'])))
    gl=gl.filter(ImageFilter.GaussianBlur(26));im.alpha_composite(gl)
    d=ImageDraw.Draw(im,'RGBA')
    # main candle w/ segment shimmer
    d.rectangle([CX-17,-5,CX+17,H+5],fill=GREEN+(255,))
    d.rectangle([CX-17,-5,CX-9,H+5],fill=(120,255,170,255))
    d.rectangle([CX+9,-5,CX+17,H+5],fill=(20,170,80,255))
    for k in range(-1,H//48+2):
        y=(k*48+sc*1.0)%(H+96)-48
        d.rectangle([CX-17,y,CX+17,y+3],fill=(255,255,255,50))
    # speed streaks
    for j,(a,b,sp,l) in enumerate(parts[:CFG['parts']//2]):
        x=a*W;y=((b*H*1.3+sc*3*sp*.8)%(H+80))-40
        d.line([(x,y),(x,y+14*l)],fill=(120,255,170,40),width=1)
    # cat (bob / rock)
    bob=math.sin(ph*2)*5*(1+.3*(CFG['loops']-1)); rock=math.sin(ph*2+1)*2.2
    sh=CFG['shake']; ox=math.sin(ph*9)*sh; oy=math.cos(ph*7)*sh
    c=cat.rotate(rock,resample=Image.BICUBIC,center=(305*S,75*S),expand=False)
    # drop shadow glow
    im.alpha_composite(c,(int(catx+ox),int(caty+bob+oy)))
    # Monshi coin spinning above, glow behind
    cn=COIN[int(t*60)%60].resize((CS,CS),Image.LANCZOS)
    cx=int(W*.17);cy=int(58+math.sin(ph*2)*8)
    cg=Image.new('RGBA',(W,H),(0,0,0,0));ImageDraw.Draw(cg).ellipse([cx-CS*.7,cy-CS*.7,cx+CS*.7,cy+CS*.7],fill=(170,110,255,int(110*CFG['glow'])))
    im.alpha_composite(cg.filter(ImageFilter.GaussianBlur(30)));im.alpha_composite(cn,(cx-CS//2,cy-CS//2))
    # particles
    pl=Image.new('RGBA',(W,H),(0,0,0,0));pd=ImageDraw.Draw(pl)
    for a,b,sp,r in parts:
        x=(a*W+math.sin(ph*2+a*20)*10)%W;y=H-((b*H+t*H*(1+sp)*CFG['loops'])%(H+20))
        al=int(200*(.4+.6*math.sin(math.pi*((H-y)/H))));col=(180,255,200,al) if b<.8 else (200,150,255,al)
        pd.ellipse([x-r,y-r,x+r,y+r],fill=col)
    pl=glowlayer(pl,5,1.5);im.alpha_composite(pl)
    # pulse rings from candle (beat per loop)
    for r_i in range(CFG['rings']):
        tt=(t*CFG['loops']*1+r_i/ max(1,CFG['rings']))%1
        rr=40+tt*380;ring=Image.new('RGBA',(W,H),(0,0,0,0));rd=ImageDraw.Draw(ring)
        col=(46,255,130,int(160*(1-tt))) if r_i==0 else (190,120,255,int(150*(1-tt)))
        rd.ellipse([CX-rr,H*.45-rr,CX+rr,H*.45+rr],outline=col,width=4)
        im.alpha_composite(ring.filter(ImageFilter.GaussianBlur(1.2)))
    if CFG['coins']:
        for k in range(14):
            a=(k*.137)%1;x=(a*W*.8+30+math.sin(ph*3+k)*8);y=((a*3+t*CFG['loops']*1.7+k*.07)%1)*(H+40)-20
            d2=ImageDraw.Draw(im,'RGBA');w=abs(math.cos(ph*3+k))*9+2
            d2.ellipse([x-w,y-9,x+w,y+9],fill=(255,205,60,230),outline=(255,240,150,255))
    # vignette
    vg=Image.new('L',(W,H),0);vd=ImageDraw.Draw(vg);vd.ellipse([-120,-120,W+120,H+120],fill=255)
    vg=vg.filter(ImageFilter.GaussianBlur(90));blk=Image.new('RGBA',(W,H),(6,4,14,255))
    im=Image.composite(im,blk,vg.point(lambda v:int(110+v*.57)))
    return im.convert('RGB')
os.makedirs(f'f_{tier}',exist_ok=True)
for i in range(N): frame(i).save(f'f_{tier}/{i:03d}.png')
subprocess.run(f'ffmpeg -y -loglevel error -framerate {FPS} -i f_{tier}/%03d.png -c:v libx264 -crf 17 -pix_fmt yuv420p -movflags +faststart -an buy-{tier}.mp4',shell=True,check=True)
subprocess.run(f'ffmpeg -y -loglevel error -framerate {FPS} -i f_{tier}/%03d.png -vf "split[a][b];[a]palettegen=max_colors=200[p];[b][p]paletteuse=dither=sierra2_4a" buy-{tier}.gif',shell=True,check=True)
print(tier,'done')
