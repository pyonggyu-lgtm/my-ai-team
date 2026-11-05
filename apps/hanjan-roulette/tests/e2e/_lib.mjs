// 0단계 비교 시험 공용 도구 (진사). 새 패키지 없이 /workspace/node_modules/playwright-core 사용.
import { chromium } from "playwright-core";

export const EXE = "/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
export const ORIG = "file:///workspace/apps/hanjan-roulette/docs/reference/점심메뉴_룰렛.html";
export const NEW = `http://localhost:${process.env.PORT || 8080}/`;
export const CAP = "/workspace/apps/hanjan-roulette/docs/design/0단계_캡처";
export const KEY = "lunchRoulette.v1.";

export const launch = () =>
  chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });

// 페이지가 열리기 전에 넣는 관찰용 코드. 앱 코드는 건드리지 않고 브라우저 API만 감싼다.
//  - Math.random 고정 시드(두 화면이 같은 난수 순서를 받으면 같은 칸에서 멈춤)
//  - AudioContext 가짜(주파수·길이·볼륨 기록)
//  - canvas translate/rotate/fillText/clearRect 기록(포인터 튕김, 룰렛 글자)
//  - body.busy·overlay.show·toast 변화 시각 기록, "다시 돌리기" 클릭 시각 기록
export const INIT = `(() => {
  let s = 12345;
  Math.random = function () { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__audio = { ctxCount: 0, osc: [] };
  class FakeAC {
    constructor() { window.__audio.ctxCount++; this.currentTime = 0; this.destination = {}; }
    createOscillator() {
      const o = { frequency: { value: 0 }, connect(n) { if (n && n.gain) o._g = n; }, start(t) { o.t0 = t; },
        stop(t) { window.__audio.osc.push({ f: o.frequency.value, when: +(+o.t0).toFixed(3), dur: +(t - o.t0).toFixed(3), vol: o._g ? +o._g.gain.value.toFixed(3) : null }); } };
      return o;
    }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
  }
  window.AudioContext = FakeAC; window.webkitAudioContext = FakeAC;
  window.__kicks = []; window.__texts = [];
  const P = CanvasRenderingContext2D.prototype; let ptr = false;
  const tr = P.translate; P.translate = function (x, y) { ptr = (x === 450 && y === 30); return tr.apply(this, arguments); };
  const ro = P.rotate; P.rotate = function (a) { if (ptr) { window.__kicks.push(a); ptr = false; } return ro.apply(this, arguments); };
  const ft = P.fillText; P.fillText = function (t) { window.__texts.push(t); return ft.apply(this, arguments); };
  const cr = P.clearRect; P.clearRect = function (x, y, w, h) { if (w === 900 && h === 900) window.__texts = []; return cr.apply(this, arguments); };
  window.__ev = [];
  new MutationObserver(() => {
    const b = document.body; if (!b) return;
    const o = document.getElementById("overlay"), t = document.getElementById("toast");
    window.__ev.push({ t: performance.now(), busy: b.classList.contains("busy"), show: !!(o && o.classList.contains("show")), toast: t ? t.style.display : "" });
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  document.addEventListener("click", e => { if (e.target && e.target.id === "againBtn") window.__againClick = performance.now(); }, true);
})();`;

export async function open(browser, url, { viewport = { width: 1440, height: 900 }, reducedMotion = "no-preference", init = true } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  if (init) await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") page.errors.push("console.error: " + m.text()); });
  await page.goto(url, { waitUntil: "load" });
  return { ctx, page };
}

export async function settle(page, ms = 500) {
  await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load("700 40px Pretendard"); });
  await page.waitForTimeout(ms);
}

// 두 PNG(data URL) 사이에 다른 픽셀 수
export async function pixelDiff(browser, a, b) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const r = await p.evaluate(async ([a, b]) => {
    const load = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    if (A.width !== B.width || A.height !== B.height) return { size: [A.width, A.height, B.width, B.height] };
    const px = i => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const da = px(A), db = px(B); let n = 0;
    for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) n++;
    return { w: A.width, h: A.height, diff: n };
  }, [a, b]);
  await ctx.close();
  return r;
}
