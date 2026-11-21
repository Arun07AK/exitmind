import numpy as np, sys, json
from PIL import Image
def load(sheet):
    return (np.asarray(Image.open(f"data/sheets/{sheet}.png").convert("L"))<140).astype(np.float32)
def ring_score(dark, r, n=72):
    # dilate dark by 1px for robustness
    d = dark.copy()
    d[1:]=np.maximum(d[1:],dark[:-1]); d[:-1]=np.maximum(d[:-1],dark[1:])
    d[:,1:]=np.maximum(d[:,1:],dark[:,:-1]); d[:,:-1]=np.maximum(d[:,:-1],dark[:,1:])
    H,W=d.shape; acc=np.zeros_like(d)
    for k in range(n):
        a=2*np.pi*k/n; dx=int(round(r*np.cos(a))); dy=int(round(r*np.sin(a)))
        acc+=np.roll(np.roll(d,-dy,0),-dx,1)
    # penalize filled blobs: inside ring at 0.55r should be mostly white
    inner=np.zeros_like(d)
    for k in range(24):
        a=2*np.pi*k/24; dx=int(round(0.5*r*np.cos(a))); dy=int(round(0.5*r*np.sin(a)))
        inner+=np.roll(np.roll(d,-dy,0),-dx,1)
    return acc/n - 0.5*inner/24
def find(sheet, box, rmin=16, rmax=22, thr=0.8, axis="x"):
    x0,y0,x1,y1=box
    dark=load(sheet)[y0:y1,x0:x1]
    best=None
    for r in range(rmin,rmax+1):
        s=ring_score(dark,r)
        best=s if best is None else np.maximum(best,s)
    pts=[]
    b=best.copy()
    while True:
        i=np.argmax(b); v=b.flat[i]
        if v<thr: break
        y,x=divmod(i,b.shape[1])
        # subpixel: weighted centroid in 5x5
        ys=slice(max(0,y-2),y+3); xs=slice(max(0,x-2),x+3)
        w=np.clip(best[ys,xs]-thr+0.1,0,None); yy,xx=np.mgrid[ys,xs]
        cy=(w*yy).sum()/w.sum(); cx=(w*xx).sum()/w.sum()
        pts.append((round(cx+x0,1),round(cy+y0,1),round(float(v),2)))
        b[max(0,y-30):y+30,max(0,x-30):x+30]=-1
    pts.sort(key=lambda p:p[0] if axis=="x" else p[1])
    return pts
if __name__=="__main__":
    sheet=sys.argv[1]; box=list(map(int,sys.argv[2:6])); axis=sys.argv[6]
    for p in find(sheet,box,axis=axis): print(p)
