/* RED BULL — scroll film. Vanilla JS: canvas scrub acts, lazy preloading,
   loops, drag turntable with Edition recolors, HUD, copy waypoints. */
"use strict";

const MOBILE = matchMedia("(max-width: 720px)").matches;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min(devicePixelRatio || 1, 2);

const SEQ = {
  hero:    { dir: MOBILE ? "public/seq-m/hero"    : "public/seq/hero",    frames: MOBILE ? 60 : 120 },
  logo:    { dir: MOBILE ? "public/seq-m/logo"    : "public/seq/logo",    frames: MOBILE ? 45 : 90 },
  opening: { dir: MOBILE ? "public/seq-m/opening" : "public/seq/opening", frames: MOBILE ? 45 : 90 },
  pour:    { dir: MOBILE ? "public/seq-m/pour"    : "public/seq/pour",    frames: MOBILE ? 45 : 90 },
};
const TURN = { frames: 24, dir: id => `public/turn/${id}` };
const EDITIONS = [
  { id: "original", name: "Original",         line: "The one that started it all. 1987.", hex: "#1e3f8f" },
  { id: "seablue",  name: "Sea Blue Edition", line: "The taste of juneberry.",            hex: "#0e7c9e" },
  { id: "pink",     name: "Pink Edition",     line: "Raspberry with herbal verbena.",     hex: "#d6336c" },
  { id: "yellow",   name: "Yellow Edition",   line: "The taste of tropical fruits.",      hex: "#f5c400" },
  { id: "peach",    name: "Peach Edition",    line: "White peach, citrus peel, floral notes.", hex: "#f49a6a" },
  { id: "red",      name: "Red Edition",      line: "The taste of watermelon.",           hex: "#d62839" },
];

const pad = n => String(n).padStart(4, "0");
const frameURL = (dir, i) => `${dir}/${pad(i + 1)}.webp`;
const ease = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2); // easeInOutQuad

/* ---------- sequence loader ---------- */
function loadSequence(seq, onProgress) {
  if (seq.promise) return seq.promise;
  seq.images = new Array(seq.frames);
  let done = 0;
  seq.promise = Promise.all(Array.from({ length: seq.frames }, (_, i) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = img.onerror = () => { done++; onProgress?.(done / seq.frames); resolve(); };
      img.src = frameURL(seq.dir, i);
      seq.images[i] = img;
    })
  ));
  return seq.promise;
}

/* ---------- cover-fit draw ---------- */
function drawCover(ctx, img, w, h) {
  if (!img || !img.naturalWidth) return;
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/* ---------- HUD ---------- */
const hudShot = document.getElementById("hud-shot");
const hudFrame = document.getElementById("hud-frame");
function hud(shot, frame, total) {
  hudShot.textContent = shot;
  hudFrame.textContent = `${pad(frame + 1)} / ${pad(total)}`;
}

/* ---------- scrub acts ---------- */
class ScrubAct {
  constructor(section) {
    this.section = section;
    this.seq = SEQ[section.dataset.seq];
    this.shot = section.dataset.shot;
    this.canvas = section.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.frame = -1;
    this.resize();
    addEventListener("resize", () => { this.resize(); this.frame = -1; this.tick(true); });
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.round(r.width * DPR);
    this.h = Math.round(r.height * DPR);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }
  progress() {
    const rect = this.section.getBoundingClientRect();
    const total = rect.height - innerHeight;
    return Math.min(1, Math.max(0, -rect.top / total));
  }
  tick(force) {
    const p = this.progress();
    const f = Math.round(ease(p) * (this.seq.frames - 1));
    if (f !== this.frame || force) {
      this.frame = f;
      const img = this.seq.images?.[f];
      if (img) drawCover(this.ctx, img, this.w, this.h);
    }
    const rect = this.section.getBoundingClientRect();
    if (rect.top < innerHeight * 0.5 && rect.bottom > innerHeight * 0.5)
      hud(this.shot, f, this.seq.frames);
    // copy waypoints
    for (const wp of this.section.querySelectorAll(".wp")) {
      const [a, b] = wp.dataset.win.split(",").map(Number);
      wp.classList.toggle("on", p >= a && p <= b);
    }
  }
}

/* ---------- boot: loader curtain over hero preload ---------- */
const loaderEl = document.getElementById("loader");
const fillEl = document.getElementById("loader-fill");
const pctEl = document.getElementById("loader-pct");
const acts = [...document.querySelectorAll(".scrub-act")].map(s => new ScrubAct(s));

let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  loaderEl.classList.add("done");
  acts[0].tick(true);
}
loadSequence(SEQ.hero, p => {
  const pct = Math.round(p * 100);
  fillEl.style.width = pct + "%";
  pctEl.textContent = String(pct).padStart(2, "0") + "%";
  if (p >= 0.55) reveal();           // progressive reveal
}).then(reveal);
setTimeout(reveal, 12000);           // never trap the visitor

