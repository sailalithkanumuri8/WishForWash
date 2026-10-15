#!/usr/bin/env python3
"""Turn a source photo into a Wish for Wash place image.

Steps: crop to 3:2 around a focal point -> resize to 960x640 -> light-blue
duotone (luminance mapped through #0E2A4F -> #2F64A8 -> #D9ECFA, then
blended ~75% duotone / ~25% original colour) -> WebP under a size budget.

Usage:
  python3 tools/process-photos.py INPUT OUTPUT.webp [options]

Examples:
  python3 tools/process-photos.py original.jpg assets/img/places/coast.webp
  python3 tools/process-photos.py pano.jpg out.webp --focus 0.33,0.5
  python3 tools/process-photos.py photo.jpg out.webp --crop 0.05,0.1,0.95,0.9 --gamma 0.9

Options (all optional):
  --focus X,Y     focal point as fractions of width/height (default 0.5,0.5).
                  The largest 3:2 window (divided by --zoom) is centred on it,
                  clamped to the image edges.
  --zoom Z        >1 crops tighter around the focus (default 1.0).
  --crop L,T,R,B  explicit crop box as fractions; it is snapped to 3:2
                  around its own centre. Overrides --focus/--zoom.
  --blend B       share of original colour kept (default 0.25).
  --mid M         gradient position of the mid stop #2F64A8 (default 0.5).
  --gamma G       midtone gamma applied to luminance (<1 brighter, default 1.0).
  --contrast C    S-curve strength 0..1 (default 0.25).
  --clip P        percent clipped at each end when auto-levelling (default 0.5).
  --soften R      light Gaussian blur radius in px after resizing (default 0);
                  helps very busy scenes (bare branches) fit the size budget.
  --target-kb N   soft size target; quality steps down until met (default 110).
  --max-kb N      hard size limit; the script fails above it (default 150).
  --quality Q     starting WebP quality (default 86).
  --preview PNG   also write a PNG decoded from the final WebP, for review.

Requires Pillow and numpy. Uses cwebp when available (PATH or
/opt/homebrew/bin), otherwise Pillow's WebP encoder.
"""
import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter, ImageOps

OUT_W, OUT_H = 960, 640
SHADOW = (0x0E, 0x2A, 0x4F)
MID = (0x2F, 0x64, 0xA8)
HIGHLIGHT = (0xD9, 0xEC, 0xFA)


def parse_pair(text, n):
    vals = [float(v) for v in text.split(",")]
    if len(vals) != n:
        raise argparse.ArgumentTypeError(f"expected {n} comma-separated numbers")
    return vals


def load_rgb(path):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    icc = im.info.get("icc_profile")
    if icc:
        try:
            from PIL import ImageCms
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            im = ImageCms.profileToProfile(im, src, dst, outputMode="RGB")
        except Exception:  # noqa: BLE001 - fall back to untagged conversion
            pass
    if im.mode != "RGB":
        im = im.convert("RGB")
    return im


def crop_box(w, h, focus=(0.5, 0.5), zoom=1.0, box=None):
    """Return an integer (left, top, right, bottom) 3:2 box inside w x h."""
    ratio = OUT_W / OUT_H
    if box is not None:
        l, t, r, b = box[0] * w, box[1] * h, box[2] * w, box[3] * h
        cx, cy = (l + r) / 2, (t + b) / 2
        bw, bh = r - l, b - t
        if bw / bh > ratio:
            bw = bh * ratio
        else:
            bh = bw / ratio
    else:
        if w / h > ratio:
            bh = h / zoom
            bw = bh * ratio
        else:
            bw = w / zoom
            bh = bw / ratio
        cx, cy = focus[0] * w, focus[1] * h
    bw, bh = min(bw, w), min(bh, h)
    left = min(max(cx - bw / 2, 0), w - bw)
    top = min(max(cy - bh / 2, 0), h - bh)
    return (round(left), round(top), round(left + bw), round(top + bh))


