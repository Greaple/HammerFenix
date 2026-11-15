"""Makes the 2x set from the 4x one: area downscale (masks too), same names, exactly 2x size."""
import json, os, sys
import cv2

src, out, lst = sys.argv[1:4]
items = json.load(open(lst))
os.makedirs(out, exist_ok=True)
for name, it in items.items():
    for f in [name] + ([it['alpha']] if it['alpha'] else []):
        img = cv2.imread(os.path.join(src, f), cv2.IMREAD_UNCHANGED)
        assert img.shape[1] == it['w'] * 4 and img.shape[0] == it['h'] * 4, (f, img.shape)
        small = cv2.resize(img, (it['w'] * 2, it['h'] * 2), interpolation=cv2.INTER_AREA)
        p = os.path.join(out, f)
        cv2.imwrite(p, small, [cv2.IMWRITE_JPEG_QUALITY, 92] if f.endswith('.jpg') else [cv2.IMWRITE_PNG_COMPRESSION, 9])
print(f'{len(os.listdir(out))} files')
