import { test } from "node:test";
import assert from "node:assert/strict";
import { TAU, mod, ease, indexUnderPointer, planSpin, animateSpin, segColor, shortName, PALETTE } from "../../client/js/wheel.js";

// 고정 시드 난수
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const EPS = 1e-9; // 부동소수 오차 허용 범위

for (let n = 2; n <= 16; n++) {
  test(`planSpin n=${n}: 1000회 — 멈춘 칸 = 당첨 칸, 5~8바퀴, 칸 중심 ±35%`, () => {
    const rng = mulberry32(1000 + n);
    for (let r = 0; r < 1000; r++) {
      const theta = (rng() - 0.5) * 20 * TAU; // 무작위 시작 각도(음수·여러 바퀴 포함)
      const { k, delta } = planSpin(theta, n, rng);
      assert.ok(Number.isInteger(k) && k >= 0 && k < n);
      assert.ok(delta >= 5 * TAU - EPS && delta < 8 * TAU, `delta=${delta / TAU}τ`);
      const end = theta + delta;
      assert.equal(indexUnderPointer(end, n), k, `theta=${theta} k=${k}`);
      const A = TAU / n;
      const frac = mod(-Math.PI / 2 - end, TAU) / A - k; // 칸 안 위치(0~1), 중심 0.5
      assert.ok(Math.abs(frac - 0.5) <= 0.35 + EPS, `frac=${frac}`);
    }
  });
}

test("planSpin 난수 호출 순서: k → jitter → 바퀴 수", () => {
  const seq = [0.5, 0.75, 0.0]; let i = 0;
  const { k, delta } = planSpin(0, 4, () => seq[i++]);
  assert.equal(i, 3);
  assert.equal(k, 2);
  const A = TAU / 4;
  const end = -Math.PI / 2 - 2.5 * A + 0.25 * A * 0.7;
  assert.ok(Math.abs(delta - (mod(end, TAU) + 5 * TAU)) < EPS);
});

test("ease(0)=0, ease(1)=1 (오차 1e-12)", () => {
  assert.ok(Math.abs(ease(0)) < 1e-12);
  assert.ok(Math.abs(ease(1) - 1) < 1e-12);
});

test("segColor: 마지막 칸은 첫 칸과 색이 다름", () => {
  for (let n = 2; n <= 16; n++) {
    assert.notEqual(segColor(n - 1, n), segColor(0, n), `n=${n}`);
  }
  assert.equal(segColor(1, 8), PALETTE[1]);
});

test("shortName: 8자 초과면 7자+…", () => {
  assert.equal(shortName("12345678"), "12345678");
  assert.equal(shortName("123456789"), "1234567…");
});

test("animateSpin: 마지막 프레임은 정확히 from+delta, 칸이 바뀔 때 onTick", async () => {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  const names = ["a", "b", "c", "d", "e"];
  const from = 1.234;
  const { k, delta } = planSpin(from, names.length, mulberry32(7));
  const realRaf = globalThis.requestAnimationFrame;
  let step = 0;
  globalThis.requestAnimationFrame = cb => { const base = performance.now(); setImmediate(() => cb(base + 200 * ++step)); return 1; };
  try {
    let ticks = 0;
    const final = await animateSpin({ ctx, names, from, delta, onTick: () => ticks++ });
    assert.equal(final, from + delta);
    assert.equal(indexUnderPointer(final, names.length), k);
    assert.ok(ticks >= 5, `ticks=${ticks}`);
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
});