def tone_map(lum, clip=0.5, gamma=1.0, contrast=0.25):
    lo, hi = np.percentile(lum, [clip, 100 - clip])
    if hi - lo < 0.3:  # don't blow up flat or hazy frames
        c = (hi + lo) / 2
        lo, hi = max(c - 0.15, 0.0), min(c + 0.15, 1.0)
    y = np.clip((lum - lo) / max(hi - lo, 1e-6), 0, 1)
    if gamma != 1.0:
        y = y ** gamma
    if contrast:
        y = (1 - contrast) * y + contrast * (y * y * (3 - 2 * y))
    return y


def duotone(rgb, blend=0.25, mid=0.5, gamma=1.0, contrast=0.25, clip=0.5):
    arr = np.asarray(rgb, dtype=np.float32) / 255.0
    lum = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    y = tone_map(lum, clip=clip, gamma=gamma, contrast=contrast)
    stops = [0.0, mid, 1.0]
    tone = np.stack([
        np.interp(y, stops, [SHADOW[i] / 255, MID[i] / 255, HIGHLIGHT[i] / 255])
        for i in range(3)
    ], axis=-1)
    out = (1 - blend) * tone + blend * arr
    return Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), "RGB")


def find_cwebp():
    for cand in (shutil.which("cwebp"), "/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp"):
        if cand and os.path.exists(cand):
            return cand
    return None


def encode_webp(img, quality):
    cwebp = find_cwebp()
    if cwebp:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = os.path.join(tmp, "in.png"), os.path.join(tmp, "out.webp")
            img.save(src)
            subprocess.run([cwebp, "-quiet", "-q", str(quality), "-m", "6", "-sharp_yuv",
                            "-metadata", "none", src, "-o", dst], check=True)
            with open(dst, "rb") as f:
                return f.read()
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--focus", type=lambda s: parse_pair(s, 2), default=[0.5, 0.5])
    p.add_argument("--zoom", type=float, default=1.0)
    p.add_argument("--crop", type=lambda s: parse_pair(s, 4), default=None)
    p.add_argument("--blend", type=float, default=0.25)
    p.add_argument("--mid", type=float, default=0.5)
    p.add_argument("--gamma", type=float, default=1.0)
    p.add_argument("--contrast", type=float, default=0.25)
    p.add_argument("--clip", type=float, default=0.5)
    p.add_argument("--soften", type=float, default=0.0)
    p.add_argument("--target-kb", type=float, default=110)
    p.add_argument("--max-kb", type=float, default=150)
    p.add_argument("--quality", type=int, default=86)
    p.add_argument("--preview", default=None)
    a = p.parse_args(argv)

    im = load_rgb(a.input)
    box = crop_box(im.width, im.height, a.focus, a.zoom, a.crop)
    im = im.crop(box)
    # Pre-shrink very large crops with a box filter, then finish with Lanczos.
    factor = min(im.width // (OUT_W * 2), im.height // (OUT_H * 2))
    if factor >= 2:
        im = im.reduce(factor)
    im = im.resize((OUT_W, OUT_H), Image.LANCZOS)
    if a.soften > 0:
        im = im.filter(ImageFilter.GaussianBlur(a.soften))

    toned = duotone(im, a.blend, a.mid, a.gamma, a.contrast, a.clip)

    q = a.quality
    data = encode_webp(toned, q)
    while len(data) > a.target_kb * 1024 and q > 50:
        q -= 4
        data = encode_webp(toned, q)
    kb = len(data) / 1024
    if kb >= a.max_kb:
        sys.exit(f"error: {a.output} is {kb:.1f} KB (limit {a.max_kb} KB)")

    os.makedirs(os.path.dirname(os.path.abspath(a.output)), exist_ok=True)
    with open(a.output, "wb") as f:
        f.write(data)
    if a.preview:
        Image.open(io.BytesIO(data)).convert("RGB").save(a.preview)
    print(f"{a.output}: crop={box} quality={q} size={kb:.1f} KB")


if __name__ == "__main__":
    main()
