import json, sys
out = {}
for f in sys.argv[1:]:
    d = json.load(open(f))
    ch = d['characters']
    bm = {k: v for k, v in ch.items() if v.get('kind') == 'bitmap'}
    rep = {}
    def walk(x):
        if isinstance(x, dict):
            if x.get('t') == 'bitmap':
                rep.setdefault(str(x['id']), set()).add(bool(x.get('repeat')))
            for v in x.values(): walk(v)
        elif isinstance(x, list):
            for v in x: walk(v)
    walk(ch)
    for k, v in bm.items():
        out[v['file']] = dict(alpha=v.get('alphaFile'), w=v['w'], h=v['h'], repeat=any(rep.get(k, {False})))
json.dump(out, sys.stdout, indent=0)
