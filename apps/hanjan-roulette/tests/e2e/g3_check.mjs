// 2단계 G-3 눈 확인: 정원 30명 미리보기·무효 토큰 폰 + ?join 링크. 캡처 docs/design/2단계_캡처/G3-*
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServer } from "../../server/index.js";
import { launch, open, settle } from "./_lib.mjs";
const APP = "/workspace/apps/hanjan-roulette", CAP = `${APP}/docs/design/2단계_캡처`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hanjan-g3-"));
const big = { max: 1000, windowMs: 3600000, globalMax: Infinity };
const srv = await createServer({ dbPath: path.join(tmp, "g.db"), staticDir: `${APP}/client`, rateLimit: big, createLimit: big, joinLimit: big });
const port = await srv.listen(0); const BASE = `http://127.0.0.1:${port}/`;
const browser = await launch(); let fail = 0;
const ok = (n, c, g) => { console.log(c ? "OK  " : "FAIL", n, c ? "" : JSON.stringify(g)); if (!c) fail++; };
const vp = { width: 390, height: 844 };
const mk = async (url, init) => { const { ctx, page } = await open(browser, url, { viewport: vp, init: false, solo: false }); if (init) await ctx.addInitScript(d => { localStorage.setItem("hanjan.v1.device", d); }, init); await page.goto(url, { waitUntil: "load" }); await settle(page, 600); return page; };
const post = (p, b, h = {}) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) }).then(async r => ({ s: r.status, j: await r.json() }));
try {
  // 정원 30명 그룹
  const g = await post("api/groups", { name: "꽉 찬 그룹", nickname: "방장" }); const code = g.j.group.inviteCode;
  let n = 1; for (let i = 2; i <= 30; i++) { const r = await post(`api/invites/${code}/join`, { nickname: "멤" + i }); if (r.s === 201 || r.s === 200) n++; }
  ok("준비 멤버 30명", n === 30, n);
  const F = await mk(BASE); await F.click("#modeJoin"); await F.fill("#joinCode", code);
  await F.waitForFunction(() => !document.getElementById("joinPreview").hidden, null, { timeout: 5000 }); await F.waitForTimeout(300);
  const s = await F.evaluate(() => ({ cnt: document.getElementById("joinGroupCount").textContent, msg: document.getElementById("joinMsg").textContent, dis: document.getElementById("joinBtn").disabled }));
  ok("30명: 안내 '이 그룹은 30명이 다 찼어요.'", s.msg === "이 그룹은 30명이 다 찼어요.", s);
  ok("30명: 참여 버튼 비활성", s.dis === true, s); console.log("   ", s.cnt);
  await F.fill("#joinNick", "새내기"); await F.click("#joinBtn", { force: true, timeout: 1500 }).catch(() => {}); await F.waitForTimeout(500);
  ok("30명: 눌러도 시작 화면 그대로", await F.$eval("#startScreen", e => !e.hidden), null);
  await F.screenshot({ path: `${CAP}/G3-a-정원30명.png` });
  // 코드를 지웠다가 다른 코드로: 버튼 복구
  await F.fill("#joinCode", ""); await F.waitForTimeout(300);
  ok("코드 지우면 참여 버튼 다시 눌림·안내 사라짐", await F.evaluate(() => !document.getElementById("joinBtn").disabled && !document.getElementById("joinMsg").textContent), null);
  // 무효 토큰 폰
  const g2 = await post("api/groups", { name: "열린 그룹", nickname: "에이" }); const code2 = g2.j.group.inviteCode;
  const A = await mk(BASE); await A.fill("#createGroupName", "내 그룹"); await A.fill("#createNick", "폰주인"); await A.click("#createBtn");
  await A.waitForSelector("#startScreen", { state: "hidden" }); await settle(A, 300);
  const dev = await A.evaluate(() => localStorage.getItem("hanjan.v1.device")); const d = JSON.parse(dev); d.token = "x".repeat(d.token.length);
  const P = await mk(`${BASE}?join=${code2}`, JSON.stringify(d)); await P.waitForTimeout(800);
  const st = await P.evaluate(() => ({ start: !document.getElementById("startScreen").hidden, joinShown: !document.getElementById("joinForm").hidden, code: document.getElementById("joinCode").value, join: document.getElementById("modeJoin").getAttribute("aria-pressed"), notice: document.querySelector("#startScreen .start-notice, #startNotice, #startScreen [role=status]")?.textContent ?? "", url: location.search }));
  ok("무효 토큰+?join: 시작 화면이 참여 탭", st.start && st.joinShown && st.join === "true", st);
  ok("무효 토큰+?join: 코드 채워짐", st.code === code2, st);
  await P.waitForFunction(() => !document.getElementById("joinPreview").hidden, null, { timeout: 5000 }).then(() => ok("미리 보기 뜸", true), () => ok("미리 보기 뜸", false));
  console.log("    안내:", st.notice, "/ 주소:", st.url);
  await P.screenshot({ path: `${CAP}/G3-b-무효토큰-링크.png` });
  // 404 주소 찾기
  const N = await open(browser, BASE, { viewport: vp, init: false, solo: false }); const bad = [];
  N.page.on("response", r => { if (r.status() >= 400) bad.push(r.status() + " " + r.url()); }); await N.page.goto(BASE, { waitUntil: "load" }); await settle(N.page, 800);
  console.log("    404 응답(새 화면 첫 로드):", bad);
} catch (e) { console.log("FAIL 예외", e.message); fail++; }
await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}` : "G-3 눈 확인 전부 통과");
