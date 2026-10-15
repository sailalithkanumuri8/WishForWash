#!/usr/bin/env python3
"""Regenerate the Wish for Wash brand assets from the LMC 3403 poster.

usage:
    python3 tools/extract-poster-assets.py "<poster.png>" <repo_root> \
        [--gt-svg <Georgia_Tech_logo_2021.svg>] [--debug <dir>]

Writes (paths relative to repo_root):
    assets/img/globe-in-hands.webp, assets/img/globe-in-hands-640.webp,
    assets/img/globe-in-hands.json
    assets/img/bottle.webp, assets/img/bottle.json
    assets/svg/wordmark.svg
    public/favicon.svg, public/favicon-48.png, public/apple-touch-icon.png
    public/og-image.jpg
    assets/img/gt-logo.svg, assets/img/gt-logo-reversed.svg,
    assets/img/gt-logo-horizontal.svg            (only with --gt-svg)

The poster is flat artwork on one solid background colour (rgb 80,134,194), so
everything here is "difference matting" against that colour:

* Opaque painted parts (earth bowl, water surface, drop, hands, bottle) are
  segmented from the art's own outlines and kept at alpha 1. Their outer
  anti-aliased rim gets alpha by projecting each pixel onto the line between
  the background and the nearest interior colour F, and takes F's colour, so
  no periwinkle fringe survives.
* The translucent glass sphere is un-composited per pixel: alpha is the
  smallest value that keeps the recovered colour inside [0, 255]
  ("minimum alpha"), and the colour is decontaminated with
  C = (P - (1 - a) * B) / a. Composited back over the poster colour this
  reproduces the poster exactly; over darker blues the glass stays glass.

The GT logos are not traced from the poster: --gt-svg takes the official vector file
"File:Georgia Tech logo 2021.svg" from Wikimedia Commons
(https://upload.wikimedia.org/wikipedia/commons/9/93/Georgia_Tech_logo_2021.svg) and recomposes
its own paths into the stacked "GT / Georgia Tech" lockup printed on the poster.

Coordinates and colour thresholds are specific to this one poster.
Requires numpy, scipy, opencv-python and Pillow (with WebP support).
"""
import argparse
import json
import os
import re

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

BG = np.array([80.0, 134.0, 194.0])      # flat poster background (#5086C2)
ICE = np.array([215.0, 237.0, 249.0])    # wordmark colour as printed
WASH_BLUE = (80, 135, 196)               # site token --wash-blue #5087C4
ICE_HEX = "#D9ECFA"                      # site token --wash-ice


# --------------------------------------------------------------------------- helpers
def min_alpha(img, bg=BG):
    """Smallest alpha that keeps (P - (1 - a) * bg) / a inside [0, 255]."""
    diff = img - bg
    up = np.where(diff > 0, diff / (255.0 - bg), 0.0)
    dn = np.where(diff < 0, -diff / bg, 0.0)
    return np.clip(np.maximum(up, dn).max(axis=2), 0.0, 1.0)


def decontaminate(img, alpha, bg=BG):
    """C = (P - (1 - a) * B) / a, i.e. B + (P - B) / a."""
    a = np.maximum(alpha, 1e-6)[..., None]
    return np.clip(bg + (img - bg) / a, 0.0, 255.0)


def edge_matte(img, mask, bg=BG, inner=2):
    """Alpha + colour for the anti-aliased rim of an opaque shape on the flat background."""
    interior = ndi.binary_erosion(mask, iterations=inner)
    _, (iy, ix) = ndi.distance_transform_edt(~interior, return_indices=True)
    F = img[iy, ix]
    FB = F - bg
    a = ((img - bg) * FB).sum(axis=2) / np.maximum((FB * FB).sum(axis=2), 1.0)
    return np.clip(a, 0.0, 1.0), F, interior


def bleed(rgb, alpha, thresh=0.5):
    """Copy the nearest solid colour under transparent pixels so resampling cannot fringe."""
    solid = alpha >= thresh
    if solid.all():
        return rgb
    _, (iy, ix) = ndi.distance_transform_edt(~solid, return_indices=True)
    out = rgb.copy()
    out[~solid] = rgb[iy, ix][~solid]
    return out


def to_rgba_image(rgb, alpha):
    arr = np.dstack([np.clip(np.round(rgb), 0, 255), np.clip(np.round(alpha * 255.0), 0, 255)])
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def resize_rgba(img, size, sharpen=False):
    """Resize straight-alpha RGBA with bled colours (no dark or periwinkle fringes)."""
    arr = np.asarray(img).astype(np.float64)
    rgb, a = arr[..., :3], arr[..., 3] / 255.0
    rgb = bleed(rgb, a, 0.02)
    rgb_img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").resize(size, Image.LANCZOS)
    if sharpen:
        rgb_img = rgb_img.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=2))
    a_img = Image.fromarray(np.clip(a * 255.0, 0, 255).astype(np.uint8), "L").resize(size, Image.LANCZOS)
    out = rgb_img.convert("RGBA")
    out.putalpha(a_img)
    return out


def save_webp(img, path, quality, alpha_quality=100):
    img.save(path, "WEBP", quality=quality, alpha_quality=alpha_quality, method=6)
    return os.path.getsize(path)


def fit_circle(pts):
    A = np.c_[2 * pts[:, 0], 2 * pts[:, 1], np.ones(len(pts))]
    b = (pts ** 2).sum(axis=1)
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    return cx, cy, float(np.sqrt(c + cx * cx + cy * cy))


def ransac_circle(pts, iters=3000, tol=2.5, seed=0):
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(iters):
        sample = pts[rng.choice(len(pts), 3, replace=False)]
        try:
            cx, cy, r = fit_circle(sample)
        except np.linalg.LinAlgError:
            continue
        inl = np.abs(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) - r) < tol
        if best is None or inl.sum() > best.sum():
            best = inl
    return fit_circle(pts[best])


