// 시험 E: 새 화면이 Pretendard-Medium/Bold.woff2 두 개를 200으로 받고, fonts.check("700 40px Pretendard")가 참인지.
import fs from "node:fs";
import { launch, open, NEW, ORIG, CAP } from "./_lib.mjs";

const browser = await launch();
const rec = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("response", r => { if (/\.woff2(\?|$)/.test(r.url())) rec.push({ url: r.url(), status: r.status(), type: r.headers()["content-type"] }); });
await page.goto(NEW, { waitUntil: "load" });
await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load("700 40px Pretendard"); await document.fonts.load("500 20px Pretendard"); });
await page.waitForTimeout(500);
const info = await page.evaluate(() => ({
  check700: document.fonts.check("700 40px Pretendard"),
  check500: document.fonts.check("500 20px Pretendard"),
  loaded: [...document.fonts].map(f => `${f.weight}:${f.status}`),
}));
await ctx.close();
// 참고: 원본 화면의 같은 값
const o = await open(browser, ORIG, { init: false });
await o.page.evaluate(async () => { await document.fonts.ready; await document.fonts.load("700 40px Pretendard"); });
const orig = await o.page.evaluate(() => ({ check700: document.fonts.check("700 40px Pretendard"), loaded: [...document.fonts].map(f => `${f.weight}:${f.status}`) }));
await o.ctx.close();
await browser.close();

const need = ["Pretendard-Medium.woff2", "Pretendard-Bold.woff2"];
const ok = need.every(n => rec.some(r => r.url.endsWith(n) && r.status === 200)) && info.check700 && info.check500;
const result = { ok, responses: rec, new: info, orig };
fs.writeFileSync(`${CAP}/E_result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log(ok ? "시험 E: 통과" : "시험 E: 실패");
process.exit(ok ? 0 : 1);
