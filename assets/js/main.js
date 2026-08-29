/* RED BULL — scroll film. One master timeline: every scrub segment
   concatenated virtually into a single global frame index on one sticky
   canvas, with dissolve insurance at joins, ordered ahead-of-playhead
   preloading and a nearest-loaded-frame fallback. Loops, ingredients and
   the turntable flow below the film as normal sections. */
"use strict";

const MOBILE = matchMedia("(max-width: 720px)").matches;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min(devicePixelRatio || 1, 2);

/* ---------- the film manifest (mirrors shots.config.json "film") ---------- */
const FILM_DIR = MOBILE ? "public/film-m" : "public/film";
const SEGMENTS = [
  { id: "A",  label: "SHOT A — HERO ORBIT",        frames: MOBILE ? 60 : 120 },
  { id: "T1", label: "TRANSIT — THE ORBIT CLOSES", frames: MOBILE ? 24 : 48 },
  { id: "B",  label: "SHOT B — LOGO PUSH-IN",      frames: MOBILE ? 45 : 90 },
  { id: "T2", label: "TRANSIT — RISE TO THE LID",  frames: MOBILE ? 24 : 48 },
  { id: "C2", label: "SHOT C — THE OPENING",       frames: MOBILE ? 45 : 90 },
  { id: "T3", label: "TRANSIT — TIP AND POUR",     frames: MOBILE ? 24 : 48 },
  { id: "E2", label: "SHOT E — THE POUR",          frames: MOBILE ? 45 : 90 },
];
const PREFIX = SEGMENTS.reduce((a, s) => (a.push(a[a.length - 1] + s.frames), a), [0]);
const TOTAL = PREFIX[PREFIX.length - 1];
const JOINS = PREFIX.slice(1, -1);          // interior boundaries, global frame index
const XFADE = 4;                            // dissolve insurance, frames each side
const VH_PER_FRAME = MOBILE ? 8 : 4;        // same physical scroll length either way

const pad = n => String(n).padStart(4, "0");
const ease = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/* ---------- segment loading ---------- */
SEGMENTS.forEach(s => { s.images = null; s.started = false; });

function loadSegment(i, onProgress) {
  const seg = SEGMENTS[i];
  if (!seg || seg.started) return seg && seg.promise;
  seg.started = true;
  seg.images = new Array(seg.frames);
  let done = 0;
  seg.promise = Promise.all(Array.from({ length: seg.frames }, (_, f) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = img.onerror = () => {
        done++; onProgress?.(done / seg.frames);
        if (img === nearestPending) redraw();
        resolve();
      };
      img.src = `${FILM_DIR}/${seg.id}/${pad(f + 1)}.webp`;
      seg.images[f] = img;
    })
  )).then(() => redraw());
  return seg.promise;
}
let nearestPending = null;                  // the substituted-for image; redraw when it lands

function segAt(g) {
  let i = 0;
  while (i < SEGMENTS.length - 1 && g >= PREFIX[i + 1]) i++;
  return i;
}

/* nearest fully-decoded frame in the segment, searching outward — never blank */
function nearestLoaded(seg, local) {
  if (!seg.images) return null;
  for (let d = 0; d < seg.frames; d++) {
    for (const f of d ? [local - d, local + d] : [local]) {
      if (f >= 0 && f < seg.frames) {
        const img = seg.images[f];
        if (img && img.complete && img.naturalWidth) return img;
      }
    }
  }
  return null;
}

/* ---------- canvas ---------- */
const filmSection = document.getElementById("film-act");
const canvas = document.getElementById("film-canvas");
const ctx = canvas.getContext("2d");
filmSection.style.height = `${TOTAL * VH_PER_FRAME}vh`;
let W = 0, H = 0;

function resize() {
  const r = canvas.getBoundingClientRect();
  W = canvas.width = Math.round(r.width * DPR);
  H = canvas.height = Math.round(r.height * DPR);
}
resize();
addEventListener("resize", () => { resize(); redraw(); });