def composite(rgba, bg):
    a = rgba[..., 3:4] / 255.0
    return rgba[..., :3] * a + np.array(bg, dtype=np.float64) * (1 - a)


def padded(fn, mask, pad=12, **kw):
    """Run a morphology op as if shapes continued past the image border (the arms run off the poster)."""
    out = fn(np.pad(mask, pad, mode="edge"), **kw)
    return out[pad:-pad, pad:-pad]


# --------------------------------------------------------------------------- globe-in-hands
def extract_globe(img, debug=None):
    H, W, _ = img.shape
    R, G, Bc = img[..., 0], img[..., 1], img[..., 2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    dist_bg = np.sqrt(((img - BG) ** 2).sum(axis=2))
    nonbg = dist_bg > 12

    # 1. Glass sphere: RANSAC circle through the outer rim where it meets plain background.
    pts = []
    for y in range(1060, 1420, 6):                      # left arc
        xs = np.where(nonbg[y, 600:1100])[0]
        if len(xs):
            pts.append((600 + xs[0], y))
    for x in range(800, 1230, 8):                       # top arc
        ys = np.where(nonbg[980:1300, x])[0]
        if len(ys):
            pts.append((x, 980 + ys[0]))
    for y in range(1340, 1640, 6):                      # right arc
        xs = np.where(nonbg[y, 1300:1545])[0]
        if len(xs):
            pts.append((1300 + xs[-1], y))
    scx, scy, sr = ransac_circle(np.array(pts, dtype=np.float64))
    dist_s = np.hypot(xx - scx, yy - scy)

    # 2. Back (top) rim of the water surface: first rim-line pixel under the glass, column by column.
    def prior(x):
        return 1300 + 0.000584 * (x - 1100) ** 2

    back = []
    for x in range(712, 1490):
        if 1022 <= x <= 1188:                           # the drop hides the rim here
            continue
        y0 = int(prior(x) - 22)
        idx = np.where(R[y0:y0 + 44, x] < 175)[0]
        if len(idx):
            back.append((x, y0 + idx[0]))
    back = np.array(back, dtype=np.float64)
    keep = np.ones(len(back), bool)
    for _ in range(6):
        poly = np.polyfit(back[keep, 0], back[keep, 1], 4)
        keep = np.abs(back[:, 1] - np.polyval(poly, back[:, 0])) < 3.5
    xl, xr = back[keep, 0].min(), back[keep, 0].max()
    yl, yr = np.polyval(poly, xl), np.polyval(poly, xr)
    cols = np.arange(W)
    toprim = np.full(W, np.inf)
    inside = (cols >= xl) & (cols <= xr)
    toprim[inside] = np.polyval(poly, cols[inside])
    for (x, y), ok in zip(back, keep):                  # follow the painted wobble
        if ok:
            toprim[int(x)] = min(toprim[int(x)], y)
    toprim[cols < xl] = yl - 1
    toprim[cols > xr] = yr - 1
    toprim = ndi.median_filter(toprim, size=5, mode="nearest")
    below_rim = yy >= (toprim[None, :] - 1.5)

    # Front rim (only used to describe the water ellipse for the front end).
    front = []
    for x in range(716, 1486, 2):
        if 1010 <= x <= 1200:
            continue
        yb = int(np.polyval(poly, x))
        col = img[yb + 15:yb + 190, x]
        dk = np.where((col[:, 0] < 120) & (col.max(axis=1) < 205))[0]
        if len(dk):
            front.append((x, yb + 15 + dk[0]))
    front = np.array(front, dtype=np.float64)

    # 3. Earth bowl side: outermost blue outline pixel along rays from the sphere centre.
    angles = np.arange(-40, 220.01, 0.5)
    prof = np.full(len(angles), np.nan)
    for i, deg in enumerate(angles):
        t = np.deg2rad(deg)
        for r in np.arange(360, 424, 0.5):
            xi = int(round(scx + r * np.cos(t)))
            yi = int(round(scy + r * np.sin(t)))
            if not (0 <= xi < W and 0 <= yi < H):
                break
            p = img[yi, xi]
            if p.max() < 190 and p[2] > p[0] + 40 and p[0] < 110:
                prof[i] = r
    valid = ~np.isnan(prof)
    med = ndi.median_filter(np.where(valid, prof, 398.0), size=15, mode="nearest")
    prof[valid & (np.abs(prof - med) > 4)] = np.nan
    valid = ~np.isnan(prof)
    prof = ndi.median_filter(np.interp(angles, angles[valid], prof[valid]), size=7, mode="nearest")
    theta = np.degrees(np.arctan2(yy - scy, xx - scx))
    theta[theta < -40] += 360
    earth = (dist_s <= np.interp(theta, angles, prof) + 1.2) & below_rim & (dist_s <= sr)

    # 4. The drop standing on the water (its blues sit close to the background, so segment it by shape).
    #    Above the rim it is the dark region inside the light glass; its round bottom (over the
    #    water, which is opaque anyway) is a circle fitted to the dark outline, for the JSON only.
    bx0, by0, bx1, by1 = 1015, 1120, 1195, 1420
    win = R[by0:by1, bx0:bx1]
    lab, _ = ndi.label(win < 186)
    upper = lab == lab[1300 - by0, 1110 - bx0]
    drop = np.zeros((H, W), bool)
    drop[by0:by1, bx0:bx1] = ndi.binary_fill_holes(ndi.binary_closing(upper, iterations=2))
    drop &= yy < toprim[None, :]
    rr, cc = np.where((img[by0:by1, bx0:bx1, 0] < 66) & (img[by0:by1, bx0:bx1, 1] < 125))
    opts = np.c_[bx0 + cc, by0 + rr].astype(np.float64)
    opts = opts[(opts[:, 1] > 1325) & (opts[:, 1] < 1400)]
    dcx, dcy, dr = ransac_circle(opts, tol=2.0)
    drop_full = drop | ((np.hypot(xx - dcx, yy - dcy) <= dr) & (yy >= toprim[None, :]))
    drop = ndi.binary_dilation(drop, iterations=1)

    # 5. Hands and arms: skin + their grey-brown outline, minus the river/cloud outline stubs.
    skin = (R - Bc > 28) & (R > 150) & (G > 110) & (yy > 1550) & (xx > 600) & ~(dist_s < 380)
    skin = padded(ndi.binary_opening, skin, iterations=1)
    lab, n = ndi.label(skin)
    sizes = ndi.sum(skin, lab, range(1, n + 1))
    skin = np.isin(lab, 1 + np.where(sizes > 4000)[0])
    outline_like = (np.abs(R - Bc) < 60) & (np.maximum(np.maximum(R, G), Bc) < 175) & (Bc - R < 40)
    hands = skin | (outline_like & ndi.binary_dilation(skin, iterations=7))
    pinkish = (R - Bc > 6) & (R > 170) & (dist_s <= sr + 1)   # hand seen through the glass
    hands |= pinkish & ndi.binary_dilation(skin, iterations=30)
    hands = padded(lambda m: ndi.binary_fill_holes(ndi.binary_closing(m, iterations=3)), hands)
    disk_pad = dist_s <= sr + 2
    disk_core = dist_s <= sr - 2
    out_part = hands & ~disk_core
    ell5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)).astype(bool)
    out_part = padded(ndi.binary_opening, out_part, structure=ell5)   # drop thin river-outline stubs
    lab, n = ndi.label(out_part)
    if n:
        sizes = ndi.sum(out_part, lab, range(1, n + 1))
        out_part = np.isin(lab, 1 + np.where(sizes > 500)[0])
    hands = (hands & disk_core) | out_part

    # 6. Alpha.
    cov = np.zeros((H, W))
    for sy in range(4):                                  # 4x4 supersampled sphere coverage
        for sx in range(4):
            cov += np.hypot(xx + (sx + 0.5) / 4 - 0.5 - scx, yy + (sy + 0.5) / 4 - 0.5 - scy) <= sr - 1.0
    cov /= 16.0

    opaque = earth | drop | hands
    alpha = np.zeros((H, W))
    color = img.copy()

    glass = (cov > 0) & ~opaque
    a_min = min_alpha(img)
    alpha[glass] = a_min[glass] * cov[glass]
    color[glass] = decontaminate(img, a_min)[glass]
    alpha[opaque] = 1.0

    # Hands outside the glass: the painted outline sits on river and cloud as well as on the flat
    # background, so take a 1px anti-aliased edge from the cleaned mask and pull the outline colour
    # from just inside it instead of trusting the mixed edge pixels.
    outside = ~(opaque | (cov > 0))
    hand_out = hands & ~disk_pad
    soft = ndi.gaussian_filter(hands.astype(np.float64), 0.75, mode="nearest")
    a_soft = np.clip((soft - 0.5) * 2.2 + 0.5, 0.0, 1.0)
    zone = ndi.binary_dilation(outside, iterations=3) & ndi.binary_dilation(hand_out, iterations=3)
    hand_px = zone & hands
    out_px = zone & outside
    alpha[hand_px] = a_soft[hand_px]
    alpha[out_px] = a_soft[out_px]
    inner2 = padded(ndi.binary_erosion, hands, iterations=2)
    rim = (hand_px & ~inner2) | (out_px & (a_soft > 0))
    src_px = inner2 & outline_like
    _, (iy, ix) = ndi.distance_transform_edt(~src_px, return_indices=True)
    color[rim] = img[iy, ix][rim]

    ys, xs = np.where(alpha > 0.004)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    rgba = np.dstack([color, alpha * 255.0])[y0:y1, x0:x1]
    out = to_rgba_image(rgba[..., :3], rgba[..., 3] / 255.0)

    # 7. Geometry for animated overlays, in output-image pixels.
    dys, dxs = np.where(drop_full)
    drop_box = dict(x=int(dxs.min() - x0), y=int(dys.min() - y0),
                    width=int(dxs.max() - dxs.min() + 1), height=int(dys.max() - dys.min() + 1))
    ripple = dict(cx=round(dcx - x0, 1), cy=round(dcy + dr - 3 - y0, 1))   # where the drop meets the water
    # Water surface ellipse: ends at the bowl's two top corners; centre height and ry by least
    # squares on the middle 60% of the back rim (upper arc) and front rim (lower arc).
    ey_, ex_ = np.where(earth & (yy <= max(yl, yr) + 18))
    wl, wr = ex_.min(), ex_.max() + 1
    ecx, erx = (wl + wr) / 2, (wr - wl) / 2
    rows, rhs = [], []
    for pts_, sign in ((back[keep], -1.0), (front, 1.0)):
        pts_ = pts_[np.abs(pts_[:, 0] - ecx) < erx * 0.6]
        s = np.sqrt(1.0 - ((pts_[:, 0] - ecx) / erx) ** 2)
        rows.append(np.c_[np.ones(len(pts_)), sign * s])
        rhs.append(pts_[:, 1])
    ecy, ery = np.linalg.lstsq(np.vstack(rows), np.concatenate(rhs), rcond=None)[0]

    geom = {
        "file": "globe-in-hands.webp",
        "image": {"width": out.width, "height": out.height},
        "globe": {"cx": round(scx - x0, 1), "cy": round(scy - y0, 1), "r": round(sr, 1)},
        "water": {"cx": round(ecx - x0, 1), "cy": round(ecy - y0, 1), "rx": round(erx, 1), "ry": round(ery, 1)},
        "drop": drop_box,
        "ripple": ripple,
        "posterCrop": [int(x0), int(y0), int(x1), int(y1)],
        "notes": ("Pixel coordinates in globe-in-hands.webp. Multiply by (rendered width / image.width) "
                  "for any other size, e.g. 640 / image.width for globe-in-hands-640.webp. The arms are "
                  "cut off by the bottom and right edges of the image, as on the poster; the glass "
                  "dome is translucent (alpha ~0.75-0.97), everything else is opaque."),
    }

    if debug:
        dbg = img.copy()
        for m, col, a in [(earth & ~drop, (255, 0, 0), .4), (drop, (255, 255, 0), .5),
                          (hands, (0, 255, 0), .4), (glass, (255, 0, 255), .25)]:
            dbg[m] = dbg[m] * (1 - a) + np.array(col) * a
        dbg = np.clip(dbg, 0, 255).astype(np.uint8)
        cv2.ellipse(dbg, (int(ecx), int(ecy)), (int(erx), int(ery)), 0, 0, 360, (0, 0, 0), 1)
        cv2.circle(dbg, (int(scx), int(scy)), int(sr), (0, 0, 0), 1)
        cv2.circle(dbg, (int(ripple["cx"] + x0), int(ripple["cy"] + y0)), 5, (255, 255, 255), -1)
        Image.fromarray(dbg[y0:y1, x0:x1]).save(os.path.join(debug, "globe_masks.png"))
    return out, geom


