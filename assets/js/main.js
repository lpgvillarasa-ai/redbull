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

/* ---------- frame loading: the whole film, coarse to fine ----------
   The film is hundreds of large frames, more than can arrive while someone
   scrolls through it. So frames are not fetched shot by shot: every frame is
   weighed by how far it is from where the visitor is in the film and how
   coarse it is (every 16th frame first, then every 8th, 4th, 2nd, then the
   rest). The spot on screen fills in densely, the rest of the film gets an
   even spread early, and the picture always has a near frame to show
   instead of freezing on an earlier shot. */
const FRAMES = new Array(TOTAL);             // global frame index -> Image, once requested
const TRIES = new Uint8Array(TOTAL);         // failed attempts per frame (retried up to 3 times)
const NET_MAX = MOBILE ? 4 : 8;              // downloads at a time (each waits on a round trip to the host)
let netActive = 0, readyCount = 0;
/* Pacing: the domain's protection blocks a visitor for 10 s after 300 requests in
   10 s, and a blocked visitor's frames fail, which made the film stutter. So the page
   (film and turntable together) never asks for more than about 20 files a second. */
const PACE = { rate: 20, burst: 24, tokens: 24, last: 0, timer: 0 };
const turnQueue = [];                        // turntable frames waiting to download, in order
let turnUrgent = false;                      // the turntable is on screen: its frames go first
let filmInView = true;                       // past the film, the turntable's frames go first too
let playhead = 0;                            // the frame the visitor is scrolling toward
const levelOf = g => (g % 16 === 0 ? 16 : g % 8 === 0 ? 8 : g % 4 === 0 ? 4 : g % 2 === 0 ? 2 : 1);

function segAt(g) {
  let i = 0;
  while (i < SEGMENTS.length - 1 && g >= PREFIX[i + 1]) i++;
  return i;
}
function frameUrl(g) {
  const i = segAt(g);
  return `${FILM_DIR}/${SEGMENTS[i].id}/${pad(g - PREFIX[i] + 1)}.webp`;
}
// ready = downloaded and unpacked, so painting it never stalls the scroll
const isReady = img => !!(img && img.ready);

function nextFrame() {
  // lowest cost wins: near the playhead (ahead counts closer than behind) and coarse frames first
  let best = -1, bestCost = Infinity;
  for (let g = 0; g < TOTAL; g++) {
    if (FRAMES[g]) continue;
    const dist = g >= playhead ? g - playhead : (playhead - g) * 2;
    const cost = (dist + 4) / levelOf(g);
    if (cost < bestCost) { bestCost = cost; best = g; }
  }
  return best;
}
function token() {
  const now = performance.now();
  PACE.tokens = Math.min(PACE.burst, PACE.tokens + (now - (PACE.last || now)) / 1000 * PACE.rate);
  PACE.last = now;
  if (PACE.tokens >= 1) { PACE.tokens -= 1; return true; }
  if (!PACE.timer) PACE.timer = setTimeout(() => { PACE.timer = 0; pumpFrames(); }, 50);
  return false;
}
/* one download: unpack it before it counts as ready; a failure is retried later */
function fetchImg(img, src, done, failed) {
  netActive++;
  img.onload = () => {
    (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => {
      netActive--;
      img.ready = true;
      done();
      pumpFrames();
    });
  };
  img.onerror = () => { netActive--; failed(); pumpFrames(); };
  img.src = src;
}
function pumpFrames() {
  while (netActive < NET_MAX) {
    let job = null;
    if ((turnUrgent || !filmInView) && turnQueue.length) job = turnQueue.shift();
    else {
      const g = nextFrame();
      if (g >= 0) job = { film: g };
      else if (turnQueue.length) job = turnQueue.shift();
    }
    if (!job) return;
    if (!token()) { if (job.film === undefined) turnQueue.unshift(job); return; }
    if (job.film !== undefined) {
      const g = job.film;
      const img = new Image();
      FRAMES[g] = img;
      fetchImg(img, frameUrl(g), () => { readyCount++; onFrameReady(g); }, () => {
        // blocked or lost: try again later (FRAMES[g] stays set meanwhile, so it is not asked for again yet)
        if (++TRIES[g] < 4) setTimeout(() => { FRAMES[g] = undefined; pumpFrames(); }, 2500 * TRIES[g]);
      });
    } else {
      fetchImg(job.img, job.src, () => {}, () => {
        if (++job.tries < 4) setTimeout(() => { turnQueue.push(job); pumpFrames(); }, 2500 * job.tries);
      });
    }
  }
}

/* nearest frame that has arrived, searching outward from g: never blank,
   and never a frame from far away when a closer one exists */