/* lazy-preload other acts one viewport early */
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const seq = SEQ[e.target.dataset.seq];
    if (seq) loadSequence(seq).then(() => {
      const act = acts.find(a => a.seq === seq);
      act && act.tick(true);
    });
    io.unobserve(e.target);
  }
}, { rootMargin: "100% 0px" });
acts.slice(1).forEach(a => io.observe(a.section));

/* scroll loop */
let raf = null;
addEventListener("scroll", () => {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = null; acts.forEach(a => a.tick()); loopHud(); });
}, { passive: true });

/* ---------- loop videos: attach sources + play near viewport ---------- */
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

function loopHud() {
  for (const sec of document.querySelectorAll(".loop-act, .ingredients, .turntable")) {
    const r = sec.getBoundingClientRect();
    if (r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5) {
      hudShot.textContent = sec.dataset.shot;
      hudFrame.textContent = "LOOP";
      if (sec.classList.contains("turntable")) hudFrame.textContent = `${pad(turnFrame + 1)} / ${pad(TURN.frames)}`;
    }
    // loop-act waypoints scrub on their own section progress
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

/* ---------- turntable ---------- */
const turnCanvas = document.getElementById("turn-canvas");
const turnCtx = turnCanvas.getContext("2d");
const turnCache = {};                       // id -> {images, promise}
let turnFrame = 0, turnPos = 0, turnVel = 0, activeEdition = EDITIONS[0];
let dragging = false, lastX = 0, idle = true;

function turnSeq(id) {
  if (!turnCache[id]) turnCache[id] = { dir: TURN.dir(id), frames: TURN.frames };
  return turnCache[id];
}
function sizeTurn() {
  const r = turnCanvas.getBoundingClientRect();
  turnCanvas.width = Math.round(r.width * DPR);
  turnCanvas.height = Math.round(r.height * DPR);
}
sizeTurn();
addEventListener("resize", () => { sizeTurn(); drawTurn(true); });

function drawTurn(force) {
  const seq = turnSeq(activeEdition.id);
  if (!seq.images) return;
  const f = ((Math.round(turnPos) % TURN.frames) + TURN.frames) % TURN.frames;
  if (f === turnFrame && !force) return;
  turnFrame = f;
  drawCover(turnCtx, seq.images[f], turnCanvas.width, turnCanvas.height);
}
(function spin(prev) {
  requestAnimationFrame(t => {
    const dt = prev ? (t - prev) / 1000 : 0.016;
    if (!dragging) {
      if (Math.abs(turnVel) > 0.02) { turnPos += turnVel * dt; turnVel *= 0.94; }
      else if (idle && !REDUCED) turnPos += 4.5 * dt;   // idle auto-spin
    }
    drawTurn();
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
  turnPos += dx * TURN.frames / turnCanvas.getBoundingClientRect().width * 1.4;
  turnVel = dx * 1.6;
});
["pointerup", "pointercancel"].forEach(ev => turnCanvas.addEventListener(ev, () => {
  dragging = false;
  turnCanvas.classList.remove("dragging");
  setTimeout(() => idle = true, 4000);
}));

/* swatches */
const swatchBox = document.getElementById("swatches");
const editionLine = document.getElementById("edition-line");
EDITIONS.forEach((ed, i) => {
  const b = document.createElement("button");
  b.style.setProperty("--sw", ed.hex);
  b.setAttribute("role", "tab");
  b.setAttribute("aria-selected", i === 0 ? "true" : "false");
  b.setAttribute("aria-label", ed.name);
  b.title = ed.name;
  b.addEventListener("click", () => selectEdition(ed, b));
  swatchBox.appendChild(b);
});
function selectEdition(ed, btn) {
  activeEdition = ed;
  swatchBox.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", x === btn ? "true" : "false"));
  editionLine.textContent = ed.line;
  document.documentElement.style.setProperty("--edition", ed.hex);
  loadSequence(turnSeq(ed.id)).then(() => drawTurn(true));
}

/* arm the turntable one viewport early */
const turnIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    turnIO.unobserve(e.target);
    loadSequence(turnSeq("original")).then(() => drawTurn(true));
    EDITIONS.slice(1).forEach(ed => loadSequence(turnSeq(ed.id))); // warm the cache
  }
}, { rootMargin: "100% 0px" });
turnIO.observe(document.getElementById("act-h"));

/* initial paint */
acts.forEach(a => a.tick(true));
loopHud();
