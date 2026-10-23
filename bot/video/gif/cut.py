from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage as ndi
im=Image.open('/root/.claude/uploads/2417b4c8-24f3-56db-be3e-6cb2029a8dca/ee8937f7-image.jpg').convert('RGB')
x0,y0,x1,y1=540,410,890,880
a=np.array(im.crop((x0,y0,x1,y1))).astype(int)
bg=np.array([30,33,42])
d=np.abs(a-bg).sum(2)
m=d>45
r,g,b=a[...,0],a[...,1],a[...,2]
green=(g>r+50)&(g>b+30)
xs=np.arange(a.shape[1])[None,:]+x0
m&=~(green&(xs>=828))
# remove candle edge slivers: columns >=860 are bg/candle
m[:,860-x0:]=False
m=ndi.binary_opening(m,iterations=1)
lab,n=ndi.label(m);sz=ndi.sum(m,lab,range(1,n+1));m=lab==(1+int(np.argmax(sz)))
m=ndi.binary_fill_holes(m)
m=ndi.binary_closing(m,iterations=2)
al=Image.fromarray((m*255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.8))
out=Image.fromarray(a.astype('uint8')).convert('RGBA');out.putalpha(al)
out.save('cat.png')
bgp=Image.new('RGBA',out.size,(255,0,255,255));bgp.alpha_composite(out);bgp.save('cat-prev.png')
