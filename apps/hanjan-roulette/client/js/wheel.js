// 룰렛 그리기·회전 — 원본 137–140, 203–257, 276–307줄.
export const PALETTE = ["#b8402f","#9a5b0c","#3d7a45","#17757f","#3b55c4","#7a4bb5","#a93a76","#55657a"];
export const FONT = "'Pretendard','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
export const TAU = Math.PI * 2;
export const SPIN_SEC = 5;
export const mod = (x, m) => ((x % m) + m) % m;
export const ease = t => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

export function segColor(i, n) {
  let c = i % PALETTE.length;
  if (i === n - 1 && c === 0) c = 3;   // last wedge must differ from the first
  return PALETTE[c];
}
export function shortName(s) { return s.length > 8 ? s.slice(0, 7) + "…" : s; }

// 포인터(위쪽) 아래 칸 번호 — 순수
export function indexUnderPointer(theta, n) {
  return Math.floor(mod(-Math.PI / 2 - theta, TAU) / (TAU / n));
}

// 당첨 칸을 먼저 정한다. 난수 호출 순서: k → jitter → 바퀴 수 (원본 288–291줄)
export function planSpin(theta, n, rng = Math.random) {
  const A = TAU / n;
  const k = Math.floor(rng() * n);
  const jitter = (rng() - 0.5) * A * 0.7;
  const end = -Math.PI / 2 - (k + 0.5) * A + jitter;
  const delta = mod(end - theta, TAU) + TAU * (5 + Math.floor(rng() * 3));
  return { k, delta };
}

export function drawWheel(g, names, theta, pointerKick) {
  const W = 900, R = 400, cx = 450, cy = 470;
  g.clearRect(0, 0, W, W);
  const n = names.length;
  g.save(); g.translate(cx, cy);
  // paper rim
  g.beginPath(); g.arc(0, 0, R + 9, 0, TAU); g.lineWidth = 18; g.strokeStyle = "#f3eee3"; g.stroke();
  if (n < 1) {
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fillStyle = "#2c4166"; g.fill();
    g.fillStyle = "#f3eee3"; g.textAlign = "center"; g.font = "700 44px " + FONT;
    g.fillText("메뉴를 켜 주세요", 0, 14);
  } else {
    const A = TAU / n;
    const fs = n <= 8 ? 50 : n <= 12 ? 42 : 34;
    for (let i = 0; i < n; i++) {
      const a0 = theta + i * A;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, a0, a0 + A); g.closePath();
      g.fillStyle = segColor(i, n); g.fill();
      g.strokeStyle = "#f3eee3"; g.lineWidth = 4; g.stroke();
      g.save(); g.rotate(a0 + A / 2); g.textAlign = "right"; g.fillStyle = "#fff";
      g.font = "700 " + fs + "px " + FONT;
      g.fillText(shortName(names[i]), R - 38, fs * 0.35); g.restore();
    }
    // pegs on the rim at each wedge boundary, so the pointer has something to flick against
    g.fillStyle = "#1B2A44";
    for (let i = 0; i < n; i++) {
      const a = theta + i * A;
      g.beginPath(); g.arc(Math.cos(a) * (R + 9), Math.sin(a) * (R + 9), 6, 0, TAU); g.fill();
    }
  }
  // hub
  g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 14; g.shadowOffsetY = 4;
  g.beginPath(); g.arc(0, 0, 46, 0, TAU); g.fillStyle = "#f3eee3"; g.fill();
  g.shadowColor = "transparent";
  g.beginPath(); g.arc(0, 0, 16, 0, TAU); g.fillStyle = "#1B2A44"; g.fill();
  g.restore();
  // pointer
  g.save(); g.translate(cx, cy - R - 40); g.rotate(pointerKick);
  g.shadowColor = "rgba(0,0,0,.4)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
  g.beginPath(); g.moveTo(-26, -26); g.lineTo(26, -26); g.lineTo(0, 48); g.closePath();
  g.fillStyle = "#c0392b"; g.fill();
  g.shadowColor = "transparent"; g.strokeStyle = "#f3eee3"; g.lineWidth = 5; g.lineJoin = "round"; g.stroke();
  g.restore();
}

// 원본 292–307줄의 프레임 루프. 칸이 바뀔 때마다 onTick() 호출. 끝나면 최종 각도(from+delta)로 resolve.
export function animateSpin({ ctx, names, from, delta, onTick }) {
  return new Promise(resolve => {
    const start = from, t0 = performance.now();
    let theta = from, pointerKick = 0;
    let lastIdx = indexUnderPointer(theta, names.length);
    (function frame(now) {
      const t = Math.min((now - t0) / 1000 / SPIN_SEC, 1);
      theta = start + delta * ease(t);
      const idx = indexUnderPointer(theta, names.length);
      if (idx !== lastIdx) { lastIdx = idx; pointerKick = -0.5; if (onTick) onTick(); }
      pointerKick *= 0.85;
      drawWheel(ctx, names, theta, pointerKick);
      if (t < 1) return requestAnimationFrame(frame);
      theta = start + delta; pointerKick = 0; drawWheel(ctx, names, theta, pointerKick);
      resolve(theta);
    })(t0);
  });
}
