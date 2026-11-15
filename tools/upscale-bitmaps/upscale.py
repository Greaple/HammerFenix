"""Upscale the game's bitmaps with a Spandrel-loaded model. Same filenames, exactly SCALE x size."""
import argparse, json, os, time
import cv2, numpy as np, torch
from spandrel import ModelLoader
import spandrel_extra_arches
spandrel_extra_arches.install()

ap = argparse.ArgumentParser()
ap.add_argument('--model', required=True); ap.add_argument('--src', required=True)
ap.add_argument('--list', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--scale', type=int, default=4); ap.add_argument('--only', nargs='*')
ap.add_argument('--tile', type=int, default=0)
ap.add_argument('--device', default='mps' if torch.backends.mps.is_available() else 'cpu')
a = ap.parse_args()

if a.model.endswith('.safetensors'):
    from safetensors.torch import load_file
    sd = load_file(a.model)
else:
    sd = torch.load(a.model, map_location='cpu', weights_only=True)  # no pickle code execution
model = ModelLoader().load_from_state_dict(sd).eval().to(a.device)
assert model.scale == 4, model.scale
print('arch:', model.architecture.name, 'device:', a.device, flush=True)

S, PAD, TINY = a.scale, 16, 12
os.makedirs(a.out, exist_ok=True)
items = json.load(open(a.list))
if a.only: items = {k: v for k, v in items.items() if k in a.only}

TILE, OV = a.tile, 16  # model input tile and overlap, in source pixels (0: whole image)

def color_fix(big, src):
    """Keep the model's detail but the original's colours: swap the low frequencies for the
    Lanczos upscale's (blur sigma 2 source pixels)."""
    ref = cv2.resize(src, (big.shape[1], big.shape[0]), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
    b = big.astype(np.float32); s = 2 * S
    out = b - cv2.GaussianBlur(b, (0, 0), s) + cv2.GaussianBlur(ref, (0, 0), s)
    return np.clip(out.round(), 0, 255).astype(np.uint8)

@torch.inference_mode()
def run(bgr):
    """BGR uint8 HxWx3 -> BGR uint8 at 4x, whole or in overlapping tiles (for attention models)."""
    x = torch.from_numpy(bgr[:, :, ::-1].copy()).permute(2, 0, 1)[None].float().div(255)
    _, _, H, W = x.shape
    if TILE == 0:
        y = model(x.to(a.device)).clamp(0, 1)[0].permute(1, 2, 0).cpu().numpy()
        return (y[:, :, ::-1] * 255).round().astype(np.uint8)
    out = torch.zeros(3, H * 4, W * 4)
    ys = list(range(0, max(H - TILE, 0) + 1, TILE - 2 * OV)) or [0]
    xs = list(range(0, max(W - TILE, 0) + 1, TILE - 2 * OV)) or [0]
    if ys[-1] + TILE < H: ys.append(H - TILE)
    if xs[-1] + TILE < W: xs.append(W - TILE)
    for y0 in ys:
        for x0 in xs:
            y1, x1 = min(y0 + TILE, H), min(x0 + TILE, W)
            t = model(x[:, :, y0:y1, x0:x1].to(a.device)).clamp(0, 1)[0].cpu()
            # Keep each tile's interior; the outer tile edges keep their border.
            iy0 = 0 if y0 == 0 else OV; iy1 = (y1 - y0) if y1 == H else (y1 - y0 - OV)
            ix0 = 0 if x0 == 0 else OV; ix1 = (x1 - x0) if x1 == W else (x1 - x0 - OV)
            out[:, (y0 + iy0) * 4:(y0 + iy1) * 4, (x0 + ix0) * 4:(x0 + ix1) * 4] = \
                t[:, iy0 * 4:iy1 * 4, ix0 * 4:ix1 * 4]
    y = out.permute(1, 2, 0).numpy()
    return (y[:, :, ::-1] * 255).round().astype(np.uint8)

def resize(img, w, h, interp=cv2.INTER_LANCZOS4):
    return cv2.resize(img, (w * S, h * S), interpolation=interp)

def write(name, img):
    p = os.path.join(a.out, name)
    cv2.imwrite(p, img, [cv2.IMWRITE_JPEG_QUALITY, 92] if name.endswith('.jpg') else [cv2.IMWRITE_PNG_COMPRESSION, 9])

t0 = time.time()
for i, (name, it) in enumerate(sorted(items.items())):
    w, h = it['w'], it['h']
    img = cv2.imread(os.path.join(a.src, name), cv2.IMREAD_UNCHANGED)
    assert img.shape[1] == w and img.shape[0] == h, (name, img.shape, w, h)
    gray = img.ndim == 2
    if gray: img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if it['alpha']:
        # A masked JPEG holds near-black where its mask is transparent: fill it the same way.
        ma = cv2.imread(os.path.join(a.src, it['alpha']), cv2.IMREAD_UNCHANGED)[:, :, 3]
        if (ma == 0).any():
            img = cv2.inpaint(np.ascontiguousarray(img[:, :, :3]), (ma == 0).astype(np.uint8), 3, cv2.INPAINT_TELEA)
    if img.shape[2] == 4 and (img[:, :, 3] == 0).any():
        # Fully transparent pixels hold black: give them their neighbours' colour so it does not
        # bleed into the visible edges when resampling.
        img = img.copy()
        img[:, :, :3] = cv2.inpaint(np.ascontiguousarray(img[:, :, :3]), (img[:, :, 3] == 0).astype(np.uint8), 3, cv2.INPAINT_TELEA)
    if min(w, h) < TINY:
        # Too small for the model to read anything: plain resize.
        out = resize(img, w, h, cv2.INTER_NEAREST if max(w, h) < TINY else cv2.INTER_LANCZOS4)
        how = 'resize'
    else:
        # Pad so the edges see their neighbours: wrap for repeating fills (no seams), replicate otherwise.
        rgb, alpha = img[:, :, :3], (img[:, :, 3] if img.shape[2] == 4 else None)
        p = min(PAD, w, h)
        border = cv2.BORDER_WRAP if it['repeat'] else cv2.BORDER_REPLICATE
        padded = cv2.copyMakeBorder(rgb, p, p, p, p, border)
        big = color_fix(run(padded), padded)
        out = big[p * S:(p + h) * S, p * S:(p + w) * S]
        if alpha is not None: out = np.dstack([out, resize(alpha, w, h)])
        how = 'model' + (' wrap' if it['repeat'] else '')
    if gray: out = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    assert out.shape[1] == w * S and out.shape[0] == h * S, (name, out.shape)
    write(name, out)
    if it['alpha']:
        m = cv2.imread(os.path.join(a.src, it['alpha']), cv2.IMREAD_UNCHANGED)
        mo = np.clip(resize(m, w, h, cv2.INTER_CUBIC), 0, 255)  # less ringing than Lanczos on hard edges
        assert mo.shape[1] == w * S and mo.shape[0] == h * S
        write(it['alpha'], mo)
    print(f'{i+1}/{len(items)} {name} {w}x{h} -> {w*S}x{h*S} {how}', flush=True)
print(f'done in {time.time()-t0:.0f}s')
