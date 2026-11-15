import cv2, numpy as np, sys, json, os
src, hd = sys.argv[1:3]; items = json.load(open(sys.argv[3])); r = []
for n, it in items.items():
    if min(it['w'], it['h']) < 12: continue
    oo = cv2.imread(os.path.join(src, n), cv2.IMREAD_UNCHANGED); u = cv2.imread(os.path.join(hd, n))[:, :, :3]
    if oo.ndim == 2: continue
    o = oo[:, :, :3].astype(float)
    d = cv2.resize(u, (it['w'], it['h']), interpolation=cv2.INTER_AREA).astype(float)
    m = np.ones(o.shape[:2], bool)
    if oo.shape[2] == 4: m = oo[:, :, 3] > 0
    if it['alpha']: m &= cv2.imread(os.path.join(src, it['alpha']), cv2.IMREAD_UNCHANGED)[:, :, 3] > 0
    if not m.any(): continue
    r.append((np.abs(o[m].mean(0) - d[m].mean(0)).max(), np.abs(o[m] - d[m]).mean(), n))
r.sort(reverse=True)
print('worst mean-colour shift / mean abs diff:', [(round(a, 1), round(b, 1), n) for a, b, n in r[:8]])
print('median abs diff', round(float(np.median([b for _, b, _ in r])), 1))
