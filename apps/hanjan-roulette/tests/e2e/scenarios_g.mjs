// 2단계 브라우저 2개 시나리오 1~8 (설계 3.3). 설명·기준: 2단계_시나리오.md. 결과: docs/design/2단계_캡처/G_result.json, 캡처 G-*.png
// 실행: LD_LIBRARY_PATH=$(cat /home/claude/chrome-deps/ldpath.txt) FONTCONFIG_FILE=/home/claude/chrome-deps/fonts.conf node tests/e2e/scenarios_g.mjs
// 서버는 이 스크립트가 server/index.js 의 createServer 로 임시 DB(os.tmpdir)·임의 포트에 직접 띄운다(서버 파일은 고치지 않음).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../../server/index.js";
import { launch, open, settle } from "./_lib.mjs";

const APP = "/workspace/apps/hanjan-roulette";
const CAP = `${APP}/docs/design/2단계_캡처`;
fs.mkdirSync(CAP, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hanjan-e2e-"));
const srv = await createServer({ dbPath: path.join(tmp, "g.db"), staticDir: `${APP}/client` });
const port = await srv.listen(0);
const BASE = `http://127.0.0.1:${port}/`;

const browser = await launch();
const R = [];
const rec = (sc, item, ok, got) => { R.push({ sc, item, ok: !!ok, got }); console.log(ok ? "OK  " : "FAIL", sc, item, ok ? "" : JSON.stringify(got)); };
const eq = (sc, item, got, want) => rec(sc, item, JSON.stringify(got) === JSON.stringify(want), got);
const problems = [];   // 콘솔 오류·페이지 오류·실패한 요청(예상된 것 제외)
const expected = [];
const conflicts = [];  // 확정 409(설계된 충돌 응답): 시나리오 6의 B, 시나리오 7의 B·A   // 오프라인 구간의 실패 요청(참고용)
const sleep = ms => new Promise(r => setTimeout(r, ms));

const W = { A: null, B: null };
const state = { offline: false };
async function openWin(name, url) {
  const { ctx, page } = await open(browser, url, { viewport: { width: 390, height: 844 }, init: false, solo: false });
  page.nm = name; page.errors = [];
  const resp = new Map();
  page.on("response", r => { resp.set(r.request(), r.status()); if (r.status() === 409 && r.request().method() === "POST" && /\/api\/boards\/[^/]+\/history$/.test(new URL(r.url()).pathname)) { conflicts.push(name); return; }   // 설계된 409(덮어쓰기 확인)
    if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) problems.push(`${name} 응답 ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.replace(/\/api\/invites\/[^/]+/, "/api/invites/***")}`); });
  page.on("requestfailed", async r => {
    const err = r.failure()?.errorText ?? "";
    const line = `${name} requestfailed ${r.method()} ${new URL(r.url()).pathname.replace(/\/api\/invites\/[^/]+/, "/api/invites/***")} ${err}`;
    if (state.offline && name === "A") { expected.push(line); return; }
    if (err.includes("ERR_ABORTED")) { const st = resp.get(r) ?? (await r.response().catch(() => null))?.status(); if (st === 204) return; }   // 204 응답을 받은 요청의 ERR_ABORTED 만 제외(알려진 Chromium 동작)
    problems.push(line);
  });
  page.on("pageerror", e => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`${name} console.error: ${m.text()}`); });
  // B 창에 결과 카드가 뜨면 기록(결과 카드는 확정한 본인에게만)
  await ctx.addInitScript(() => { window.__sawOverlay = false; new MutationObserver(() => { const o = document.getElementById("overlay"); if (o && o.classList.contains("show")) window.__sawOverlay = true; }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] }); });
  await page.goto(url, { waitUntil: "load" }); await settle(page, 400);
  W[name] = { ctx, page };
  return page;
}
const shot = async (p, n) => { await sleep(600); return p.screenshot({ path: `${CAP}/G-${n}.png` }); };
const names = p => p.$$eval("#list li", l => l.map(li => li.querySelector(".name").textContent));
const tagOf = (p, name) => p.$$eval("#list li", (l, n) => { const li = l.find(x => x.querySelector(".name").textContent === n); return li ? li.querySelector(".tag").textContent : null; }, name);
const checked = (p, name) => p.$$eval("#list li", (l, n) => { const li = l.find(x => x.querySelector(".name").textContent === n); return li ? li.querySelector("input").checked : null; }, name);
const today = p => p.$eval("#today", e => e.textContent);
const within = async (p, fn, arg, ms = 3000) => { try { await p.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const spinToResult = async p => { await p.click("#spin"); await p.waitForSelector("#overlay.show", { timeout: 15000 }); return p.$eval("#resultName", e => e.textContent); };
const overwriteText = p => p.$eval("#overwriteMsg", e => e.textContent.replace(/\s+/g, " ").trim());
const deviceOf = p => p.evaluate(() => JSON.parse(localStorage.getItem("hanjan.v1.device") || "{}"));

try {
  // ===================== 시나리오 1: 그룹 만들기 → 초대 링크로 참여 → 멤버 목록 =====================
  const A = await openWin("A", BASE);
  eq(1, "A: 처음 열면 시작 화면이 보임", await A.$eval("#startScreen", e => !e.hidden), true);
  await shot(A, "01-시작화면-A");
  await A.fill("#createGroupName", "우리 팀 점심"); await A.fill("#createNick", "에이");
  await A.click("#createBtn");
  await A.waitForSelector("#startScreen", { state: "hidden", timeout: 8000 });
  await settle(A, 300);
  eq(1, "A: 그룹 만든 뒤 시작 화면이 닫히고 메뉴판 '점심'", await A.$$eval("#boardTabs .tab", t => t.map(x => x.textContent)), ["점심"]);
  eq(1, "A: 그룹 버튼 글씨·그룹 이름", [await A.$eval("#groupBtn .gb-label", e => e.textContent), await A.$eval("#groupBtnName", e => e.textContent)], ["그룹 설정", "우리 팀 점심"]);
  await A.click("#groupBtn"); await A.waitForSelector("#groupDialog[open]");
  await A.waitForFunction(() => document.querySelector("#inviteCode").textContent.length === 6);
  const code = await A.$eval("#inviteCode", e => e.textContent);
  const link = await A.$eval("#inviteLink", e => e.value);
  eq(1, "A: 초대 코드 6자리(헷갈리는 글자 없음)", /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code), true);
  eq(1, "A: 초대 링크 = 주소 + /?join= + 코드", link, `${new URL(BASE).origin}/?join=${code}`);
  eq(1, "A: 멤버 목록 처음에는 본인 1명(만든 사람·나)", await A.$$eval("#memberList li", l => l.map(li => [...li.children].map(c => c.textContent).join(" "))), ["에이 만든 사람 나"]);
  await shot(A, "02-그룹설정-A");

  const B = await openWin("B", link);   // 초대 링크로 연다
  eq(1, "B: 초대 링크로 열면 참여 쪽 + 코드가 채워짐", [await B.$eval("#joinForm", e => !e.hidden), await B.$eval("#joinCode", e => e.value)], [true, code]);
  await B.waitForFunction(() => !document.getElementById("joinPreview").hidden, null, { timeout: 5000 });
  eq(1, "B: 미리 보기에 그룹 이름·인원", [await B.$eval("#joinGroupName", e => e.textContent), await B.$eval("#joinGroupCount", e => e.textContent)], ["우리 팀 점심", "지금 1명이 함께 있어요"]);
  await shot(B, "03-참여화면-B");
  await B.fill("#joinNick", "비"); await B.click("#joinBtn");
  await B.waitForSelector("#startScreen", { state: "hidden", timeout: 8000 }); await settle(B, 300);
  eq(1, "B: 주소의 ?join= 이 지워짐", new URL(B.url()).search, "");
  const aList = await within(A, () => document.querySelectorAll("#memberList li").length === 2, null, 4000);
  eq(1, "A: 열려 있던 그룹 창 멤버 목록에 B가 4초 안에 나타남", aList, true);
  eq(1, "A: 멤버 목록", await A.$$eval("#memberList li", l => l.map(li => [...li.children].map(c => c.textContent).join(" "))), ["에이 만든 사람 나", "비"]);
  await B.click("#groupBtn"); await B.waitForSelector("#groupDialog[open]");
  await B.waitForFunction(() => document.querySelectorAll("#memberList li").length === 2);
  eq(1, "B: 멤버 목록", await B.$$eval("#memberList li", l => l.map(li => [...li.children].map(c => c.textContent).join(" "))), ["에이 만든 사람", "비 나"]);
  await shot(B, "04-멤버목록-B");
  await B.click("#groupCloseBtn"); await A.click("#groupCloseBtn");
  eq(1, "토큰 원문이 화면 어디에도 없음(두 창 본문 검사)", await Promise.all([A, B].map(async p => { const t = (await deviceOf(p)).token; return t ? !(await p.content()).includes(t) : false; })), [true, true]);

  // ===================== 시나리오 2: A가 메뉴 추가·끄기 → B 3초 안에 =====================
  await A.fill("#addInput", "라면집"); await A.press("#addInput", "Enter");
  eq(2, "B: A가 추가한 메뉴가 3초 안에 보임", await within(B, () => [...document.querySelectorAll("#list .name")].some(e => e.textContent === "라면집")), true);
  const first = (await names(A))[0];
  await A.$eval("#list li input", e => e.click());   // 맨 위 메뉴 끄기
  eq(2, "B: A가 끈 메뉴가 3초 안에 꺼짐", await within(B, n => { const li = [...document.querySelectorAll("#list li")].find(l => l.querySelector(".name").textContent === n); return li && !li.querySelector("input").checked; }, first), true);
  eq(2, "메뉴 개수 표시가 두 창 같음", [await A.$eval("#count", e => e.textContent), await B.$eval("#count", e => e.textContent)].filter((x, i, a) => x === a[0]).length, 2);
  await shot(B, "05-메뉴반영-B");

  // ===================== 시나리오 3: A가 돌리는 중 B가 메뉴 추가 → A 회전은 그대로, 끝난 뒤 반영 =====================
  await A.click("#spin");
  await A.waitForFunction(() => document.body.classList.contains("busy"), null, { timeout: 3000 });
  await B.fill("#addInput", "나중메뉴"); await B.press("#addInput", "Enter");
  await B.waitForFunction(() => [...document.querySelectorAll("#list .name")].some(e => e.textContent === "나중메뉴"), null, { timeout: 3000 });
  await sleep(1500);
  const duringBusy = await A.evaluate(() => document.body.classList.contains("busy"));
  eq(3, "A: 회전 중에 B의 추가가 목록에 아직 안 보임(회전 그대로)", [duringBusy, (await names(A)).includes("나중메뉴")], [true, false]);
  await shot(A, "06-회전중-A");
  await A.waitForSelector("#overlay.show", { timeout: 15000 });
  const N1 = await A.$eval("#resultName", e => e.textContent);
  eq(3, "A: 회전이 끝나면 결과 카드가 뜸(메뉴 이름 있음)", N1.length > 0, true);
  eq(3, "A: 회전이 끝난 뒤 목록에 '나중메뉴' 반영(3초 안)", await within(A, () => [...document.querySelectorAll("#list .name")].some(e => e.textContent === "나중메뉴")), true);
  await shot(A, "07-결과카드-A");

  // ===================== 시나리오 4: A가 다시 돌리기 → B에 '오늘 넘김' 태그 =====================
  await A.click("#againBtn");
  eq(4, "B: 넘긴 메뉴에 '오늘 넘김' 태그(3초 안)", await within(B, n => { const li = [...document.querySelectorAll("#list li")].find(l => l.querySelector(".name").textContent === n); return li && li.querySelector(".tag").textContent === "오늘 넘김"; }, N1), true);
  await shot(B, "08-넘김태그-B");
  await A.waitForSelector("#overlay.show", { timeout: 15000 });
  const N2 = await A.$eval("#resultName", e => e.textContent);
  eq(4, "A: 다시 돌린 결과는 넘긴 메뉴가 아님", N2 !== N1, true);

  // ===================== 시나리오 5: A가 확정 → B 상단 배지 3초 안에, 결과 카드는 A에게만 =====================
  await B.evaluate(() => { window.__sawOverlay = false; });
  await A.click("#okBtn");
  await A.waitForSelector("#overlay.show", { state: "hidden", timeout: 5000 });
  const badge = `오늘 점심 확정: ${N2}`;
  eq(5, "B: 상단 배지가 3초 안에 같은 메뉴", await within(B, b => document.getElementById("today").textContent === b, badge), true);
  eq(5, "A: 상단 배지도 같음", await today(A), badge);
  eq(5, "B: 결과 카드는 뜨지 않음(확정한 본인에게만)", await B.evaluate(() => window.__sawOverlay), false);
  eq(5, "B: 알림 '에이님이 …확정했어요'", await within(B, () => !document.getElementById("peerToast").hidden && /^에이님이 .+ 확정했어요$/.test(document.getElementById("peerToastText").textContent)), true);
  eq(5, "B: 알림 문구에 확정 메뉴", (await B.$eval("#peerToastText", e => e.textContent)).includes(N2), true);
  eq(5, "A: 본인 확정에는 알림이 안 뜸", await A.$eval("#peerToast", e => e.hidden), true);
  await shot(B, "09-확정배지·알림-B");
  await B.click("#peerToastClose");

  // ===================== 시나리오 6: B가 같은 메뉴판을 확정 시도 → 덮어쓰기 확인창 =====================
  await spinToResult(B);
  await shot(B, "10-결과카드-B");
  await B.click("#okBtn");
  await B.waitForSelector("#overwriteDialog[open]", { timeout: 5000 });
  const ow = await overwriteText(B);
  rec(6, "B: 확인창 문구 '에이님이 {메뉴}로 확정했어요. 바꿀까요?'", /^에이님이 .+(으로|로) 확정했어요\. 바꿀까요\?$/.test(ow) && ow.includes(N2), ow);
  eq(6, "B: 버튼 '그대로 두기'(처음 포커스)·'바꾸기'", [await B.$eval("#overwriteNoBtn", e => e.textContent), await B.$eval("#overwriteYesBtn", e => e.textContent), await B.evaluate(() => document.activeElement.id)], ["그대로 두기", "바꾸기", "overwriteNoBtn"]);
  await shot(B, "11-덮어쓰기확인-B");
  await B.click("#overwriteNoBtn");
  await B.waitForSelector("#overwriteDialog[open]", { state: "detached", timeout: 3000 }).catch(() => {});
  eq(6, "B: 그대로 두기 → 창 닫힘·기록은 A의 확정 그대로", [await B.$eval("#overwriteDialog", e => e.open), await today(B)], [false, badge]);

  // ===================== 시나리오 7: A 오프라인에서 확정 + 그동안 B 확정 → A 재연결 → 덮어쓰기 확인창 =====================
  state.offline = true;
  await W.A.ctx.setOffline(true);
  const wentOffline = await within(A, () => !document.getElementById("connBar").hidden && document.body.classList.contains("is-offline"), null, 60000);
  eq(7, "A: 오프라인이 되면 연결 끊김 띠(is-offline)가 뜸", wentOffline, true);
  if (wentOffline) {
    eq(7, "A: 띠 문구", await A.$eval("#connBar", e => e.textContent.replace(/\s+/g, " ").trim()), "연결이 끊겼어요. 다시 연결하는 중… 돌리기·확정은 그대로 할 수 있어요");
    await shot(A, "12-연결끊김띠-A");
  }
  await A.fill("#addInput", "오프라인추가"); await A.press("#addInput", "Enter");
  eq(7, "A: 오프라인에서 메뉴 추가는 막힘('연결되면 바꿀 수 있어요.')", [await A.$eval("#addMsg", e => e.textContent), (await names(A)).includes("오프라인추가")], ["연결되면 바꿀 수 있어요.", false]);
  const N4 = await spinToResult(A);
  await A.click("#okBtn");
  await A.waitForSelector("#overlay.show", { state: "hidden", timeout: 5000 });
  await sleep(300);
  eq(7, "A: 오프라인 확정 → '연결되면 확정을 보낼게요' 알림", /연결되면 확정을 보낼게요/.test(await A.$eval("#toast", e => e.textContent)), true);
  eq(7, "A: 대기열(outbox)에 확정 1건", await A.evaluate(() => { try { const o = JSON.parse(localStorage.getItem("hanjan.v1.outbox")); return Array.isArray(o) ? o.length : (o && o.items ? o.items.length : -1); } catch { return -2; } }), 1);
  await shot(A, "13-오프라인확정-A");
  // 그동안 B가 다른 메뉴로 확정(덮어쓰기)
  let N3 = null;
  for (let t = 0; t < 6; t++) {
    N3 = await spinToResult(B);
    if (N3 !== N2 && N3 !== N4) break;
    await B.click("#againBtn"); await B.waitForSelector("#overlay.show", { timeout: 15000 }); N3 = await B.$eval("#resultName", e => e.textContent);
    if (N3 !== N2 && N3 !== N4) break;
  }
  await B.click("#okBtn");
  await B.waitForSelector("#overwriteDialog[open]", { timeout: 5000 });
  await B.click("#overwriteYesBtn");
  eq(7, "B: 바꾸기 → B의 배지가 새 메뉴", await within(B, b => document.getElementById("today").textContent === b, `오늘 점심 확정: ${N3}`), true);
  // A 다시 연결
  state.offline = false;
  await W.A.ctx.setOffline(false);
  const conflict = await within(A, () => document.getElementById("overwriteDialog").open, null, 40000);
  eq(7, "A: 다시 연결되면 덮어쓰기 확인창이 뜸", conflict, true);
  if (conflict) {
    const t = await overwriteText(A);
    rec(7, "A: 확인창 문구에 B의 닉네임과 B가 확정한 메뉴", /^비님이 .+(으로|로) 확정했어요\. 바꿀까요\?$/.test(t) && t.includes(N3), t);
    eq(7, "A: '내가 고른 메뉴'에 오프라인에서 고른 메뉴", await A.$eval("#overwriteMine", e => e.textContent), N4);
    await shot(A, "14-재연결확인창-A");
    await A.click("#overwriteYesBtn");
    eq(7, "바꾸기 → 두 창 배지가 A가 고른 메뉴로(3초 안)", [await within(A, b => document.getElementById("today").textContent === b, `오늘 점심 확정: ${N4}`), await within(B, b => document.getElementById("today").textContent === b, `오늘 점심 확정: ${N4}`)], [true, true]);
  }
  eq(7, "A: 연결 띠가 사라짐", await within(A, () => document.getElementById("connBar").hidden && !document.body.classList.contains("is-offline"), null, 8000), true);

  // ===================== 시나리오 8: 두 창의 기록 화면과 GET /history 응답이 완전히 같음 =====================
  for (const p of [A, B]) { await p.click("#historyBtn"); await p.waitForSelector("#historyDialog[open]"); await p.waitForTimeout(600); }
  const uiRows = p => p.$$eval("#historyList li", l => l.map(li => ({ date: li.querySelector(".h-date").getAttribute("datetime") || li.querySelector(".h-date").textContent, text: li.querySelector(".h-date").textContent, menu: li.querySelector(".h-menu").textContent, who: li.querySelector(".h-who").textContent })));
  const uiBars = p => p.$$eval("#statsList li", l => l.map(li => [li.querySelector(".bar-name").textContent, li.querySelector(".bar-count").textContent]));
  const ra = await uiRows(A), rb = await uiRows(B);
  eq(8, "기록 화면: 날짜·메뉴가 두 창 같음", [ra.map(r => [r.text, r.menu]), uiBars(A) && await uiBars(A)], [rb.map(r => [r.text, r.menu]), await uiBars(B)]);
  eq(8, "기록 화면: 확정한 사람 칸 — A 창과 B 창이 같은 사람을 가리킴('나'는 각 창 본인)", [ra.map(r => r.who === "나" ? "에이" : r.who), rb.map(r => r.who === "나" ? "비" : r.who)].map(x => JSON.stringify(x)).reduce((a, b) => a === b ? "same" : a + "!=" + b), "same");
  await shot(A, "15-기록-A"); await shot(B, "16-기록-B");
  const api = (p, route) => p.evaluate(async r => {
    const d = JSON.parse(localStorage.getItem("hanjan.v1.device") || "{}");
    const st = await (await fetch(`/api/groups/${d.groupId}/state`, { headers: { Authorization: "Bearer " + d.token } })).json();
    const bid = st.boards[0].id;
    const h = await (await fetch(`/api/boards/${bid}/history?days=90`, { headers: { Authorization: "Bearer " + d.token } })).json();
    const s = await (await fetch(`/api/boards/${bid}/stats?range=all`, { headers: { Authorization: "Bearer " + d.token } })).json();
    return { h, s };
  }, route);
  const apiA = await api(A), apiB = await api(B);
  eq(8, "GET /history·/stats 응답이 두 창(두 토큰)에서 완전히 같음", JSON.stringify(apiA) === JSON.stringify(apiB), true);
  const apiEntries = apiA.h.entries ?? apiA.h;
  eq(8, "API 기록의 오늘 확정 = A가 마지막에 고른 메뉴(확정한 사람 에이)", [apiEntries[0]?.name ?? apiEntries[0]?.[1], apiEntries[0]?.nickname], [N4, "에이"]);
  eq(8, "화면 첫 줄 = API 첫 줄(메뉴)", [ra[0]?.menu, rb[0]?.menu], [apiEntries[0]?.name, apiEntries[0]?.name]);
  eq(8, "그날 기록은 1건뿐(덮어쓰기 흔적 없음)", apiEntries.filter(e => e.date === apiEntries[0].date).length, 1);
  fs.writeFileSync(`${CAP}/G_api.json`, JSON.stringify({ note: "토큰·id 없음. 시나리오 8의 GET /history·/stats 응답(A 토큰)", history: apiA.h, stats: apiA.s }, null, 2));

  // ===================== 공통: 콘솔·페이지 오류, 실패한 요청 =====================
  eq("공통", "설계된 확정 409 응답: B 2번(6·7번) + A 1번(7번)", [conflicts.filter(x => x === "B").length, conflicts.filter(x => x === "A").length], [2, 1]);
  eq("공통", "콘솔 오류·페이지 오류·실패한 요청·4xx/5xx 응답 없음(오프라인 구간·204 ERR_ABORTED·favicon 404 제외)", problems, []);
  console.log("참고: 오프라인 구간의 실패 요청", expected.length, "건:", [...new Set(expected)].slice(0, 6));
} catch (e) {
  rec("실행", "스크립트 예외 — 시나리오가 끝까지 못 감", false, String(e && e.stack || e).split("\n").slice(0, 4).join(" | "));
  for (const k of ["A", "B"]) if (W[k]) await W[k].page.screenshot({ path: `${CAP}/G-실패-${k}.png` }).catch(() => {});
} finally {
  fs.writeFileSync(`${CAP}/G_result.json`, JSON.stringify({ ok: R.filter(r => r.ok).length, total: R.length, problems, expectedOffline: [...new Set(expected)], items: R }, null, 2));
  for (const k of ["A", "B"]) if (W[k]) await W[k].ctx.close().catch(() => {});
  await browser.close();
  await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`시나리오 1~8: ${R.filter(r => r.ok).length}/${R.length} 통과`);
  process.exit(R.every(r => r.ok) ? 0 : 1);
}
