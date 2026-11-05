// 소리·색종이 — 원본 259–273, 338–359줄.
import { PALETTE, TAU } from "./wheel.js";

// ---------- sound (off by default; starts only after a click) ----------
let sound = false;
export function setSound(on) { sound = !!on; }

let actx = null;
function beep(freq, dur, vol, when) {
  if (!sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), v = actx.createGain();
    o.frequency.value = freq; v.gain.value = vol;
    o.connect(v); v.connect(actx.destination);
    const t = actx.currentTime + (when || 0);
    o.start(t); o.stop(t + dur);
  } catch (e) {}
}
export const tick = () => beep(900, 0.03, 0.06);
export const chime = () => { beep(660, 0.18, 0.1, 0); beep(880, 0.18, 0.1, 0.16); beep(1100, 0.3, 0.1, 0.32); };

// ---------- confetti ----------
let confettiRaf = 0, parts = [];
export function startConfetti(c) {
  c.width = innerWidth; c.height = innerHeight;
  const x = c.getContext("2d");
  parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5,
    vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
    s: 6 + Math.random() * 8, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3,
    c: PALETTE[Math.floor(Math.random() * PALETTE.length)]
  }));
  const t0 = performance.now();
  cancelAnimationFrame(confettiRaf);
  (function f(now) {
    x.clearRect(0, 0, c.width, c.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
    });
    if (now - t0 < 4000) confettiRaf = requestAnimationFrame(f); else x.clearRect(0, 0, c.width, c.height);
  })(t0);
}
export function stopConfetti() { cancelAnimationFrame(confettiRaf); }
