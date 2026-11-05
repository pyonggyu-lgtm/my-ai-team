// 2단계 G-2 눈 확인 (a)(b)(c). 캡처: docs/design/2단계_캡처/G2-*
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServer } from "../../server/index.js";
import { launch, open, settle } from "./_lib.mjs";
const APP = "/workspace/apps/hanjan-roulette", CAP = `${APP}/docs/design/2단계_캡처`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hanjan-g2-"));
const srv = await createServer({ dbPath: path.join(tmp, "g.db"), staticDir: `${APP}/client` });
const port = await srv.listen(0); const BASE = `http://127.0.0.1:${port}/`;
const browser = await launch(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const vp = { width: 390, height: 844 }; let fail = 0;
const ok = (n, c, g) => { console.log(c ? "OK  " : "FAIL", n, c ? "" : JSON.stringify(g)); if (!c) fail++; };
const mk = async (url) => { const { page } = await open(browser, url, { viewport: vp, init: false, solo: false }); await page.goto(url, { waitUntil: "load" }); await settle(page, 400); return page; };
const create = async (p, g, n) => { await p.fill("#createGroupName", g); await p.fill("#createNick", n); await p.click("#createBtn"); await p.waitForSelector("#startScreen", { state: "hidden", timeout: 8000 }); await settle(p, 300);
  await p.click("#groupBtn"); await p.waitForSelector("#groupDialog[open]"); await p.waitForFunction(() => document.querySelector("#inviteCode").textContent.length === 6);
  const c = await p.$eval("#inviteCode", e => e.textContent); await p.click("#groupCloseBtn"); return c; };
try {
  // 그룹 2개 준비
  const A = await mk(BASE); const codeA = await create(A, "첫째 그룹", "에이");
  const X = await mk(BASE); const codeX = await create(X, "둘째 그룹", "엑스");
  // (a) A 창(이미 그룹 있음)에서 다른 그룹 링크
  const toast = p => p.evaluate(() => { const t = document.getElementById("toast"); return { hidden: getComputedStyle(t).display === "none" || !t.textContent, text: t.textContent }; });
  await A.goto(`${BASE}?join=${codeX}`, { waitUntil: "load" }); await settle(A, 900);
  let t = await toast(A);
  ok("a-1 다른 그룹 링크 → 시작 화면 안 뜸", await A.$eval("#startScreen", e => e.hidden), null);
  ok("a-2 '이미 그룹에 들어 있어요' 토스트", !t.hidden && /이미 그룹에 들어 있어요/.test(t.text), t);
  console.log("   토스트:", t.text);
  ok("a-3 주소의 ?join= 지워짐", new URL(A.url()).search === "", A.url());
  ok("a-4 그룹 버튼 이름 그대로(첫째 그룹)", (await A.$eval("#groupBtnName", e => e.textContent)) === "첫째 그룹", null);
  await A.screenshot({ path: `${CAP}/G2-a1-다른그룹링크-토스트.png` });
  await A.goto(`${BASE}?join=${codeA}`, { waitUntil: "load" }); await settle(A, 900);
  t = await toast(A);
  ok("a-5 같은 그룹 링크 → 토스트 없음(조용히)", t.hidden, t);
  ok("a-6 시작 화면 없음·주소 정리", (await A.$eval("#startScreen", e => e.hidden)) && new URL(A.url()).search === "", A.url());
  await A.screenshot({ path: `${CAP}/G2-a2-같은그룹링크-조용히.png` });
  // (b) 코드 붙여넣기
  const C = await mk(BASE); await C.click("#modeJoin");
  for (const [i, v] of [[1, ` ${codeA} `], [2, `${codeA.slice(0, 3)}-${codeA.slice(3)}`], [3, ` ${codeA.slice(0, 3).toLowerCase()} - ${codeA.slice(3).toLowerCase()} `]]) {
    await C.fill("#joinCode", ""); await C.evaluate(() => { document.getElementById("joinPreview").hidden = true; });
    await C.click("#joinCode"); await C.keyboard.insertText(v);
    const shown = await C.waitForFunction(() => !document.getElementById("joinPreview").hidden, null, { timeout: 4000 }).then(() => true, () => false);
    const val = await C.$eval("#joinCode", e => e.value);
    const nm = await C.$eval("#joinGroupName", e => e.textContent);
    ok(`b-${i} '${v}' 붙여넣기 → 미리 보기(${nm}), 칸 값 '${val}'`, shown && nm === "첫째 그룹", { shown, val, nm });
    if (i === 1) await C.screenshot({ path: `${CAP}/G2-b1-공백붙여넣기-미리보기.png` });
    if (i === 2) await C.screenshot({ path: `${CAP}/G2-b2-하이픈붙여넣기-미리보기.png` });
  }
  // (c) 만들기 요청 중 혼자 쓰기 비활성
  const D = await mk(BASE);
  await D.route("**/api/groups", async r => { if (r.request().method() === "POST") { await sleep(2500); } await r.continue(); });
  await D.fill("#createGroupName", "느린 그룹"); await D.fill("#createNick", "디");
  await D.click("#createBtn"); await sleep(600);
  const st = await D.evaluate(() => ({ solo: document.getElementById("soloBtn").disabled, back: document.getElementById("startBackBtn").disabled, create: document.getElementById("createBtn").disabled, label: document.getElementById("createBtn").textContent }));
  ok("c-1 요청 중 혼자 쓰기 비활성", st.solo === true, st); ok("c-2 만들기 버튼 비활성·'잠시만요…'", st.create && /잠시만요/.test(st.label), st);
  await D.screenshot({ path: `${CAP}/G2-c1-만드는중-혼자쓰기비활성.png` });
  await D.waitForSelector("#startScreen", { state: "hidden", timeout: 8000 });
  ok("c-3 끝나면 시작 화면 닫힘", true);
  // 실패 시 되살아나는지
  const E = await mk(BASE);
  await E.route("**/api/groups", async r => { if (r.request().method() === "POST") { await sleep(1200); return r.abort("failed"); } await r.continue(); });
  await E.fill("#createGroupName", "실패 그룹"); await E.fill("#createNick", "이"); await E.click("#createBtn"); await sleep(5000);
  const st2 = await E.evaluate(() => ({ solo: document.getElementById("soloBtn").disabled, create: document.getElementById("createBtn").disabled, msg: document.getElementById("createMsg").textContent }));
  ok("c-4 요청 실패 뒤 혼자 쓰기·만들기 다시 눌림", !st2.solo && !st2.create, st2); console.log("   실패 안내:", st2.msg);
  await E.screenshot({ path: `${CAP}/G2-c2-실패뒤-복구.png` });
} catch (e) { console.log("FAIL 예외", e.message); fail++; }
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}` : "G-2 눈 확인 전부 통과");