function drawCover(img, alpha) {
  if (!img) return;
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = alpha ?? 1;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

let gFrame = -1;

function draw(g) {
  const i = segAt(g);
  const seg = SEGMENTS[i];
  const local = g - PREFIX[i];
  const exact = seg.images?.[local];
  const img = (exact && exact.complete && exact.naturalWidth) ? exact : nearestLoaded(seg, local);
  nearestPending = img === exact ? null : exact;
  drawCover(img);
  // dissolve insurance across every join (bridges are pinned, this is belt+braces)
  for (const b of JOINS) {
    const d = g - b;
    if (d >= -XFADE && d < XFADE) {
      const other = d < 0
        ? nearestLoaded(SEGMENTS[segAt(b)], 0)
        : nearestLoaded(SEGMENTS[segAt(b - 1)], SEGMENTS[segAt(b - 1)].frames - 1);
      if (other) drawCover(other, (XFADE - Math.abs(d)) / (XFADE * 2));
      break;
    }
  }
}
function redraw() { if (gFrame >= 0) draw(gFrame); }

/* ---------- HUD + copy waypoints ---------- */
const hudShot = document.getElementById("hud-shot");
const hudFrame = document.getElementById("hud-frame");
const wps = [...filmSection.querySelectorAll(".wp")].map(el => {
  const i = SEGMENTS.findIndex(s => s.id === el.dataset.seg);
  const [a, b] = el.dataset.win.split(",").map(Number);
  return { el, from: PREFIX[i] + a * SEGMENTS[i].frames, to: PREFIX[i] + b * SEGMENTS[i].frames };
});

function filmTick() {
  const rect = filmSection.getBoundingClientRect();
  const span = rect.height - innerHeight;
  const p = Math.min(1, Math.max(0, -rect.top / span));
  const g = Math.round(ease(p) * (TOTAL - 1));
  if (g !== gFrame) {
    gFrame = g;
    draw(g);
    ensureAhead(g);
  }
  if (rect.bottom > innerHeight * 0.5 && rect.top < innerHeight * 0.5) {
    hudShot.textContent = SEGMENTS[segAt(g)].label;
    hudFrame.textContent = `${pad(g + 1)} / ${pad(TOTAL)}`;
  }
  for (const w of wps) w.el.classList.toggle("on", g >= w.from && g <= w.to);
}

/* ordered ahead-of-playhead preloading: current segment + the next one */
function ensureAhead(g) {
  const i = segAt(g);
  loadSegment(i);
  if (i + 1 < SEGMENTS.length && g >= PREFIX[i + 1] - SEGMENTS[i].frames) loadSegment(i + 1);
}

/* ---------- loader curtain over segment A ---------- */
const loaderEl = document.getElementById("loader");
const fillEl = document.getElementById("loader-fill");
const pctEl = document.getElementById("loader-pct");
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  loaderEl.classList.add("done");
  gFrame = -1;
  filmTick();
}
loadSegment(0, p => {
  const pct = Math.round(p * 100);
  fillEl.style.width = pct + "%";
  pctEl.textContent = String(pct).padStart(2, "0") + "%";
  if (p >= 0.55) reveal();
});
setTimeout(reveal, 12000);
loadSegment(1);                              // T1 warms right behind the hero

/* ---------- scroll loop ---------- */
let raf = null;
addEventListener("scroll", () => {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = null; filmTick(); flowTick(); });
}, { passive: true });

/* ---------- normal-flow sections: loops, ingredients, turntable ---------- */
const loopIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting) {
      if (!v.dataset.armed) {
        v.dataset.armed = "1";
        for (const [type, key] of [["video/webm", "webm"], ["video/mp4", "mp4"]]) {
          const s = document.createElement("source");
          s.src = v.dataset[key];
          s.type = type;
          v.appendChild(s);
        }
        v.load();
      }
      if (!REDUCED) v.play().catch(() => {});
    } else if (v.dataset.armed) v.pause();
  }
}, { rootMargin: "60% 0px" });
document.querySelectorAll("video[data-mp4]").forEach(v => loopIO.observe(v));

function flowTick() {
  for (const sec of document.querySelectorAll(".loop-act, .ingredients, .turntable")) {
    const r = sec.getBoundingClientRect();
    if (r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5) {
      hudShot.textContent = sec.dataset.shot;
      hudFrame.textContent = sec.classList.contains("turntable")
        ? `${pad((Math.round(turnPos) % TURN_N + TURN_N) % TURN_N + 1)} / ${pad(TURN_N)}`
        : "LOOP";
    }
    if (sec.classList.contains("loop-act")) {
      const total = Math.max(1, r.height - innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / total));
      for (const wp of sec.querySelectorAll(".wp")) {
        const [a, b] = wp.dataset.win.split(",").map(Number);
        wp.classList.toggle("on", p >= a && p <= b);
      }
    }
  }
}

/* ---------- count-up ingredients ---------- */
const countIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    countIO.unobserve(e.target);
    const to = +e.target.dataset.to, t0 = performance.now(), dur = 1400;
    if (REDUCED) { e.target.textContent = to.toLocaleString("en-US"); continue; }
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      e.target.textContent = Math.round(to * ease(p)).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
}, { threshold: 0.6 });
document.querySelectorAll(".count").forEach(el => countIO.observe(el));

/* ---------- turntable: 96 frames, fractional angle, wrap-blended,
   one deterministic recolor set per Edition ---------- */
