// 시험 C: 원본과 새 화면의 #wheel 캔버스(toDataURL) 픽셀 비교, 4상태.
import fs from "node:fs";
import { launch, open, settle, pixelDiff, ORIG, NEW, CAP, KEY } from "./_lib.mjs";

const DEFAULT8 = ["김치찌개", "제육볶음", "돈가스", "짜장면", "국밥", "비빔밥", "햄버거", "샐러드"];
const EXTRA4 = ["떡볶이", "초밥", "쌀국수", "칼국수"];
const EXTRA8 = [...EXTRA4, "피자", "냉면", "김밥", "파스타"];
const on = (a, f = () => true) => a.map((name, i) => ({ name, on: f(i) }));
const STATES = [
  ["8개(기본)", "8", on(DEFAULT8)],
  ["12개", "12", on([...DEFAULT8, ...EXTRA4])],
  ["16개", "16", on([...DEFAULT8, ...EXTRA8])],
  ["켜진 메뉴 1개", "on1", on(DEFAULT8, i => i === 0)],
];

fs.mkdirSync(CAP, { recursive: true });
const browser = await launch();

async function grab(url, items) {
  const { ctx, page } = await open(browser, url);
  await page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k + "items", JSON.stringify(v)); }, [KEY, items]);
  await page.reload({ waitUntil: "load" });
  await settle(page, 600);
  const out = await page.evaluate(() => ({ url: document.getElementById("wheel").toDataURL(), n: document.querySelectorAll("#list li").length, notice: document.getElementById("notice").textContent, texts: window.__texts }));
  out.errors = page.errors;
  await ctx.close();
  return out;
}

const results = [];
for (const [label, id, items] of STATES) {
  const o = await grab(ORIG, items), n = await grab(NEW, items);
  const same = o.url === n.url;
  let diff = null;
  if (!same) diff = await pixelDiff(browser, o.url, n.url);
  for (const [tag, x] of [["orig", o], ["new", n]]) fs.writeFileSync(`${CAP}/C-${id}-${tag}.png`, Buffer.from(x.url.split(",")[1], "base64"));
  // 빈 캔버스 오판 방지: 글자가 실제로 그려졌는지(텍스트 호출 수)도 함께 기록
  results.push({ label, id, same, diff, len: [o.url.length, n.url.length], textCalls: [o.texts.length, n.texts.length], notice: [o.notice, n.notice], errors: [o.errors, n.errors] });
  console.log(label, same ? "일치" : "다름 " + JSON.stringify(diff), "글자호출", o.texts.length, n.texts.length, "dataURL길이", o.url.length, n.url.length);
}
await browser.close();
fs.writeFileSync(`${CAP}/C_result.json`, JSON.stringify(results, null, 2));
console.log(results.every(r => r.same) ? "시험 C: 통과 (4/4 일치)" : "시험 C: 실패");
process.exit(results.every(r => r.same) ? 0 : 1);
