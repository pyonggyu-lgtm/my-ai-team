// 3단계 시험 ①~③ + favicon (진오). 서비스 워커·manifest·아이콘·오프라인.
// 실행: LD_LIBRARY_PATH=$(cat /home/claude/chrome-deps/ldpath.txt) FONTCONFIG_FILE=/home/claude/chrome-deps/fonts.conf node tests/e2e/3단계_시험.mjs
// 서버는 임시 DB·임의 포트로 띄우고, client/ 를 임시 폴더에 복사해서 준다(시험 ③에서 복사본의 sw.js 만 바꾼다. 원본은 건드리지 않음).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../../server/index.js";
import { launch, settle } from "./_lib.mjs";

const APP = "/workspace/apps/hanjan-roulette";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hanjan-3-"));
const clientCopy = path.join(tmp, "client");
fs.cpSync(`${APP}/client`, clientCopy, { recursive: true });

const srv = await createServer({ dbPath: path.join(tmp, "t.db"), staticDir: clientCopy });
const port = await srv.listen(0);
const BASE = `http://127.0.0.1:${port}/`;
const browser = await launch();

let pass = 0, fail = 0;
const rec = (name, ok, got) => { ok ? pass++ : fail++; console.log(ok ? "OK  " : "FAIL", name, ok ? "" : JSON.stringify(got)); };
const eq = (name, got, want) => rec(name, JSON.stringify(got) === JSON.stringify(want), got);
const within = async (p, fn, arg, ms = 8000) => { try { await p.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

// PNG 헤더에서 실제 가로·세로
const pngSize = f => { const b = fs.readFileSync(f); return b.toString("latin1", 1, 4) === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Seoul" });
  const page = await ctx.newPage();
  const bad = [];   // 400 이상 응답
  const errors = [];
  page.on("response", r => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on("pageerror", e => errors.push(e.message));

  // ───── favicon: 처음 열 때 404 없음 ─────
  await page.goto(BASE, { waitUntil: "load" }); await settle(page, 400);
  eq("favicon: 처음 열 때 4xx 응답 없음", bad, []);
  eq("favicon: <link rel=icon> 가 아이콘 PNG", await page.$eval('link[rel="icon"]', e => e.getAttribute("href")), "icons/icon-192.png");

  // ───── ① manifest · 아이콘 · 서비스 워커 ─────
  const mf = await page.evaluate(async () => (await fetch("manifest.json")).json());
  eq("① manifest name/short_name", [mf.name, mf.short_name], ["한잔메뉴룰렛", "한잔룰렛"]);
  eq("① manifest 색·표시", [mf.theme_color, mf.background_color, mf.display], ["#1B2A44", "#1B2A44", "standalone"]);
  eq("① manifest start_url/scope/id/lang", [mf.start_url, mf.scope, mf.id, mf.lang], ["./", "./", "./", "ko"]);
  eq("① manifest 아이콘 4개(sizes·purpose)", (mf.icons || []).map(i => [i.src, i.sizes, i.type, i.purpose]), [
    ["icons/icon-192.png", "192x192", "image/png", "any"],
    ["icons/icon-512.png", "512x512", "image/png", "any"],
    ["icons/icon-maskable-192.png", "192x192", "image/png", "maskable"],
    ["icons/icon-maskable-512.png", "512x512", "image/png", "maskable"],
  ]);
  for (const i of mf.icons || []) {
    const [w, h] = i.sizes.split("x").map(Number);
    eq(`① ${i.src} 실제 크기`, pngSize(path.join(APP, "client", i.src)), [w, h]);
  }
  eq("① index.html 헤드(manifest·theme-color·apple-touch-icon·앱 이름)", await page.evaluate(() => [
    document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
    document.querySelector('meta[name="theme-color"]')?.content,
    document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
  ]), ["manifest.json", "#1B2A44", "icons/icon-maskable-192.png", "한잔룰렛"]);

  // 서비스 워커 준비 → 새로고침 후 controller
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "load" }); await settle(page, 300);
  eq("① 새로고침 후 navigator.serviceWorker.controller 있음", await page.evaluate(() => !!navigator.serviceWorker.controller), true);
  eq("① 캐시 이름", await page.evaluate(() => caches.keys()), ["hanjan-v1"]);
  const cachedN = await page.evaluate(async () => (await (await caches.open("hanjan-v1")).keys()).length);
  const swList = fs.readFileSync(`${APP}/client/sw.js`, "utf8").match(/APP_FILES = \[([\s\S]*?)\];/)[1].match(/"[^"]+"/g).length;
  eq("① 미리 저장한 파일 수 = 목록 수", cachedN, swList);
  // 목록에 빠진 앱 파일이 없는지(client/ 아래 LICENSE·sw.js 제외 전부)
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)).map(x => `${e.name}/${x}`) : [e.name]);
  const onDisk = walk(`${APP}/client`).filter(f => f !== "sw.js" && !/LICENSE/.test(f));
  const cachedUrls = await page.evaluate(async () => (await (await caches.open("hanjan-v1")).keys()).map(r => new URL(r.url).pathname));
  eq("① client/ 파일 중 캐시에 없는 것", onDisk.filter(f => !cachedUrls.includes("/" + f)), []);

  // ───── 그룹 만들기(온라인) ─────
  await page.fill("#createGroupName", "시험 그룹"); await page.fill("#createNick", "에이");
  await page.click("#createBtn");
  await page.waitForSelector("#startScreen", { state: "hidden", timeout: 8000 }); await settle(page, 300);
  eq("그룹 만들기 성공(그룹 버튼 이름)", await page.$eval("#groupBtnName", e => e.textContent), "시험 그룹");

  // ───── ② 오프라인 ─────
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" }); await settle(page, 500);
  eq("② 오프라인 새로고침 → 화면 열림(제목·룰렛·돌리기)", await page.evaluate(() => [document.title, !!document.getElementById("wheel"), !!document.getElementById("spin")]), ["한잔메뉴룰렛", true, true]);
  eq("② 오프라인 글꼴 로드", await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("700 20px Pretendard"); }), true);
  await page.click("#spin");
  const shown = await within(page, () => document.getElementById("overlay")?.classList.contains("show"), null, 15000);
  eq("② 오프라인 돌리기 → 결과 카드", shown, true);
  if (shown) {
    await page.click("#okBtn"); await settle(page, 500);
    const box = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("hanjan.v1.outbox") || "[]"); } catch { return null; } });
    eq("② 오프라인 확정 → outbox 에 confirm 1건", Array.isArray(box) ? box.map(i => i.type) : box, ["confirm"]);
  } else {
    rec("② 오프라인 확정 → outbox", false, "결과 카드가 안 떠서 확정 못 함");
  }
  // ?join= 주소도 오프라인으로 열림
  const page2 = await ctx.newPage();
  const resp = await page2.goto(`${BASE}?join=ABC234`, { waitUntil: "load" }).catch(e => ({ err: e.message }));
  eq("② ?join= 주소 오프라인으로 열림", [resp?.err ?? null, await page2.title(), await page2.evaluate(() => !!document.getElementById("wheel"))], [null, "한잔메뉴룰렛", true]);
  eq("② ?join= 이 서비스 워커(저장본)로 응답", resp?.fromServiceWorker?.() ?? null, true);
  await page2.close();
  await ctx.setOffline(false);

  // ───── ③ 버전 바꾸기: 새 이름만 남음 ─────
  const swFile = path.join(clientCopy, "sw.js");
  fs.writeFileSync(swFile, fs.readFileSync(swFile, "utf8").replace('const CACHE = "hanjan-v1";', 'const CACHE = "hanjan-v2";'));
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  let swapped = false;   // 설치·활성화가 끝날 때까지 최대 10초 확인
  for (let i = 0; i < 50 && !swapped; i++) {
    swapped = await page.evaluate(async () => (await caches.keys()).join() === "hanjan-v2");
    if (!swapped) await page.waitForTimeout(200);
  }
  eq("③ sw.js 이름 바꾼 뒤 caches.keys() 에 새 이름만", await page.evaluate(() => caches.keys()), ["hanjan-v2"]);
  rec("③ (대기 없이 바로 교체)", swapped, null);
  await page.reload({ waitUntil: "load" }); await settle(page, 300);
  eq("③ 새로고침 후에도 새 이름만 + controller 유지", await page.evaluate(async () => [await caches.keys(), !!navigator.serviceWorker.controller]), [["hanjan-v2"], true]);
  eq("④ API 는 서비스 워커를 안 거침(같은 출처 /api 요청이 서버에 도달)", await page.evaluate(async () => (await fetch("/api/없는경로")).status), 404);

  eq("페이지 오류(pageerror) 없음", errors, []);
} catch (e) {
  rec("시험 중 예외", false, String(e?.stack || e));
} finally {
  await browser.close();
  await srv.close();
  console.log(`\n결과: ${pass} OK / ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
}