const TURN_N = 96;
const EDITIONS = [
  { id: "original", name: "Original",         line: "The one that started it all. 1987.",      hex: "#1e3f8f" },
  { id: "seablue",  name: "Sea Blue Edition", line: "The taste of juneberry.",                 hex: "#0e7c9e" },
  { id: "pink",     name: "Pink Edition",     line: "Raspberry with herbal verbena.",          hex: "#d6336c" },
  { id: "yellow",   name: "Yellow Edition",   line: "The taste of tropical fruits.",           hex: "#f5c400" },
  { id: "peach",    name: "Peach Edition",    line: "White peach, citrus peel, floral notes.", hex: "#f49a6a" },
  { id: "red",      name: "Red Edition",      line: "The taste of watermelon.",                hex: "#d62839" },
];
const turnCanvas = document.getElementById("turn-canvas");
const turnCtx = turnCanvas.getContext("2d");
const turnSets = {};                         // id -> Image[]
let activeEdition = EDITIONS[0];
let turnStarted = false, turnPos = 0, turnVel = 0;
let dragging = false, lastX = 0, idle = true;

function loadTurnSet(id) {
  if (turnSets[id]) return;
  turnSets[id] = Array.from({ length: TURN_N }, (_, f) => {
    const img = new Image();
    img.src = `public/turn/${id}/${pad(f + 1)}.webp`;
    return img;
  });
}
function loadTurn() {
  if (turnStarted) return;
  turnStarted = true;
  loadTurnSet("original");
  EDITIONS.slice(1).forEach(ed => loadTurnSet(ed.id));   // warm the cache
}
function sizeTurn() {
  const r = turnCanvas.getBoundingClientRect();
  turnCanvas.width = Math.round(r.width * DPR);
  turnCanvas.height = Math.round(r.height * DPR);
}
sizeTurn();
addEventListener("resize", sizeTurn);

function turnDrawImg(img, alpha) {
  if (!img || !img.complete || !img.naturalWidth) return;
  const s = Math.max(turnCanvas.width / img.naturalWidth, turnCanvas.height / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  turnCtx.imageSmoothingEnabled = true;
  turnCtx.imageSmoothingQuality = "high";
  turnCtx.globalAlpha = alpha;
  turnCtx.drawImage(img, (turnCanvas.width - dw) / 2, (turnCanvas.height - dh) / 2, dw, dh);
  turnCtx.globalAlpha = 1;
}
function drawTurn() {
  const imgs = turnSets[activeEdition.id];
  if (!imgs) return;
  const posMod = ((turnPos % TURN_N) + TURN_N) % TURN_N;
  const i = Math.floor(posMod);
  const frac = posMod - i;
  turnDrawImg(imgs[i], 1);
  if (frac > 0.001) turnDrawImg(imgs[(i + 1) % TURN_N], frac);   // across the wrap too
}
(function spin(prev) {
  requestAnimationFrame(t => {
    const dt = prev ? Math.min(0.1, (t - prev) / 1000) : 0.016;
    if (!dragging) {
      if (Math.abs(turnVel) > 0.05) { turnPos += turnVel * dt; turnVel *= 0.94; }
      else if (idle && !REDUCED) turnPos += 18 * dt;     // ~19s per revolution at 96f
    }
    if (turnStarted) drawTurn();
    spin(t);
  });
})();

turnCanvas.addEventListener("pointerdown", e => {
  dragging = true; idle = false; lastX = e.clientX; turnVel = 0;
  turnCanvas.classList.add("dragging");
  turnCanvas.setPointerCapture(e.pointerId);
});
turnCanvas.addEventListener("pointermove", e => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  const step = dx * TURN_N / turnCanvas.getBoundingClientRect().width * 1.4;
  turnPos += step;
  turnVel = step * 60;
});
["pointerup", "pointercancel"].forEach(ev => turnCanvas.addEventListener(ev, () => {
  dragging = false;
  turnCanvas.classList.remove("dragging");
  setTimeout(() => idle = true, 4000);
}));

/* Edition swatches */
const swatchBox = document.getElementById("swatches");
const editionLine = document.getElementById("edition-line");
EDITIONS.forEach((ed, i) => {
  const b = document.createElement("button");
  b.style.setProperty("--sw", ed.hex);
  b.setAttribute("role", "tab");
  b.setAttribute("aria-selected", i === 0 ? "true" : "false");
  b.setAttribute("aria-label", ed.name);
  b.title = ed.name;
  b.addEventListener("click", () => {
    activeEdition = ed;
    swatchBox.querySelectorAll("button").forEach(x =>
      x.setAttribute("aria-selected", x === b ? "true" : "false"));
    editionLine.textContent = ed.line;
    document.documentElement.style.setProperty("--edition", ed.hex);
    loadTurnSet(ed.id);
  });
  swatchBox.appendChild(b);
});

const turnIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    turnIO.unobserve(e.target);
    loadTurn();
  }
}, { rootMargin: "100% 0px" });
turnIO.observe(document.getElementById("act-h"));

/* initial paint */
filmTick();
flowTick();
