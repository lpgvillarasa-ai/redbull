"""Shared helpers for the Red Bull scroll-film pipeline."""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_config():
    with open(os.path.join(ROOT, "shots.config.json")) as f:
        return json.load(f)


def ffmpeg_exe():
    exe = os.environ.get("FFMPEG")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd))
    r = subprocess.run([str(c) for c in cmd], **kw)
    if r.returncode != 0:
        sys.exit(f"FAILED ({r.returncode}): {cmd[0]}")
    return r


def probe_frames(path):
    """Count video frames by decoding (imageio-ffmpeg ships no ffprobe)."""
    exe = ffmpeg_exe()
    r = subprocess.run(
        [exe, "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
        capture_output=True, text=True)
    for line in reversed(r.stderr.splitlines()):
        if line.startswith("frame="):
            return int(line.split("frame=")[1].split()[0])
    sys.exit(f"could not count frames of {path}")


def spread_indices(total, n):
    """Exactly n evenly spaced frame indices across [0, total-1]."""
    if n == 1:
        return [0]
    return sorted({round(i * (total - 1) / (n - 1)) for i in range(n)})


def compose_prompt(shot_prompt_file, cfg, colorway_suffix=None):
    """Token expansion: shot move + {subject} + {style}. Never retype."""
    def read(p):
        with open(os.path.join(ROOT, p)) as f:
            return f.read().strip()

    subject = read(cfg["prompt_composition"]["files"]["subject"])
    if colorway_suffix:
        subject = subject.replace("cobalt blue checkered panels", colorway_suffix)
    style = read(cfg["prompt_composition"]["files"]["style_bible"])
    text = read(shot_prompt_file)
    if "{subject}" in text or "{style}" in text:
        return text.replace("{subject}", subject).replace("{style}", style)
    return f"{text} {subject}. {style}"


def dir_size_mb(d):
    return sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d)) / 1e6
