#!/usr/bin/env python3
"""Render synthetic PLACEHOLDER takes into takes/ so the full downstream
pipeline (dissolve -> extract -> recolor -> loops -> contract -> site) runs
end-to-end before a single Higgsfield credit is spent.

Real generated takes overwrite the same takes/*.mp4 paths later; nothing
downstream changes. Every placeholder frame carries a small PLACEHOLDER tag
so it can never be mistaken for an accepted AI take.

Usage: python3 scripts/placeholders.py [A B C1 ...]   (default: all)
"""
import math
import os
import shutil
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from shotlib import ROOT, ffmpeg_exe, run

W, H = 1920, 1080
FPS = 24
COBALT = (30, 63, 143)      # #1E3F8F
SILVER = (196, 202, 210)
RED = (200, 16, 46)
GOLD = (245, 168, 0)
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

rng = np.random.default_rng(1987)
DOTS = rng.random((260, 3))          # condensation (u, v, r)
BUBBLES = rng.random((240, 3))       # bubble field (x, phase, size)
BOKEH = rng.random((40, 4))          # night bokeh (x, y, r, tint)


def background(glow_x=0.5, glow_y=0.42, amber=0.35):
    """Deep navy-to-black sweep + cool glow left / golden bounce right."""
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    base = np.stack([4 + 10 * (1 - y), 8 + 16 * (1 - y), 20 + 42 * (1 - y)], -1)
    d1 = ((x - glow_x + 0.22) ** 2 + ((y - glow_y) * 1.6) ** 2)
    cool = np.exp(-d1 * 9)[..., None] * np.array([28, 48, 96])
    d2 = ((x - glow_x - 0.30) ** 2 + ((y - glow_y - 0.1) * 1.6) ** 2)
    warm = np.exp(-d2 * 11)[..., None] * np.array([70, 46, 10]) * amber
    img = np.clip(base + cool + warm, 0, 255).astype(np.uint8)
    return Image.fromarray(img, "RGB")


