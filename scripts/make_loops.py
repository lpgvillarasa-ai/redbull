#!/usr/bin/env python3
"""Encode ambient/outro loops as mp4 (libx264) + webm (vp9), 1920px,
-fps_mode passthrough on every encode (CFR default silently duplicates frames).

Palindrome loops use the seamless recipe where BOTH boundary frames of the
reversed half are dropped, otherwise the apex frame doubles and stutters:
  [0:v]split[a][b];
  [b]trim=start_frame=1,setpts=PTS-STARTPTS,reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];
  [a][r]concat=n=2:v=1
"""
import os
import sys

from shotlib import ROOT, load_config, ffmpeg_exe, run

PALINDROME = ("[0:v]split[a][b];"
              "[b]trim=start_frame=1,setpts=PTS-STARTPTS,reverse,"
              "trim=start_frame=1,setpts=PTS-STARTPTS[r];"
              "[a][r]concat=n=2:v=1,")


def main():
    cfg = load_config()
    names = sys.argv[1:]
    for name, lp in cfg["loops"].items():
        if names and name not in names:
            continue
        src = os.path.join(ROOT, lp["source"])
        scale = f"scale={lp['width']}:-2:flags=lanczos+accurate_rnd"
        chain = (PALINDROME + scale) if lp["palindrome"] else scale
        for out, codec in ((lp["out_mp4"], ["-c:v", "libx264", "-crf", "18",
                                           "-preset", "slow", "-pix_fmt", "yuv420p"]),
                           (lp["out_webm"], ["-c:v", "libvpx-vp9", "-crf", "28",
                                            "-b:v", "0", "-row-mt", "1",
                                            "-cpu-used", "2"])):
            out = os.path.join(ROOT, out)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", src,
                 "-filter_complex", chain, "-an", "-fps_mode", "passthrough", out])
            print(f"  {name}: {out} ({os.path.getsize(out)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
