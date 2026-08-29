#!/usr/bin/env python3
"""Drive Higgsfield generation from shots.config.json.

Usage:
  python3 scripts/generate.py cost                   # price the full pass, generate nothing
  python3 scripts/generate.py anchor hero            # generate one anchor still
  python3 scripts/generate.py anchor lid --image reference/lid.jpg
  python3 scripts/generate.py shot A                 # image-to-video from locked anchor
  python3 scripts/generate.py shot A B C1            # several
  python3 scripts/generate.py print shot A           # just print the composed prompt

Rules encoded here:
  - NEVER text-to-video: every shot passes --start-image (its locked anchor).
  - seedance_2_0 has no seed / negative params; --generate_audio false always.
  - Download the job's result_url — never *_min / *_resize preview URLs.
  - After download, a review strip is built automatically. LOOK at it before
    accepting; a take you haven't seen is not done.
"""
import json
import os
import subprocess
import sys
import urllib.request

from shotlib import ROOT, load_config, compose_prompt, run


def sh_json(cmd):
    print("+", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"CLI failed:\n{r.stdout}\n{r.stderr}")
    # last JSON-looking chunk on stdout
    out = r.stdout.strip()
    start = out.find("[") if out.find("[") >= 0 else out.find("{")
    return json.loads(out[start:]) if start >= 0 else out


def result_url(job):
    """Pull the full-res result URL; refuse preview/min/resize variants."""
    if isinstance(job, list):
        job = job[0]
    url = job.get("result_url")
    if not url:
        results = job.get("results") or job.get("result") or {}
        if isinstance(results, dict):
            url = (results.get("raw") or {}).get("url") or results.get("url")
        elif isinstance(results, str):
            url = results
    if not url:
        sys.exit(f"no result url in job:\n{json.dumps(job, indent=2)[:2000]}")
    if "_min" in url or "_resize" in url:
        sys.exit(f"refusing preview URL ({url}) — find the result_url raw asset")
    return url


def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"  downloading -> {dest}")
    urllib.request.urlretrieve(url, dest)
    print(f"  {os.path.getsize(dest)/1e6:.1f} MB")


def gen_anchor(cfg, name, ref_image=None):
    a = cfg["anchors"][name]
    prompt = compose_prompt(a["prompt_file"], cfg)
    still = cfg["models"]["still"]
    cmd = ["higgsfield", "generate", "create", still["model"],
           "--prompt", prompt,
           "--aspect_ratio", still["aspect_ratio"],
           "--resolution", still["resolution"],
           "--wait", "--json"]
    if ref_image:
        cmd += ["--image", ref_image]
    job = sh_json(cmd)
    dest = os.path.join(ROOT, a["file"])
    download(result_url(job), dest)
    strip(a["file"])


def gen_shot(cfg, sid):
    s = cfg["shots"][sid]
    prompt = compose_prompt(s["prompt_file"], cfg)
    vid = cfg["models"]["video"]
    start = os.path.join(ROOT, s["start_image"])
    if not os.path.isfile(start):
        sys.exit(f"shot {sid}: locked anchor {s['start_image']} missing — anchors first, "
                 "and nothing else until the hero is a keeper")
    cmd = ["higgsfield", "generate", "create", vid["model"],
           "--prompt", prompt,
           "--start-image", start,
           "--duration", str(s["duration"]),
           "--resolution", vid["resolution"],
           "--generate_audio", "false",
           "--wait", "--wait-timeout", "30m", "--json"]
    job = sh_json(cmd)
    download(result_url(job), os.path.join(ROOT, s["output"]))
    strip(s["output"])


def strip(path):
    run([sys.executable, os.path.join(ROOT, "scripts", "review_strip.py"), path, "--zoom"])
    print(f"  REVIEW review/{os.path.splitext(os.path.basename(path))[0]}.strip.jpg "
          "before accepting: wordmark spelled right, bulls intact, slim proportions.")


def price(cfg):
    still = cfg["models"]["still"]
    vid = cfg["models"]["video"]
    for name in cfg["anchors"]:
        run(["higgsfield", "generate", "cost", still["model"],
             "--aspect_ratio", still["aspect_ratio"], "--resolution", still["resolution"]])
    for sid, s in cfg["shots"].items():
        print(f"shot {sid}:")
        run(["higgsfield", "generate", "cost", vid["model"],
             "--duration", str(s["duration"]), "--resolution", vid["resolution"]])


def main():
    cfg = load_config()
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    mode = args.pop(0)
    echo = False
    if mode == "print":
        echo = True
        mode = args.pop(0)
    if mode == "cost":
        return price(cfg)
    if mode == "anchor":
        name = args.pop(0)
        ref = args[args.index("--image") + 1] if "--image" in args else None
        if echo:
            print(compose_prompt(cfg["anchors"][name]["prompt_file"], cfg))
            return
        return gen_anchor(cfg, name, ref)
    if mode == "shot":
        for sid in args:
            if echo:
                print(f"--- {sid} ---")
                print(compose_prompt(cfg["shots"][sid]["prompt_file"], cfg))
            else:
                gen_shot(cfg, sid)
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    main()
