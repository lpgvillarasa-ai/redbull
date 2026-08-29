#!/usr/bin/env python3
"""Build a contact strip of 6 spread frames from a take or frame dir, so every
generated asset gets EYES on it before acceptance. A take you haven't seen is
not done.

Usage:
  python3 scripts/review_strip.py takes/A.mp4            -> review/A.strip.jpg
  python3 scripts/review_strip.py public/turn/pink       -> review/pink.strip.jpg
  python3 scripts/review_strip.py takes/A.mp4 --zoom     -> adds a 2x center crop row
                                                            (wordmark/logo legibility check)
"""
import os
import shutil
import sys
import tempfile

from PIL import Image

from shotlib import ROOT, ffmpeg_exe, run, probe_frames, spread_indices

N = 6
TILE_W = 640


def frames_from_video(path, tmp):
    total = probe_frames(path)
    idx = spread_indices(total, min(N, total))
    select = "+".join(f"eq(n\\,{i})" for i in idx)
    run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", path,
         "-vf", f"select='{select}',setpts=N/FRAME_RATE/TB",
         "-fps_mode", "passthrough", os.path.join(tmp, "%02d.png")])
    return [os.path.join(tmp, f) for f in sorted(os.listdir(tmp))]


def frames_from_dir(path):
    fs = sorted(f for f in os.listdir(path)
                if f.lower().endswith((".webp", ".png", ".jpg")))
    idx = spread_indices(len(fs), min(N, len(fs)))
    return [os.path.join(path, fs[i]) for i in idx]


def main():
    target = sys.argv[1]
    zoom = "--zoom" in sys.argv
    src = os.path.join(ROOT, target)
    tmp = tempfile.mkdtemp()
    try:
        files = frames_from_dir(src) if os.path.isdir(src) else frames_from_video(src, tmp)
        imgs = [Image.open(f).convert("RGB") for f in files]
        th = round(TILE_W * imgs[0].height / imgs[0].width)
        tiles = [im.resize((TILE_W, th), Image.LANCZOS) for im in imgs]
        rows = 2 if zoom else 1
        strip = Image.new("RGB", (TILE_W * len(tiles), th * rows), "black")
        for i, t in enumerate(tiles):
            strip.paste(t, (i * TILE_W, 0))
        if zoom:
            for i, im in enumerate(imgs):
                w, h = im.size
                crop = im.crop((w // 4, h // 4, 3 * w // 4, 3 * h // 4))
                strip.paste(crop.resize((TILE_W, th), Image.LANCZOS), (i * TILE_W, th))
        name = os.path.splitext(os.path.basename(target.rstrip("/")))[0]
        out = os.path.join(ROOT, "review", f"{name}.strip.jpg")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        strip.save(out, quality=88)
        print(out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