# --------------------------------------------------------------------------- bottle
def extract_bottle(img, debug=None):
    x0, y0, x1, y1 = 1100, 240, 1345, 615               # mock-up only (no arrow, no cards)
    sub = img[y0:y1, x0:x1]
    dist_bg = np.sqrt(((sub - BG) ** 2).sum(axis=2))
    lab, n = ndi.label(dist_bg > 6)
    sizes = ndi.sum(np.ones_like(dist_bg), lab, range(1, n + 1))
    body = lab == 1 + int(np.argmax(sizes))
    sil = ndi.binary_fill_holes(body)
    holes = sil & ~body                                 # re-open the loop handle's opening
    hl, hn = ndi.label(holes)
    opened = np.zeros_like(sil)
    for j in range(1, hn + 1):
        h = hl == j
        if h.sum() >= 30 and dist_bg[h].mean() < 4:
            sil &= ~h
            opened |= h
    # Matte a rim zone: the outer 2px everywhere, plus background-like pixels up to 6px in
    # (the handle's opening fades softly into the background). Deeper pixels stay opaque even
    # when their blue happens to sit near the background colour (the drop logo does).
    fringe = ndi.binary_dilation(sil, iterations=2) & ~sil
    near = sil & ~ndi.binary_erosion(sil, iterations=6)
    soft = (near & (dist_bg <= 28)) | (sil & ~ndi.binary_erosion(sil, iterations=2))
    solid = sil & ~soft
    _, (iy, ix) = ndi.distance_transform_edt(~solid, return_indices=True)
    F = sub[iy, ix]
    FB = F - BG
    a_proj = np.clip(((sub - BG) * FB).sum(axis=2) / np.maximum((FB * FB).sum(axis=2), 1.0), 0.0, 1.0)
    band = soft | fringe
    alpha = np.where(solid, 1.0, 0.0)
    alpha[band] = a_proj[band]
    color = sub.copy()
    color[band] = F[band]
    # The handle's opening is a low-contrast edge (handle blue against background blue), where the
    # colour projection is noisy; give it a smooth edge from a cleaned 50%-coverage mask instead.
    if opened.any():
        zone = ndi.binary_dilation(opened, iterations=5) & ~ndi.binary_erosion(opened, iterations=2)
        dF = np.sqrt(((F - BG) ** 2).sum(axis=2))
        cov = np.clip(dist_bg / np.maximum(dF, 1.0), 0.0, 1.0)
        hole = opened | (zone & (cov < 0.5))
        hole = ndi.binary_closing(ndi.binary_opening(hole, iterations=1), iterations=1)
        a_geo = 1.0 - np.clip((ndi.gaussian_filter(hole.astype(np.float64), 0.8) - 0.5) * 2.2 + 0.5, 0, 1)
        alpha[zone] = a_geo[zone]
        keep_px = zone & (a_geo >= 0.9)
        color[zone] = F[zone]
        color[keep_px] = sub[keep_px]
    ys, xs = np.where(alpha > 0.004)
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    rgb, a = color[by0:by1, bx0:bx1], alpha[by0:by1, bx0:bx1]
    img_1x = to_rgba_image(bleed(rgb, a, 0.02), a)
    out = resize_rgba(img_1x, (img_1x.width * 2, img_1x.height * 2), sharpen=True)

    # Painted sparkles (4-point stars) and white bubbles, for optional twinkle overlays: seeded at
    # positions read off the 2x image, then snapped to the white shape found in a local window.
    arr = np.asarray(out).astype(np.int32)
    opaque_px = arr[..., 3] > 250
    tests = {
        "white": (arr[..., 0] > 225) & (arr[..., 1] > 238) & (arr[..., 2] > 244) & opaque_px,  # star cores
        "pale": (arr[..., 0] > 200) & (arr[..., 1] > 225) & (arr[..., 2] > 240) & opaque_px,   # bubbles
        "soft": (arr[..., 0] > 165) & (arr[..., 1] > 215) & (arr[..., 2] > 238) & opaque_px,   # bubble on a wave
    }
    seeds = [("sparkle", 88, 296, 30, "white"), ("sparkle", 297, 403, 24, "white"),
             ("bubble", 301, 458, 12, "pale"), ("bubble", 41, 473, 12, "pale"), ("bubble", 62, 609, 14, "pale"),
             ("bubble", 218, 614, 10, "pale"), ("bubble", 90, 627, 8, "pale"), ("bubble", 284, 600, 12, "soft")]
    marks = []
    for kind, sx, sy, r, test in seeds:
        win = tests[test][sy - r:sy + r, sx - r:sx + r]
        lab, n = ndi.label(win)
        if not n:
            continue
        k = 1 + int(np.argmax(ndi.sum(win, lab, range(1, n + 1))))
        ys, xs = np.where(lab == k)
        marks.append({"type": kind, "x": int(sx - r + xs.min()), "y": int(sy - r + ys.min()),
                      "width": int(xs.max() - xs.min() + 1), "height": int(ys.max() - ys.min() + 1),
                      "cx": round(float(sx - r + xs.mean()), 1), "cy": round(float(sy - r + ys.mean()), 1)})
    meta = {"file": "bottle.webp", "image": {"width": out.width, "height": out.height},
            "scale": "2x upscale of the poster mock-up (Lanczos + light unsharp mask)",
            "marks": marks,
            "notes": ("Boxes and centres are in bottle.webp pixels. 'sparkle' = painted white 4-point star, "
                      "'bubble' = painted white bubble. The two blue water drops and the logo are not listed.")}
    if debug:
        Image.fromarray(np.clip(composite(np.asarray(out).astype(np.float64), (14, 42, 79)), 0, 255)
                        .astype(np.uint8)).save(os.path.join(debug, "bottle_navy.png"))
    return out, meta


