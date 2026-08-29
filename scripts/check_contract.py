#!/usr/bin/env python3
"""Contract checker — gates every ship. Green or it doesn't deploy.

Checks, from shots.config.json:
  - every sequence dir: EXACT frame count, EXACT pixel width, within MB budget
  - turntable + every recolor colorway dir: same
  - loops: both formats present and non-trivially sized
  - site files present
Exit 0 = green.
"""
import os
import sys

from PIL import Image

from shotlib import ROOT, load_config, dir_size_mb

fails = []


def ok(msg):
    print(f"  ✓ {msg}")


def fail(msg):
    fails.append(msg)
    print(f"  ✗ {msg}")


def check_seq(d, frames, width, budget_mb, label):
    p = os.path.join(ROOT, d)
    if not os.path.isdir(p):
        return fail(f"{label}: missing dir {d}")
    fs = sorted(f for f in os.listdir(p) if f.endswith(".webp"))
    if len(fs) != frames:
        return fail(f"{label}: {len(fs)} frames, contract says {frames}")
    with Image.open(os.path.join(p, fs[0])) as im:
        if im.width != width:
            return fail(f"{label}: width {im.width}px, contract says {width}px")
    size = dir_size_mb(p)
    if size > budget_mb:
        return fail(f"{label}: {size:.1f} MB over budget {budget_mb} MB")
    ok(f"{label}: {frames} frames @ {width}px, {size:.1f}/{budget_mb} MB")


def main():
    cfg = load_config()
    print("sequences:")
    for name, seq in cfg["sequences"].items():
        for variant in ("desktop", "mobile"):
            v = seq[variant]
            check_seq(v["dir"], v["frames"], v["width"], v["budget_mb"], f"{name}/{variant}")

    print("turntable:")
    t = cfg["turntable"]
    check_seq(t["dir"], t["frames"], t["width"], t["budget_mb"], "turn/original")
    for cw in t["colorways"]:
        if cw.get("recolor"):
            check_seq(cw["dir"], t["frames"], t["width"], t["budget_mb"], f"turn/{cw['id']}")

    print("loops:")
    for name, lp in cfg["loops"].items():
        for key in ("out_mp4", "out_webm"):
            p = os.path.join(ROOT, lp[key])
            if not os.path.isfile(p) or os.path.getsize(p) < 20_000:
                fail(f"loop {name}: {lp[key]} missing or trivially small")
            else:
                ok(f"loop {name}: {lp[key]} ({os.path.getsize(p)/1e6:.1f} MB)")

    print("site:")
    for f in ("index.html", "assets/js/main.js", "assets/css/style.css",
              "vercel.json", ".vercelignore"):
        if os.path.isfile(os.path.join(ROOT, f)):
            ok(f)
        else:
            fail(f"missing {f}")

    if fails:
        print(f"\nRED — {len(fails)} failure(s). Not shippable.")
        sys.exit(1)
    print("\nGREEN — contract satisfied.")


if __name__ == "__main__":
    main()
