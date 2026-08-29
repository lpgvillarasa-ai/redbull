# RED BULL — Cinematic Scroll-Film Concept Site

Unofficial concept project. Not affiliated with, sponsored, or endorsed by
Red Bull GmbH. AI-generated film takes (Higgsfield) → scroll-scrubbed frame
sequences → a cinematic single-page site → live on Vercel.

## Pipeline

```
shots.config.json                  # single source of truth (the asset contract)
prompts/                           # style bible + subject + per-shot moves, composed by token expansion
scripts/generate.py cost           # price the pass before generating anything
scripts/generate.py anchor hero    # lock the hero still FIRST, iterate, then never change it
scripts/generate.py shot A         # image-to-video (seedance_2_0 4k) from locked anchors
scripts/dissolve.py                # C1+C2, E1+E2 xfade joins
scripts/extract_frames.py          # exactly-N spread webp frames, budget-enforced
scripts/extract_frames.py --turntable
scripts/recolor.py                 # deterministic Edition colorways (soft-weighted chroma rotation)
scripts/make_loops.py              # palindrome/outro loops, mp4+webm
scripts/review_strip.py <take>     # 6-frame contact strip — EYES on every take before accepting
scripts/check_contract.py          # gate: green or it doesn't deploy
```

Placeholder mode (no Higgsfield credits burned): `scripts/placeholders.py`
renders synthetic takes into `takes/` so the entire downstream pipeline and
site run end-to-end. Real takes overwrite the same paths; re-run extract →
recolor → loops → check and push.

## Review bar (every accepted frame)

RED BULL wordmark legible and correctly spelled · double-bull logo intact ·
slim 250 ml proportions · no duplicate cans, hands, watermarks. Text-on-can
is the #1 drift risk; a wrong-identity take is a reroll, not a fix-in-post.

## Deploy

Vercel static (`vercel.json` pins `@vercel/static` so `/` doesn't 404 on a
repo with a `public/` folder). `.vercelignore` keeps prompts/scripts/takes
out of the deploy. Deployment Protection must be OFF for a public site.
