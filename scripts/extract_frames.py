#!/usr/bin/env python3
"""Extract exactly-N evenly spaced webp frames from a take, enforcing MB budgets.

Usage:
  python3 scripts/extract_frames.py            # all sequences from shots.config.json
  python3 scripts/extract_frames.py hero pour  # just these
  python3 scripts/extract_frames.py --turntable

ffmpeg 7 trap: the default webp muxer picks libwebp_anim and silently collapses
an image2 sequence into ONE animated file — every encode here forces -c:v libwebp.
Budget rule: over budget -> quality -8 and re-encode; below q40 -> reshoot (fail).
"""
import os
import shutil
import sys

from shotlib import ROOT, load_config, ffmpeg_exe, run, probe_frames, spread_indices, dir_size_mb


def extract(source, out_dir, n_frames, width, quality, budget_mb, q_step, q_floor,
            exclusive_end=False):
    source = os.path.join(ROOT, source)
    out_dir = os.path.join(ROOT, out_dir)
    total = probe_frames(source)
    if total < n_frames:
        sys.exit(f"{source}: only {total} frames, need {n_frames} — reshoot longer/higher-fps take")
    if exclusive_end:
        # wrap-around loop (turntable): last frame must NOT repeat the first
        idx = sorted({min(total - 1, round(i * total / n_frames)) for i in range(n_frames)})
    else:
        idx = spread_indices(total, n_frames)
    select = "+".join(f"eq(n\\,{i})" for i in idx)
    q = quality
    while True:
        if os.path.isdir(out_dir):
            shutil.rmtree(out_dir)
        os.makedirs(out_dir)
        vf = (f"select='{select}',scale={width}:-2:flags=lanczos+accurate_rnd,"
              f"setpts=N/FRAME_RATE/TB")
        run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", source,
             "-vf", vf, "-fps_mode", "passthrough",
             "-c:v", "libwebp", "-quality", str(q), "-compression_level", "6",
             os.path.join(out_dir, "%04d.webp")])
        got = len(os.listdir(out_dir))
        if got != n_frames:
            sys.exit(f"{out_dir}: extracted {got} frames, wanted {n_frames}")
        size = dir_size_mb(out_dir)
        print(f"  {out_dir}: {got} frames @ {width}px q{q} = {size:.1f} MB (budget {budget_mb})")
        if size <= budget_mb:
            return
        q -= q_step
        if q < q_floor:
            sys.exit(f"{out_dir}: still {size:.1f} MB at quality floor q{q_floor} — reshoot; "
                     "cut frames before resolution")
        print(f"  over budget -> stepping quality down to q{q}")


def main():
    cfg = load_config()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    q_step = cfg["budgets"]["webp_quality_step_down"]
    q_floor = cfg["budgets"]["webp_quality_floor"]

    if "--turntable" in sys.argv:
        t = cfg["turntable"]
        extract(t["source"], t["dir"], t["frames"], t["width"], t["quality"],
                t["budget_mb"], q_step, q_floor, exclusive_end=True)
        return

    for name, seq in cfg["sequences"].items():
        if args and name not in args:
            continue
        for variant in ("desktop", "mobile"):
            v = seq[variant]
            extract(seq["source"], v["dir"], v["frames"], v["width"], v["quality"],
                    v["budget_mb"], q_step, q_floor)


if __name__ == "__main__":
    main()
