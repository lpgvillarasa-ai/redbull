#!/usr/bin/env python3
"""Deterministic Edition colorways from the primary turntable frames.

Soft-weighted chroma ROTATION in HSV — never a binary hue mask (fringes on
anti-aliased edges). weight = smoothstep(hue distance to source key) x
smoothstep(saturation) x smoothstep(value), Gaussian-feathered spatially.
Hue is rotated by (target - source) so reflections and shading stay alive;
sat/value are remapped multiplicatively vs the source paint's reference
chroma, then blended by weight.

Source key for this build: the cobalt blue panels (#1E3F8F). The red
wordmark (~hue 0) and golden sun (~hue 45deg) sit far from the blue key, so
they fall outside the hue window — but VERIFY per colorway on the review
strip that they survive untouched.

Usage: python3 scripts/recolor.py [colorway_id ...]
"""
import colorsys
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

from shotlib import ROOT, load_config


def hex_to_hsv(hexstr):
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return colorsys.rgb_to_hsv(r, g, b)  # h,s,v in 0..1


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rgb_to_hsv_np(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-8
    idx = m & (mx == r)
    h[idx] = ((g[idx] - b[idx]) / d[idx]) % 6
    idx = m & (mx == g)
    h[idx] = (b[idx] - r[idx]) / d[idx] + 2
    idx = m & (mx == b)
    h[idx] = (r[idx] - g[idx]) / d[idx] + 4
    h = h / 6.0
    s = np.where(mx > 1e-8, d / np.maximum(mx, 1e-8), 0.0)
    return h, s, mx


def hsv_to_rgb_np(h, s, v):
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    i = i.astype(int) % 6
    out = np.zeros(h.shape + (3,))
    for k, (rr, gg, bb) in enumerate([(0, 3, 1), (2, 0, 1), (1, 0, 3),
                                      (1, 2, 0), (3, 1, 0), (0, 1, 2)]):
        # channel source: 0=v, 1=p, 2=q, 3=t
        comp = [v, p, q, t]
        m = i == k
        out[m, 0] = comp[rr][m]
        out[m, 1] = comp[gg][m]
        out[m, 2] = comp[bb][m]
    return out


def recolor_image(img, src_hsv, dst_hsv):
    rgb = np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0
    h, s, v = rgb_to_hsv_np(rgb)

    # hue distance to source key, wrapped
    dh = np.abs(h - src_hsv[0])
    dh = np.minimum(dh, 1.0 - dh)
    w_h = 1.0 - smoothstep(0.055, 0.16, dh)      # tight window around cobalt
    w_s = smoothstep(0.18, 0.45, s)              # ignore greys/silver body
    w_v = smoothstep(0.06, 0.22, v)              # ignore near-black
    w = w_h * w_s * w_v

    # Gaussian feather of the weight map — kills fringes on AA edges
    wimg = Image.fromarray((w * 255).astype(np.uint8))
    wimg = wimg.filter(ImageFilter.GaussianBlur(radius=1.2))
    w = np.asarray(wimg, dtype=np.float64) / 255.0

    rot = dst_hsv[0] - src_hsv[0]
    h2 = (h + rot) % 1.0
    s2 = np.clip(s * (dst_hsv[1] / max(src_hsv[1], 1e-6)), 0, 1)
    v2 = np.clip(v * (dst_hsv[2] / max(src_hsv[2], 1e-6)), 0, 1)

    out = hsv_to_rgb_np(h2, s2, v2)
    blended = rgb * (1 - w[..., None]) + out * w[..., None]
    return Image.fromarray((np.clip(blended, 0, 1) * 255).astype(np.uint8))


def main():
    cfg = load_config()
    t = cfg["turntable"]
    src_dir = os.path.join(ROOT, t["dir"])
    src_hsv = hex_to_hsv(t["source_chroma_hex"])
    only = sys.argv[1:]
    frames = sorted(f for f in os.listdir(src_dir) if f.endswith(".webp"))
    if len(frames) != t["frames"]:
        sys.exit(f"{src_dir}: {len(frames)} frames, expected {t['frames']} — run extract_frames --turntable first")

    for cw in t["colorways"]:
        if not cw.get("recolor"):
            continue
        if only and cw["id"] not in only:
            continue
        dst_hsv = hex_to_hsv(cw["hex"])
        out_dir = os.path.join(ROOT, cw["dir"])
        os.makedirs(out_dir, exist_ok=True)
        for f in frames:
            img = Image.open(os.path.join(src_dir, f))
            recolor_image(img, src_hsv, dst_hsv).save(
                os.path.join(out_dir, f), quality=t["quality"], method=6)
        print(f"  {cw['id']}: {len(frames)} frames -> {out_dir}")


if __name__ == "__main__":
    main()
