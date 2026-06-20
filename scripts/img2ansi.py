import sys
from PIL import Image, ImageEnhance
path, W, THRESH, SAT = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4])
img = Image.open(path).convert("RGB")
if SAT != 1.0: img = ImageEnhance.Color(img).enhance(SAT)
w0,h0=img.size; H=round(W*h0/w0); H+=H%2
img=img.resize((W,H),Image.LANCZOS); px=img.load()
corners=[px[0,0],px[W-1,0],px[0,H-1],px[W-1,H-1]]
bg=tuple(sum(c[i] for c in corners)//4 for i in range(3))
isbg=lambda c:(sum((a-b)**2 for a,b in zip(c,bg)))**0.5<THRESH
lines=[]
for y in range(0,H,2):
    s=""
    for x in range(W):
        t=px[x,y]; b=px[x,y+1] if y+1<H else bg
        tb,bb=isbg(t),isbg(b)
        if tb and bb: s+=r"\033[0m "
        elif tb: s+=r"\033[0m\033[38;2;%d;%d;%dm▄"%b
        elif bb: s+=r"\033[0m\033[38;2;%d;%d;%dm▀"%t
        else: s+=r"\033[38;2;%d;%d;%dm\033[48;2;%d;%d;%dm▀"%(t+b)
    lines.append((s+r"\033[0m").rstrip())
empty=lambda l:l.replace(r"\033[0m","").strip()==""
while lines and empty(lines[0]): lines.pop(0)
while lines and empty(lines[-1]): lines.pop()
open("/tmp/iva-tree.txt","w").write("\n".join(lines)+"\n")
# PNG-превью
CW,CH=12,12; canvas=Image.new("RGB",(W*CW,(H//2)*CH),(12,12,14)); cp=canvas.load()
for ry,y in enumerate(range(0,H,2)):
    for x in range(W):
        for half,yy in (("t",y),("b",y+1)):
            c=px[x,yy] if yy<H else bg
            if isbg(c): continue
            x0=x*CW; y0=ry*CH+(0 if half=="t" else CH//2)
            for ix in range(CW):
                for iy in range(CH//2): cp[x0+ix,y0+iy]=c
canvas.save("/tmp/iva-tree-preview.png")
print(f"rows={len(lines)} sat={SAT}")