# --------------------------------------------------------------------------- wordmark
def _rectilinear(poly, is_hole, bias, min_len=1.6):
    """Turn a near-rectilinear closed polygon into exact horizontal/vertical runs.

    The contour runs through the centres of the outermost foreground pixels, so every run is
    pushed `bias` away from the letter's material (out of an outer ring, into a hole).
    """
    n = len(poly)
    segs = []
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        dx, dy = q[0] - p[0], q[1] - p[1]
        length = float(np.hypot(dx, dy))
        if length < 1e-9:
            continue
        if abs(dx) >= abs(dy):
            segs.append(["H", length, (p[1] + q[1]) / 2, min(p[0], q[0]), max(p[0], q[0])])
        else:
            segs.append(["V", length, (p[0] + q[0]) / 2, min(p[1], q[1]), max(p[1], q[1])])

    def join(a_, b_):
        tot = a_[1] + b_[1]
        return [a_[0], tot, (a_[2] * a_[1] + b_[2] * b_[1]) / tot, min(a_[3], b_[3]), max(a_[4], b_[4])]

    changed = True
    while changed and len(segs) > 4:                     # merge equal kinds, drop AA crumbs
        changed = False
        merged = []
        for s in segs:
            if merged and merged[-1][0] == s[0]:
                merged[-1] = join(merged[-1], s)
                changed = True
            else:
                merged.append(s)
        if len(merged) > 1 and merged[0][0] == merged[-1][0]:
            merged[0] = join(merged[-1], merged[0])
            merged.pop()
            changed = True
        shortest = min(range(len(merged)), key=lambda k: merged[k][1])
        if merged[shortest][1] < min_len and len(merged) > 4:
            merged.pop(shortest)
            changed = True
        segs = merged
    contour = poly.astype(np.float32).reshape(-1, 1, 2)
    for s in segs:                                       # push each run off the material
        mid = (s[3] + s[4]) / 2
        probe = (mid, s[2] + 0.75) if s[0] == "H" else (s[2] + 0.75, mid)
        plus_inside = cv2.pointPolygonTest(contour, (float(probe[0]), float(probe[1])), False) > 0
        material_plus = plus_inside != is_hole           # material lies on the + side
        s[2] += -bias if material_plus else bias
    # corners: each H run meets the following V run
    pts = []
    for i, s in enumerate(segs):
        nxt = segs[(i + 1) % len(segs)]
        if s[0] == "H" and nxt[0] == "V":
            pts.append((int(round(nxt[2])), int(round(s[2]))))
        elif s[0] == "V" and nxt[0] == "H":
            pts.append((int(round(s[2])), int(round(nxt[2]))))
    clean = []
    for p in pts:                                         # drop duplicates and collinear points
        if clean and clean[-1] == p:
            continue
        clean.append(p)
    if len(clean) > 1 and clean[0] == clean[-1]:
        clean.pop()
    changed = True
    while changed and len(clean) > 3:
        changed = False
        for i in range(len(clean)):
            a_, b_, c_ = clean[i - 1], clean[i], clean[(i + 1) % len(clean)]
            if (a_[0] == b_[0] == c_[0]) or (a_[1] == b_[1] == c_[1]):
                clean.pop(i)
                changed = True
                break
    return clean