def can_layer(can_h, rot, panel_rgb=COBALT, opened=False, tab_lift=0.0):
    """RGBA image of the slim can. rot in radians spins the checker pattern."""
    can_w = int(can_h * 5.3 / 13.5)
    lid_h = max(6, can_h // 22)
    im = Image.new("RGBA", (can_w + 8, can_h + lid_h + 8), (0, 0, 0, 0))

    # body: cylindrical shading x diagonal checker, vectorized
    bw, bh = can_w, can_h
    xs = np.linspace(-1, 1, bw)[None, :]
    ys = np.linspace(0, 1, bh)[:, None]
    az = np.arcsin(np.clip(xs, -1, 1)) + rot          # azimuth per column
    band = np.floor((az * 1.7 / math.pi + ys * 0.5) * 2.6).astype(int)
    is_blue = (band % 2 == 0)
    shade = 0.42 + 0.58 * np.cos(np.arcsin(np.clip(xs, -1, 1)) - 0.5) ** 2
    rim = np.clip(1 - np.abs(xs), 0, 1) ** 0.5
    body = np.zeros((bh, bw, 3))
    for c in range(3):
        body[..., c] = np.where(is_blue, panel_rgb[c], SILVER[c]) * shade * rim ** 0.12
    body[..., 2] += (1 - rim[..., 0] if rim.ndim > 2 else 0)
    body = np.clip(body, 0, 255).astype(np.uint8)
    alpha = np.full((bh, bw), 255, np.uint8)
    body_img = Image.fromarray(np.dstack([body, alpha]), "RGBA")
    im.paste(body_img, (4, lid_h + 4), body_img)

    d = ImageDraw.Draw(im)
    # lid
    d.ellipse([4, 4, 4 + bw, 4 + lid_h * 2], fill=(158, 164, 174, 255))
    d.ellipse([4 + bw // 8, 5, 4 + bw - bw // 8, 3 + lid_h * 2 - lid_h // 2],
              fill=(120, 126, 136, 255))
    if opened:
        d.ellipse([4 + bw // 3, 6, 4 + 2 * bw // 3, 4 + lid_h], fill=(18, 14, 10, 255))
    if tab_lift > 0:
        lift = int(tab_lift * lid_h * 2.2)
        d.rectangle([4 + bw // 2 - bw // 10, 4 - lift,
                     4 + bw // 2 + bw // 10, 6 + lid_h - lift // 2],
                    fill=(178, 184, 194, 255))

    # label group fades/slides with facing angle
    face = max(0.0, math.cos(rot))
    if face > 0.05:
        off = int(math.sin(rot) * bw * 0.35)
        lg = Image.new("RGBA", im.size, (0, 0, 0, 0))
        dl = ImageDraw.Draw(lg)
        cx = 4 + bw // 2 + off
        sun_y = lid_h + 4 + int(bh * 0.30)
        r = int(bw * 0.26 * (0.5 + 0.5 * face))
        dl.ellipse([cx - r, sun_y - r, cx + r, sun_y + r], fill=GOLD + (255,))
        for sgn in (-1, 1):  # two charging bulls, simplified silhouettes
            pts = [(cx + sgn * int(r * 1.5), sun_y + int(r * 0.5)),
                   (cx + sgn * int(r * 0.2), sun_y - int(r * 0.1)),
                   (cx + sgn * int(r * 0.9), sun_y - int(r * 0.9))]
            dl.polygon(pts, fill=RED + (255,))
        fs = max(10, int(bw * 0.19 * (0.6 + 0.4 * face)))
        font = ImageFont.truetype(SERIF, fs)
        for i, word in enumerate(("RED", "BULL")):
            tw = dl.textlength(word, font=font)
            dl.text((cx - tw / 2, sun_y + r * 1.25 + i * fs * 1.05), word,
                    font=font, fill=RED + (255,))
        lg.putalpha(lg.getchannel("A").point(lambda a: int(a * face)))
        im.alpha_composite(lg)

    # condensation
    dd = ImageDraw.Draw(im)
    for u, v, s in DOTS:
        px, py = 4 + int(u * bw), lid_h + 4 + int(v * bh)
        pr = max(1, int(s * bw * 0.012))
        dd.ellipse([px - pr, py - pr, px + pr, py + pr],
                   fill=(235, 242, 250, int(70 + 90 * s)))
    return im


def paste_can(frame, can_h, cx_frac, cy_frac, rot, reflect=True, **kw):
    can = can_layer(can_h, rot, **kw)
    x = int(cx_frac * W - can.width / 2)
    y = int(cy_frac * H - can.height / 2)
    if reflect:
        ref = can.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(3))
        grad = np.linspace(90, 0, ref.height)[:, None].repeat(ref.width, 1)
        a = np.asarray(ref.getchannel("A"), np.float64) * grad / 255
        ref.putalpha(Image.fromarray(a.astype(np.uint8)))
        frame.alpha_composite(ref, (x, y + can.height - 6))
    frame.alpha_composite(can, (x, y))


def tag(frame, shot):
    d = ImageDraw.Draw(frame)
    font = ImageFont.truetype(SANS, 22)
    d.text((24, H - 44), f"PLACEHOLDER TAKE {shot}", font=font, fill=(255, 255, 255, 90))


def bubbles(frame, t, region=(0, 0, W, H), density=1.0, amber_bg=False):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = region
    if amber_bg:
        y = np.linspace(0, 1, y1 - y0)[:, None]
        x = np.linspace(-1, 1, x1 - x0)[None, :]
        amb = np.stack([120 + 90 * (1 - y) - 30 * x ** 2,
                        70 + 60 * (1 - y) - 20 * x ** 2,
                        10 + 18 * (1 - y)], -1)
        frame.paste(Image.fromarray(np.clip(amb, 0, 255).astype(np.uint8)), (x0, y0))
    n = int(len(BUBBLES) * density)
    for bx, ph, s in BUBBLES[:n]:
        yy = y1 - ((ph + t * (0.25 + s * 0.5)) % 1.0) * (y1 - y0)
        xx = x0 + bx * (x1 - x0) + math.sin((ph + t) * 6.28 * 2) * 6
        r = 2 + s * 7
        d.ellipse([xx - r, yy - r, xx + r, yy + r], outline=(255, 232, 190, 150),
                  width=2, fill=(255, 244, 214, 40))


def render_shot(shot, seconds):
    frames = seconds * FPS
    tmp = tempfile.mkdtemp()
    for i in range(frames):
        t = i / (frames - 1)
        if shot == "A":      # 90-degree hero orbit, slight push
            frame = background(0.5 + 0.06 * math.sin(t * 3), amber=0.4).convert("RGBA")
            paste_can(frame, int(H * (0.62 + 0.05 * t)), 0.5, 0.52,
                      math.radians(-45 + 90 * t))
        elif shot == "B":    # push-in to logo
            frame = background(amber=0.45).convert("RGBA")
            z = 1 + 1.7 * t
            paste_can(frame, int(H * 0.62 * z), 0.5, 0.52 + 0.28 * (z - 1), 0.0,
                      reflect=t < 0.2)
        elif shot == "C1":   # rising approach to the lid
            frame = background(glow_y=0.42 - 0.2 * t).convert("RGBA")
            z = 1 + 1.2 * t
            paste_can(frame, int(H * 0.62 * z), 0.5, 0.52 + 0.55 * t * z, 0.0,
                      reflect=t < 0.15)
        elif shot in ("C2", "D"):  # macro lid; C2 animates the opening
            pan = 0.0 if shot == "C2" else (t - 0.5) * 0.16
            frame = background(0.5 - pan, 0.5, amber=0.5).convert("RGBA")
            lift = min(1.0, t * 2) if shot == "C2" else 0.0
            paste_can(frame, int(H * 2.6), 0.5 + pan, 1.35, 0.0, reflect=False,
                      opened=(shot == "D" or t > 0.5), tab_lift=lift)
            if shot == "C2" and 0.45 < t < 0.75:  # droplet burst at the crack
                d = ImageDraw.Draw(frame)
                for j in range(24):
                    a = j / 24 * 6.28
                    rr = (t - 0.45) * 900
                    d.ellipse([W / 2 + math.cos(a) * rr - 3, H * 0.30 - abs(math.sin(a)) * rr - 3,
                               W / 2 + math.cos(a) * rr + 3, H * 0.30 - abs(math.sin(a)) * rr + 3],
                              fill=(240, 246, 255, 200))
        elif shot == "E1":   # lateral track at label height
            frame = background(0.5 - (t - 0.5) * 0.3).convert("RGBA")
            paste_can(frame, int(H * 1.5), 0.62 - 0.24 * t, 0.62, math.radians(10 - 20 * t),
                      reflect=False)
        elif shot == "E2":   # the pour
            frame = background(amber=0.9).convert("RGBA")
            d = ImageDraw.Draw(frame)
            gx0, gy0, gx1, gy1 = W * 0.36, H * 0.42, W * 0.64, H * 0.96
            fill_y = gy1 - (gy1 - gy0) * (0.15 + 0.7 * t)
            d.rounded_rectangle([gx0, gy0, gx1, gy1], 30, outline=(200, 215, 230, 180), width=6)
            d.rectangle([gx0 + 6, fill_y, gx1 - 6, gy1 - 6], fill=(196, 128, 24, 230))
            for k in range(5):  # ice
                ix = gx0 + 40 + (k % 3) * 150 + (k * 37) % 60
                iy = fill_y + 20 + (k // 3) * 130
                if iy < gy1 - 80:
                    d.rounded_rectangle([ix, iy, ix + 90, iy + 90], 18,
                                        fill=(225, 238, 248, 120))
            d.line([W * 0.72, H * 0.10, W * 0.52, gy0 + 30], fill=(230, 168, 40, 235), width=18)
            bubbles(frame, t, (int(gx0) + 10, int(fill_y), int(gx1) - 10, int(gy1) - 8), 0.4)
            paste_can(frame, int(H * 0.5), 0.82, 0.14, math.radians(35), reflect=False)
        elif shot == "F":    # ingredients bubble field
            frame = Image.new("RGBA", (W, H))
            bubbles(frame, t, (0, 0, W, H), 1.0, amber_bg=True)
        elif shot == "G":    # night city energy
            frame = background(0.5, 0.5, amber=1.2).convert("RGBA")
            d = ImageDraw.Draw(frame)
            for bx, by, br, tint in BOKEH:
                r = 18 + br * 60
                col = (240, 180, 60, 70) if tint > 0.5 else (60, 120, 240, 70)
                d.ellipse([bx * W - r, by * H * 0.8 - r, bx * W + r, by * H * 0.8 + r], fill=col)
            for s in range(6):  # passing light streaks
                sy = H * (0.15 + s * 0.12)
                sx = ((t * (1.4 + s * 0.35) + s * 0.37) % 1.4 - 0.2) * W
                d.line([sx, sy, sx + 260, sy], fill=(255, 200, 90, 160), width=6)
            frame = frame.filter(ImageFilter.GaussianBlur(2))
            paste_can(frame, int(H * (0.58 + 0.06 * t)), 0.5, 0.55, math.radians(-8))
        elif shot == "H":    # seamless 360 turntable
            frame = background(amber=0.4).convert("RGBA")
            paste_can(frame, int(H * 0.62), 0.5, 0.52, math.radians(360 * i / frames))
        tag(frame, shot)
        frame.convert("RGB").save(os.path.join(tmp, f"{i:04d}.png"))
    out = os.path.join(ROOT, "takes", f"{shot}.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    run([ffmpeg_exe(), "-y", "-loglevel", "error", "-framerate", str(FPS),
         "-i", os.path.join(tmp, "%04d.png"),
         "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", out])
    shutil.rmtree(tmp)
    print(f"  {shot}: {out} ({frames} frames)")


SHOTS = {"A": 5, "B": 4, "C1": 4, "C2": 4, "D": 4, "E1": 4, "E2": 4, "F": 4, "G": 5, "H": 4}

if __name__ == "__main__":
    which = sys.argv[1:] or list(SHOTS)
    for s in which:
        render_shot(s, SHOTS[s])
