#!/usr/bin/env python3
"""Join two-part takes (C1+C2, E1+E2) with an xfade dissolve.

offset = lenA - fade duration, computed from the actual clip, not assumed.
"""
import os
import subprocess

from shotlib import ROOT, load_config, ffmpeg_exe, run


def duration_of(path):
    exe = ffmpeg_exe()
    r = subprocess.run([exe, "-i", path], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if "Duration:" in line:
            h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise SystemExit(f"no duration for {path}")


def main():
    cfg = load_config()
    for name, d in cfg["dissolves"].items():
        a, b = (os.path.join(ROOT, p) for p in d["parts"])
        out = os.path.join(ROOT, d["output"])
        fade = d["xfade"]["duration"]
        offset = duration_of(a) - fade
        run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", a, "-i", b,
             "-filter_complex",
             f"[0:v][1:v]xfade=transition={d['xfade']['transition']}:duration={fade}:offset={offset:.3f}",
             "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
             out])
        print(f"  {name}: {out} (offset {offset:.2f}s)")


if __name__ == "__main__":
    main()