def _path_d(pts, ox, oy):
    x0_, y0_ = pts[0]
    d = [f"M{x0_ - ox} {y0_ - oy}"]
    px, py = x0_, y0_
    for x, y in pts[1:] + [pts[0]]:
        if y == py:
            d.append(f"H{x - ox}")
        elif x == px:
            d.append(f"V{y - oy}")
        else:
            d.append(f"L{x - ox} {y - oy}")
        px, py = x, y
    d.append("Z")
    return "".join(d)


def trace_wordmark(img):
    x0, y0, x1, y1 = 50, 70, 1160, 230
    sub = img[y0:y1, x0:x1]
    v = ICE - BG
    cov = np.clip(((sub - BG) @ v) / (v @ v), 0.0, 1.0)
    S = 4
    big = cv2.resize(cov, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
    mask = (big > 0.5).astype(np.uint8)
    contours, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    hier = hier[0]
    letters = []
    for i, c in enumerate(contours):
        if hier[i][3] != -1 or cv2.contourArea(c) < 400 * S * S:
            continue
        rings = [c]
        child = hier[i][2]
        while child != -1:
            if cv2.contourArea(contours[child]) > 20 * S * S:
                rings.append(contours[child])
            child = hier[child][0]
        polys = []
        for k, ring in enumerate(rings):
            approx = cv2.approxPolyDP(ring, 0.6 * S, True)[:, 0, :].astype(np.float64)
            approx = (approx + 0.5) / S + np.array([x0, y0])
            polys.append(_rectilinear(approx, is_hole=k > 0, bias=0.5 / S))
        bx = min(p[0] for p in polys[0])
        letters.append((bx, polys))
    letters.sort(key=lambda t: t[0])
    allpts = [p for _, polys in letters for poly in polys for p in poly]
    ox = min(p[0] for p in allpts)
    oy = min(p[1] for p in allpts)
    w = max(p[0] for p in allpts) - ox
    h = max(p[1] for p in allpts) - oy
    names = list("WISHFORWASH")
    paths = []
    for k, (_, polys) in enumerate(letters):
        d = "".join(_path_d(poly, ox, oy) for poly in polys)
        name = names[k] if k < len(names) else "?"
        paths.append(f'  <path class="wm-letter" data-letter="{name}" d="{d}"/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" '
           f'aria-labelledby="wm-title" fill="{ICE_HEX}" fill-rule="evenodd">\n'
           f'  <title id="wm-title">WISH FOR WASH</title>\n' + "\n".join(paths) + "\n</svg>\n")
    shapes = [[poly for poly in polys] for _, polys in letters]
    return svg, (w, h, ox, oy), shapes, len(letters)


def render_wordmark(shapes, origin, width_px, color):
    """Rasterise the traced wordmark polygons (even-odd per letter) at a given width, anti-aliased."""
    w, h, ox, oy = origin
    ss = 4
    scale = width_px / float(w)
    W_, H_ = int(round(w * scale)), int(round(h * scale))
    acc = np.zeros((H_ * ss, W_ * ss), bool)
    for polys in shapes:
        letter = np.zeros_like(acc)
        for poly in polys:
            ring = Image.new("L", (W_ * ss, H_ * ss), 0)
            ImageDraw.Draw(ring).polygon([((x - ox) * scale * ss, (y - oy) * scale * ss) for x, y in poly], fill=255)
            letter ^= np.asarray(ring) > 127
        acc |= letter
    m = Image.fromarray(acc.astype(np.uint8) * 255, "L").resize((W_, H_), Image.LANCZOS)
    out = Image.new("RGBA", (W_, H_), color + (0,))
    out.putalpha(m)
    return out


# --------------------------------------------------------------------------- favicon drop
DROP_TOP = (77, 159, 240)        # bottle-logo drop, top
DROP_BOTTOM = (40, 118, 200)     # bottle-logo drop, bottom


def _cubic(p0, p1, p2, p3, n=48):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def _quad(p0, p1, p2, n=32):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2 = map(np.array, (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2


# One definition drives both favicon.svg and the PNG renders (64-unit design grid).
DROP = dict(tip=(32, 3), cx=32, cy=39.5, r=20.5, c1=(26.5, 11.5), c2=(11.5, 25))
HIGHLIGHT = ((20.5, 40.5), (20.5, 33.5), (23.5, 27.5), (27.5, 23.5))   # cubic, stroke 4.2
SMILE = ((25, 47.5), (32, 53), (39, 47.5))                              # quadratic, stroke 4.2


def favicon_svg():
    t, cx, cy, r = DROP["tip"], DROP["cx"], DROP["cy"], DROP["r"]
    c1, c2 = DROP["c1"], DROP["c2"]
    m1 = (2 * cx - c1[0], c1[1])
    m2 = (2 * cx - c2[0], c2[1])
    d = (f"M{t[0]} {t[1]}C{c1[0]} {c1[1]} {c2[0]} {c2[1]} {cx - r} {cy}"
         f"A{r} {r} 0 0 0 {cx + r} {cy}C{m2[0]} {m2[1]} {m1[0]} {m1[1]} {t[0]} {t[1]}Z")
    h = HIGHLIGHT
    s = SMILE
    rgb = lambda c: "#%02X%02X%02X" % c
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        '  <title>Wish for Wash</title>\n'
        '  <defs>\n'
        '    <linearGradient id="wfw-drop" x1="0" y1="0" x2="0" y2="1">\n'
        f'      <stop offset="0" stop-color="{rgb(DROP_TOP)}"/>\n'
        f'      <stop offset="1" stop-color="{rgb(DROP_BOTTOM)}"/>\n'
        '    </linearGradient>\n'
        '  </defs>\n'
        f'  <path d="{d}" fill="url(#wfw-drop)"/>\n'
        f'  <path d="M{h[0][0]} {h[0][1]}C{h[1][0]} {h[1][1]} {h[2][0]} {h[2][1]} {h[3][0]} {h[3][1]}" '
        'fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" opacity=".9"/>\n'
        f'  <path d="M{s[0][0]} {s[0][1]}Q{s[1][0]} {s[1][1]} {s[2][0]} {s[2][1]}" '
        'fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/>\n'
        '</svg>\n')


def _brush(size, pts, width, fill):
    """Round-capped stroke: stamp discs densely along a polyline (smooth at any width)."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    n = max(2, int(seg.sum() / max(width / 8.0, 0.5)))
    along = np.interp(np.linspace(0, seg.sum(), n), np.r_[0, np.cumsum(seg)], np.arange(len(pts)))
    P = np.c_[np.interp(along, np.arange(len(pts)), pts[:, 0]), np.interp(along, np.arange(len(pts)), pts[:, 1])]
    rad = width / 2.0
    for x, y in P:
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=fill)
    return layer


def render_drop(size, unit_scale, offset=(0.0, 0.0), canvas=None, outline=None, ss=8):
    """Rasterise the favicon drop with PIL (same geometry as favicon_svg).
    outline: optional (rgb, width_in_units) ring drawn behind the drop."""
    W_ = size * ss
    k = unit_scale * ss
    ox, oy = offset[0] * ss, offset[1] * ss
    t, cx, cy, r = DROP["tip"], DROP["cx"], DROP["cy"], DROP["r"]
    c1, c2 = DROP["c1"], DROP["c2"]
    left = _cubic(t, c1, c2, (cx - r, cy))
    ang = np.linspace(np.pi, 0, 96)
    arc = np.c_[cx + r * np.cos(ang), cy + r * np.sin(ang)]
    right = _cubic((cx + r, cy), (2 * cx - c2[0], c2[1]), (2 * cx - c1[0], c1[1]), t)
    shape = np.vstack([left, arc, right]) * k + [ox, oy]
    base = canvas.resize((W_, W_), Image.NEAREST) if canvas is not None else Image.new("RGBA", (W_, W_), (0, 0, 0, 0))
    if outline:
        ring = _brush(W_, np.vstack([shape, shape[:1]]), outline[1] * 2 * k, tuple(outline[0]) + (255,))
        base = Image.alpha_composite(base, ring)
    mask = Image.new("L", (W_, W_), 0)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in shape], fill=255)
    ys = np.linspace(0, 1, W_)[:, None]
    top_y, bot_y = (t[1] * k + oy) / W_, ((cy + r) * k + oy) / W_
    g = np.clip((ys - top_y) / max(bot_y - top_y, 1e-6), 0, 1)
    grad = (np.array(DROP_TOP) * (1 - g)[..., None] + np.array(DROP_BOTTOM) * g[..., None])
    grad = np.broadcast_to(grad, (W_, W_, 3)).astype(np.uint8)
    layer = Image.fromarray(grad, "RGB").convert("RGBA")
    layer.putalpha(mask)
    for pts_, op in ((_cubic(*HIGHLIGHT), 230), (_quad(*SMILE), 255)):
        layer = Image.alpha_composite(layer, _brush(W_, pts_ * k + [ox, oy], 4.2 * k, (255, 255, 255, op)))
    out = Image.alpha_composite(base, layer)
    return out.resize((size, size), Image.LANCZOS)


# --------------------------------------------------------------------------- Open Graph image
def find_font(candidates, size):
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def make_og(globe_img, wm_shapes, wm_origin):
    W_, H_ = 1200, 630
    canvas = Image.new("RGBA", (W_, H_), WASH_BLUE + (255,))
    gh = 590
    gw = int(round(globe_img.width * gh / globe_img.height))
    g = resize_rgba(globe_img, (gw, gh))
    canvas.alpha_composite(g, (W_ - gw, H_ - gh))
    wm = render_wordmark(wm_shapes, wm_origin, 590, (217, 236, 250))
    canvas.alpha_composite(wm, (60, 92))
    d = ImageDraw.Draw(canvas)
    line_y = 92 + wm.height + 34
    d.rounded_rectangle([62, line_y, 62 + 520, line_y + 6], radius=3, fill=(255, 255, 255, 255))
    bold = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc"]
    regular = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]
    f1 = find_font(bold, 56)
    d.text((60, line_y + 38), "Clean water starts", font=f1, fill=(255, 255, 255, 255))
    d.text((60, line_y + 38 + 66), "in Georgia", font=f1, fill=(255, 255, 255, 255))
    f2 = find_font(regular, 24)
    d.text((62, H_ - 70), "A Georgia Tech student initiative  ·  UN SDG 6", font=f2, fill=(217, 236, 250, 255))
    return canvas.convert("RGB")


# --------------------------------------------------------------------------- GT logo (official vector parts)
# Path indices in Wikimedia Commons "File:Georgia Tech logo 2021.svg" (viewBox 0 0 720 162), with the
# getBBox() values measured in a browser: the interlocking GT mark, "Georgia", and "Tech" taken from
# "Technology", plus the two (R) marks. Recomposed into the stacked lockup printed on the poster.
GT_MARK = [19, 16, 17]
GT_GEORGIA = [0, 1, 2, 3, 4, 5, 6]
GT_TECH = [22, 23, 24, 25]
GT_REG = [32, 33]
GT_BOX_MARK = (20.05, 22.36, 173.76, 108.08)
GT_G_LEFT, GT_G_TOP, GT_A_RIGHT = 217.79, 22.48, 442.40
GT_T_LEFT, GT_T_TOP, GT_H_RIGHT, GT_REG_X = 290.11, 83.27, 427.13, 617.65


def compose_gt_logo(svg_text, gold="#B3A369", text="#003057"):
    ds = re.findall(r'<path[^>]*\sd="([^"]+)"', svg_text)
    if len(ds) != 34:
        raise SystemExit(f"unexpected GT logo SVG: {len(ds)} paths")
    # Poster layout (measured on the poster, 1 unit = 1 poster px, origin at the mark's top-left):
    # mark 150 wide on top, "Georgia" 152 wide with its cap top at y=109, "Tech" starting at x=48
    # with its cap top at y=149, and the (R) just after the "h".
    sm = 150.0 / GT_BOX_MARK[2]
    st = 152.0 / (GT_A_RIGHT - GT_G_LEFT)
    reg_x = GT_H_RIGHT + 5.6
    tech_tx = 48.0
    f = lambda v: f"{v:.4f}".rstrip("0").rstrip(".")
    mark = "".join(f'<path d="{ds[i]}"/>' for i in GT_MARK)
    georgia = "".join(f'<path d="{ds[i]}"/>' for i in GT_GEORGIA)
    tech = "".join(f'<path d="{ds[i]}"/>' for i in GT_TECH)
    reg = "".join(f'<path d="{ds[i]}"/>' for i in GT_REG)

    def svg(text_fill, title):
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 154 184" role="img" aria-labelledby="gt-title">\n'
            f'  <title id="gt-title">{title}</title>\n'
            f'  <g fill="{gold}" transform="matrix({f(sm)} 0 0 {f(sm)} {f(-GT_BOX_MARK[0] * sm)} {f(-GT_BOX_MARK[1] * sm)})">{mark}</g>\n'
            f'  <g fill="{text_fill}">\n'
            f'    <g transform="matrix({f(st)} 0 0 {f(st)} {f(-GT_G_LEFT * st)} {f(109 - GT_G_TOP * st)})">{georgia}</g>\n'
            f'    <g transform="matrix({f(st)} 0 0 {f(st)} {f(tech_tx - GT_T_LEFT * st)} {f(149 - GT_T_TOP * st)})">{tech}'
            f'<g transform="translate({f(reg_x - GT_REG_X)} 0)">{reg}</g></g>\n'
            '  </g>\n</svg>\n')

    stacked = svg(text, "Georgia Tech")
    reversed_ = svg("#FFFFFF", "Georgia Tech")
    horizontal = svg_text
    horizontal = re.sub(r"<defs>.*?</defs>", "", horizontal, flags=re.S)
    paths = re.findall(r"<path[^>]*/>", horizontal)
    parts = []
    for i, p in enumerate(paths):
        if i == 18:                                            # empty path in the source file
            continue
        parts.append(re.sub(r'class="cls-1"', f'fill="{gold if i in GT_MARK else text}"', p))
    horizontal = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 162" role="img" aria-labelledby="gth-title">\n'
                  '  <title id="gth-title">Georgia Institute of Technology</title>\n  ' + "\n  ".join(parts) + "\n</svg>\n")
    return stacked, reversed_, horizontal


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("poster")
    ap.add_argument("repo")
    ap.add_argument("--gt-svg", help="Wikimedia Commons 'Georgia Tech logo 2021.svg'")
    ap.add_argument("--debug", help="directory for debug overlays")
    args = ap.parse_args()

    img = np.asarray(Image.open(args.poster).convert("RGB"), dtype=np.float64)
    if img.shape[:2] != (2000, 1545):
        raise SystemExit(f"expected the 1545x2000 poster, got {img.shape[1]}x{img.shape[0]}")
    out_img = os.path.join(args.repo, "assets", "img")
    out_svg = os.path.join(args.repo, "assets", "svg")
    out_pub = os.path.join(args.repo, "public")
    for d in (out_img, out_svg, out_pub) + ((args.debug,) if args.debug else ()):
        os.makedirs(d, exist_ok=True)
    report = []

    globe, geom = extract_globe(img, args.debug)
    p = os.path.join(out_img, "globe-in-hands.webp")
    report.append((p, globe.size, save_webp(globe, p, quality=84)))
    small = resize_rgba(globe, (640, int(round(globe.height * 640 / globe.width))))
    p = os.path.join(out_img, "globe-in-hands-640.webp")
    report.append((p, small.size, save_webp(small, p, quality=82)))
    with open(os.path.join(out_img, "globe-in-hands.json"), "w") as fh:
        json.dump(geom, fh, indent=2)
        fh.write("\n")

    bottle, bmeta = extract_bottle(img, args.debug)
    p = os.path.join(out_img, "bottle.webp")
    report.append((p, bottle.size, save_webp(bottle, p, quality=88)))
    with open(os.path.join(out_img, "bottle.json"), "w") as fh:
        json.dump(bmeta, fh, indent=2)
        fh.write("\n")

    svg, origin, shapes, n_letters = trace_wordmark(img)
    if n_letters != 11:
        raise SystemExit(f"wordmark trace found {n_letters} letters, expected 11")
    with open(os.path.join(out_svg, "wordmark.svg"), "w") as fh:
        fh.write(svg)
    report.append((os.path.join(out_svg, "wordmark.svg"), origin[:2], len(svg.encode())))

    with open(os.path.join(out_pub, "favicon.svg"), "w") as fh:
        fh.write(favicon_svg())
    fav = render_drop(48, 48 / 64.0)
    p = os.path.join(out_pub, "favicon-48.png")
    fav.save(p, optimize=True)
    report.append((p, fav.size, os.path.getsize(p)))
    tile = Image.new("RGBA", (180, 180), WASH_BLUE + (255,))   # full bleed: iOS rounds the corners
    touch = render_drop(180, 2.1, offset=(180 / 2 - 32 * 2.1, 180 / 2 - 31.5 * 2.1), canvas=tile,
                        outline=((217, 236, 250), 1.6))
    p = os.path.join(out_pub, "apple-touch-icon.png")
    touch.convert("RGB").save(p, optimize=True)
    report.append((p, touch.size, os.path.getsize(p)))

    og = make_og(globe, shapes, origin)
    p = os.path.join(out_pub, "og-image.jpg")
    og.save(p, "JPEG", quality=86, optimize=True, progressive=True)
    report.append((p, og.size, os.path.getsize(p)))

    if args.gt_svg:
        stacked, reversed_, horizontal = compose_gt_logo(open(args.gt_svg, encoding="utf-8").read())
        for name, body in (("gt-logo.svg", stacked), ("gt-logo-reversed.svg", reversed_),
                           ("gt-logo-horizontal.svg", horizontal)):
            p = os.path.join(out_img, name)
            with open(p, "w") as fh:
                fh.write(body)
            report.append((p, None, len(body.encode())))

    for path, size, nbytes in report:
        print(f"{os.path.relpath(path, args.repo):42s} {str(size):14s} {nbytes:>8d} bytes")


if __name__ == "__main__":
    main()