function nearestReady(g) {
  for (let d = 0; d < TOTAL; d++) {
    if (g - d >= 0 && isReady(FRAMES[g - d])) return g - d;
    if (g + d < TOTAL && isReady(FRAMES[g + d])) return g + d;
    if (g - d < 0 && g + d >= TOTAL) break;
  }
  return -1;
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
let gSmooth = 0;                             // eased-by-inertia, not by curve
let shown = -1;                              // the frame actually on the canvas

function draw(g) {
  const k = nearestReady(g);
  if (k < 0) return;                         // nothing has arrived yet: keep the curtain's black
  shown = k;
  drawCover(FRAMES[k]);
  // dissolve insurance across every join (bridges are pinned, this is belt+braces)
  for (const b of JOINS) {
    const d = g - b;
    if (d >= -XFADE && d < XFADE) {
      const o = nearestReady(d < 0 ? b : b - 1);
      if (o >= 0 && o !== k) drawCover(FRAMES[o], (XFADE - Math.abs(d)) / (XFADE * 2));
      break;
    }
  }
}
function redraw() { if (gFrame >= 0) draw(gFrame); }

/* a frame arrived: repaint if it is closer to the playhead than the one on screen */
function onFrameReady(g) {
  curtainProgress();
  if (gFrame >= 0 && (shown < 0 || Math.abs(g - gFrame) < Math.abs(shown - gFrame))) redraw();
}

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
  filmInView = rect.bottom > 0 && rect.top < innerHeight;
  const span = rect.height - innerHeight;
  const p = Math.min(1, Math.max(0, -rect.top / span));
  // LINEAR scroll->frame mapping (a global easing curve makes the film crawl
  // at the ends and rush the middle); smoothness comes from per-frame inertia
  const target = p * (TOTAL - 1);
  gSmooth += (target - gSmooth) * (REDUCED ? 1 : 0.22);
  if (Math.abs(target - gSmooth) < 0.05) gSmooth = target;
  const g = Math.round(gSmooth);
  const aim = Math.round(target);
  if (aim !== playhead) { playhead = aim; pumpFrames(); }   // steer downloads toward where the visitor is going
  if (g !== gFrame) {
    gFrame = g;
    draw(g);
  }
  if (rect.bottom > innerHeight * 0.5 && rect.top < innerHeight * 0.5) {
    hudShot.textContent = SEGMENTS[segAt(g)].label;
    hudFrame.textContent = `${pad(g + 1)} / ${pad(TOTAL)}`;
  }
  for (const w of wps) w.el.classList.toggle("on", g >= w.from && g <= w.to);
}

/* ---------- loader curtain over the opening ---------- */
const loaderEl = document.getElementById("loader");
const fillEl = document.getElementById("loader-fill");
const pctEl = document.getElementById("loader-pct");
const CURTAIN = MOBILE ? 20 : 30;            // frames in hand before the film opens (spread over the opening)
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  loaderEl.classList.add("done");
  gFrame = -1;
  filmTick();
}
function curtainProgress() {
  if (revealed) return;
  const p = Math.min(1, readyCount / CURTAIN);
  const pct = Math.round(p * 100);
  fillEl.style.width = pct + "%";
  pctEl.textContent = String(pct).padStart(2, "0") + "%";
  if (p >= 1 && isReady(FRAMES[0])) reveal();
}
setTimeout(reveal, 12000);
pumpFrames();

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

function loadTurnSet(id, first) {
  // queued, not fetched at once: six editions of 96 frames would cross the domain's limit
  if (turnSets[id]) {
    if (first) {                             // chosen now: move its frames still waiting to the front
      const mine = turnQueue.filter(j => j.set === id);
      for (const j of mine) turnQueue.splice(turnQueue.indexOf(j), 1);
      turnQueue.unshift(...mine);
      pumpFrames();
    }
    return;
  }
  turnSets[id] = Array.from({ length: TURN_N }, () => new Image());
  const jobs = turnSets[id].map((img, f) => ({ set: id, img, src: `public/turn/${id}/${pad(f + 1)}.webp`, tries: 0 }));
  if (first) turnQueue.unshift(...jobs); else turnQueue.push(...jobs);
  pumpFrames();
}
function loadTurn() {
  if (turnStarted) return;
  turnStarted = true;
  loadTurnSet(activeEdition.id, true);
  EDITIONS.forEach(ed => loadTurnSet(ed.id));            // the others after it, paced
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
    filmTick();
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
    loadTurnSet(ed.id, true);
  });
  swatchBox.appendChild(b);
});

const turnIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    turnUrgent = e.isIntersecting;           // near the turntable: its frames go before the film's
    if (e.isIntersecting) loadTurn();
  }
}, { rootMargin: "100% 0px" });
turnIO.observe(document.getElementById("act-h"));

/* initial paint */
filmTick();
flowTick();
