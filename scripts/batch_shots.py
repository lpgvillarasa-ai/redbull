#!/usr/bin/env python3
"""Submit multiple shots without --wait, then poll, download, and build strips.

Usage: python3 scripts/batch_shots.py B C1 C2 D E1 E2 F G H
"""
import json
import os
import subprocess
import sys
import time

from shotlib import ROOT, load_config, compose_prompt
from generate import result_url, download, strip


def cli_json(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = r.stdout.strip()
    if r.returncode != 0:
        sys.exit(f"CLI failed: {' '.join(cmd)}\n{out}\n{r.stderr}")
    start = min((i for i in (out.find("["), out.find("{")) if i >= 0), default=-1)
    return json.loads(out[start:])


def main():
    cfg = load_config()
    vid = cfg["models"]["video"]
    jobs = {}
    for sid in sys.argv[1:]:
        if "=" in sid:                       # attach to an already-submitted job
            sid, jid = sid.split("=")
            jobs[sid] = jid
            print(f"attached {sid}: {jid}", flush=True)
            continue
        s = cfg["shots"][sid]
        start = os.path.join(ROOT, s["start_image"])
        assert os.path.isfile(start), f"missing anchor {start}"
        j = cli_json(["higgsfield", "generate", "create", vid["model"],
                      "--prompt", compose_prompt(s["prompt_file"], cfg),
                      "--start-image", start,
                      "--duration", str(s["duration"]),
                      "--resolution", vid["resolution"],
                      "--generate_audio", "false", "--json"])
        if isinstance(j, list):
            j = j[0]
        jid = j if isinstance(j, str) else (
            j.get("id") or j.get("job_id") or (j.get("jobs") or [{}])[0].get("id"))
        assert jid, f"no job id in {j}"
        jobs[sid] = jid
        print(f"submitted {sid}: {jid}", flush=True)

    pending = dict(jobs)
    while pending:
        time.sleep(20)
        for sid, jid in list(pending.items()):
            j = cli_json(["higgsfield", "generate", "get", jid, "--json"])
            if isinstance(j, list):
                j = j[0]
            st = j.get("status")
            if st in ("completed", "succeeded"):
                out = os.path.join(ROOT, cfg["shots"][sid]["output"])
                download(result_url(j), out)
                strip(cfg["shots"][sid]["output"])
                del pending[sid]
                print(f"DONE {sid}", flush=True)
            elif st in ("failed", "error", "canceled"):
                print(f"FAILED {sid}: {json.dumps(j)[:500]}", flush=True)
                del pending[sid]
            else:
                print(f"  {sid}: {st}", flush=True)


if __name__ == "__main__":
    main()
