import json, numpy as np
from scipy.optimize import least_squares
LETX={"A":0,"A.8":15,"B":20,"C":40,"D":60,"D.5":70,"E":80,"F":100,"G":120,"H":140,"I":160,"J":180,"K":200,"K.5":211+2/12,"L":223.5,"M":238.5}
NUMY={"1":0,"2":28,"3":44,"3.4":56+11/12,"3.5":61,"4":82,"4.2":88}
d=json.load(open("bubbles.json"))
def label(pts, table, coord):  # coord 0 for x positions, 1 for y
    best=None
    vals=sorted(table.items(), key=lambda kv: kv[1])
    for p in pts:
        for lab,ft in vals:
            p0=p[coord]-12.5*ft
            inl=[]
            for q in pts:
                f=(q[coord]-p0)/12.5
                lab2,ft2=min(vals,key=lambda kv: abs(kv[1]-f))
                if abs(ft2-f)*12.5<7: inl.append((lab2,ft2,q))
            if best is None or len(inl)>len(best): best=inl
    # unique labels
    seen={}
    if not best: return seen
    for lab,ft,q in best:
        if lab not in seen: seen[lab]=(ft,q)
    return seen
res={}
for name,v in d.items():
    obs=[]  # (kind,rowkey,ft, u,v)
    for side in ["top","bottom"]:
        for lab,(ft,q) in label(v[side],LETX,0).items(): obs.append(("L",side,lab,ft,q[0],q[1]))
    for side in ["left","right"]:
        for lab,(ft,q) in label(v[side],NUMY,1).items(): obs.append(("N",side,lab,ft,q[0],q[1]))
    rows=sorted(set(o[1] for o in obs)); ri={r:i for i,r in enumerate(rows)}
    def model(p,o):
        ox,oy,sx,sy,th=p[:5]; off=p[5+ri[o[1]]]
        X,Y=(o[3],off) if o[0]=="L" else (off,o[3])
        c,s=np.cos(th),np.sin(th)
        return ox+sx*X*c-sy*Y*s, oy+sx*X*s+sy*Y*c
    def resid(p):
        r=[]
        for o in obs:
            u,w=model(p,o); r+= [u-o[4], w-o[5]]
        return r
    p0=[588,228,12.5,12.5,0]+[{"top":-9,"bottom":95,"left":-15,"right":253}[r] for r in rows]
    sol=least_squares(resid,p0)
    p=sol.x; rr=np.array(resid(p)).reshape(-1,2); err=np.hypot(rr[:,0],rr[:,1])/((p[2]+p[3])/2)
    res[name]={"sheet":v["sheet"],"origin_px":[round(p[0],2),round(p[1],2)],"px_per_ft":[round(p[2],4),round(p[3],4)],"theta_rad":round(p[4],6),
      "bubbles":[{"side":o[1],"grid":o[2],"px":[round(o[4],1),round(o[5],1)]} for o in obs],
      "max_resid_ft":round(float(err.max()),3),"rms_resid_ft":round(float(np.sqrt((err**2).mean())),3),"n":len(obs)}
    print(f"{name}: n={len(obs)} origin={res[name]['origin_px']} px/ft={res[name]['px_per_ft']} theta={p[4]*180/np.pi:.3f}deg max={err.max():.3f}ft rms={np.sqrt((err**2).mean()):.3f}ft")
    worst=np.argsort(err)[-2:]
    for i in worst: print("    worst",obs[i][:3],round(float(err[i]),3))
json.dump(res,open("frames.json","w"),indent=1)
