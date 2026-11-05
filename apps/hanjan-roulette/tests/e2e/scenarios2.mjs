// 1단계 브라우저 시나리오 5(기록 화면)와 8(메뉴판 설정 버튼). 시나리오 7(23항목)은 checklist.mjs. 설명: 1단계_시나리오.md
// 결과: docs/design/1단계_캡처/S2_result.json
import fs from "node:fs";
import { launch, open, settle, NEW } from "./_lib.mjs";

const CAP = "/workspace/apps/hanjan-roulette/docs/design/1단계_캡처";
const P = "hanjan.v1.";
fs.mkdirSync(CAP, { recursive: true });
const browser = await launch();
const R = [];
const rec = (sc, item, ok, got) => { R.push({ sc, item, ok: !!ok, got }); console.log(ok ? "OK  " : "FAIL", sc, item, ok ? "" : JSON.stringify(got)); };
const eq = (sc, item, got, want) => rec(sc, item, JSON.stringify(got) === JSON.stringify(want), got);
const errors = [];

const kst = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TODAY = kst(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const fmt = s => { const [y, m, d] = s.split("-").map(Number); return (s.slice(0, 4) === TODAY.slice(0, 4) ? "" : y + "년 ") + m + "월 " + d + "일 (" + WEEK[new Date(s + "T00:00:00Z").getUTCDay()] + ")"; };
const LUNCH8 = ["김치찌개", "제육볶음", "돈가스", "짜장면", "국밥", "비빔밥", "햄버거", "샐러드"];
const DRINK8 = ["고깃집", "치킨집", "횟집", "곱창집", "족발·보쌈", "전집", "이자카야", "호프집"];
const mkBoard = (id, name, lead, tpl, names, order) => ({ id, name, resultLead: lead, template: tpl, excludeYesterday: true, sortOrder: order, items: names.map((n, i) => ({ id: id + i, name: n, on: true })) });
const E = (date, name, nickname = "") => ({ date, name, nickname, confirmedAt: date + "T12:00:00+09:00" });

const fresh = async (opts, seed) => {
  const { ctx, page } = await open(browser, NEW, opts);
  await page.evaluate(([p, s]) => { localStorage.clear(); for (const [k, v] of Object.entries(s || {})) localStorage.setItem(p + k, JSON.stringify(v)); }, [P, seed]);
  await page.reload({ waitUntil: "load" }); await settle(page);
  return { ctx, page };
};
const shot = (p, n) => p.screenshot({ path: `${CAP}/${n}.png` });
const rows = p => p.$$eval("#historyList li", l => l.map(li => [li.querySelector(".h-date").textContent, li.querySelector(".h-menu").textContent, li.querySelector(".h-who").textContent]));
const bars = p => p.$$eval("#statsList li", l => l.map(li => [li.querySelector(".bar-name").textContent, li.querySelector(".bar-count").textContent, li.querySelector(".bar-fill").style.getPropertyValue("--pct")]));
const shownDisp = (p, sel) => p.$eval(sel, e => getComputedStyle(e).display);
const chips = p => p.$$eval("#historyBoards .chip", l => l.map(c => [c.textContent, c.getAttribute("aria-pressed")]));
const openHist = async p => { await p.click("#historyBtn"); await p.waitForSelector("#historyDialog[open]"); await p.waitForTimeout(250); };
const tabs = p => p.$$eval("#boardTabs .tab", t => t.map(x => x.textContent));

// ===================== 시나리오 5: 기록 화면 =====================
{
  // 점심판: 오늘-39 ~ 오늘 40일 연속(하루 1건). 이름은 4개를 번갈아(횟수가 서로 달라지게 일부 날은 다른 이름)
  const LN = ["김치찌개", "제육볶음", "돈가스", "국밥"];
  const lunchHist = [];
  for (let i = 39; i >= 0; i--) { const d = addDays(TODAY, -i); const k = i % 7 === 0 ? 3 : i % 5 === 0 ? 1 : i % 3 === 0 ? 0 : 2; lunchHist.push(E(d, LN[k])); }
  const drinkHist = [E(addDays(TODAY, -2), "고깃집", "민준"), E(addDays(TODAY, -5), "치킨집"), E(addDays(TODAY, -9), "고깃집"), E("2025-12-30", "횟집")];
  const boards = [mkBoard("bl", "점심", "오늘 점심은", "lunch", LUNCH8, 0), mkBoard("bd", "술 한잔", "오늘 먹으러 갈 곳은", "drinks", DRINK8, 1), mkBoard("be", "야식", "오늘의 선택은", "empty", [], 2)];
  const { ctx, page } = await fresh({}, { boards, history: { bl: lunchHist, bd: drinkHist }, device: { sound: false, lastBoardId: "bl", nickname: "" } });
  const count = (arr, from) => { const m = {}; for (const e of arr) if (e.date >= from) m[e.name] = (m[e.name] || 0) + 1; return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko")); };
  const wantBars = (arr, from) => { const c = count(arr, from); return c.map(x => [x.name, x.count + "번", (x.count / c[0].count * 100) + "%"]); };

  await openHist(page);
  await shot(page, "S5-기록창-점심");
  eq(5, "메뉴판 고르기: 현재(점심)가 눌림", await chips(page), [["점심", "true"], ["술 한잔", "false"], ["야식", "false"]]);
  const r1 = await rows(page);
  eq(5, "점심판 처음에 30건(오늘-29 ~ 오늘)", r1.length, 30);
  eq(5, "맨 위 = 오늘, 최신순", [r1[0][0], r1[29][0]], [fmt(TODAY), fmt(addDays(TODAY, -29))]);
  eq(5, "맨 위 줄 메뉴·확정한 사람('나')", [r1[0][1], r1[0][2]], [lunchHist[39].name, "나"]);
  eq(5, "30일 막대 = 기록과 같음(횟수·길이)", await bars(page), wantBars(lunchHist, addDays(TODAY, -29)));
  eq(5, "30일 버튼이 눌림", await page.$eval('#rangeBtns [aria-pressed="true"]', b => b.dataset.range), "30");
  eq(5, "'더 보기' 보임", await shownDisp(page, "#historyMore"), "block");
  // 더 보기
  await page.click("#historyMore"); await page.waitForTimeout(300);
  const r2 = await rows(page);
  eq(5, "더 보기 → 나머지 10건 붙어 40건", r2.length, 40);
  eq(5, "마지막 줄 = 오늘-39", r2[39][0], fmt(addDays(TODAY, -39)));
  eq(5, "더 이상 없으면 '더 보기' 사라짐", await shownDisp(page, "#historyMore"), "none");
  eq(5, "'더 보기' 줄의 날짜가 겹치지 않음", new Set(r2.map(x => x[0])).size, 40);
  // CSS 보정: hidden 속성만으로도 안 보임(JS가 style.display를 따로 안 줘도)
  eq(5, "CSS 보정: #historyMore[hidden] → display none (인라인 없이)", await page.$eval("#historyMore", e => { const s = e.style.display; e.style.display = ""; const d = e.hidden && getComputedStyle(e).display; e.style.display = s; return d; }), "none");
  // 기간
  await page.click('#rangeBtns [data-range="90"]'); await page.waitForTimeout(250);
  eq(5, "90일 막대 = 40건 전부 집계", await bars(page), wantBars(lunchHist, addDays(TODAY, -89)));
  eq(5, "기간만 바뀌고 날짜 목록은 그대로(40건)", (await rows(page)).length, 40);
  await page.click('#rangeBtns [data-range="all"]'); await page.waitForTimeout(250);
  eq(5, "전체 막대", await bars(page), wantBars(lunchHist, "0000-00-00"));
  eq(5, "막대 합계 = 40", (await bars(page)).reduce((s, b) => s + parseInt(b[1]), 0), 40);
  eq(5, "'전체' 버튼만 눌림", await page.$$eval("#rangeBtns button", l => l.map(b => b.getAttribute("aria-pressed"))), ["false", "false", "true"]);
  await shot(page, "S5-기록창-전체");
  // 다른 메뉴판
  await page.click('#historyBoards [data-board-id="bd"]'); await page.waitForTimeout(300);
  eq(5, "술 한잔 칩이 눌림", await chips(page), [["점심", "false"], ["술 한잔", "true"], ["야식", "false"]]);
  const r3 = await rows(page);
  eq(5, "술 한잔 30일 안 3건(점심 기록이 섞이지 않음)", r3.map(x => x[1]), ["고깃집", "치킨집", "고깃집"]);
  eq(5, "확정한 사람: 닉네임 있으면 그 이름, 없으면 '나'", r3.map(x => x[2]), ["민준", "나", "나"]);
  eq(5, "메뉴판을 바꾸면 기간이 30일로 돌아감", await page.$eval('#rangeBtns [aria-pressed="true"]', b => b.dataset.range), "30");
  eq(5, "술 한잔 막대(고깃집 2·치킨집 1)", await bars(page), [["고깃집", "2번", "100%"], ["치킨집", "1번", "50%"]]);
  eq(5, "'더 보기' 보임(30일 밖 2025-12-30 기록 있음)", await shownDisp(page, "#historyMore"), "block");
  await page.click("#historyMore"); await page.waitForTimeout(250);
  const r4 = await rows(page);
  eq(5, "올해가 아닌 날짜는 연도 표시", r4[r4.length - 1], [fmt("2025-12-30"), "횟집", "나"]);
  eq(5, "연도 표기 예", r4[r4.length - 1][0].startsWith("2025년 12월 30일 ("), true);
  await page.click('#rangeBtns [data-range="all"]'); await page.waitForTimeout(250);
  eq(5, "술 한잔 전체 막대(횟집 포함)", (await bars(page)).map(b => b[0]), ["고깃집", "치킨집", "횟집"]);
  // 빈 메뉴판
  await page.click('#historyBoards [data-board-id="be"]'); await page.waitForTimeout(300);
  eq(5, "기록 없는 판: 안내 문구 2곳 보임·목록 숨김", [await page.$eval("#historyEmpty", e => getComputedStyle(e).display !== "none" && e.textContent.trim()), await page.$eval("#statsEmpty", e => getComputedStyle(e).display !== "none" && e.textContent.trim()), (await rows(page)).length], ["아직 기록이 없어요. 돌려서 확정하면 여기에 쌓여요.", "이 기간에는 확정한 메뉴가 없어요.", 0]);
  eq(5, "기록 없는 판: '더 보기' 안 보임", await shownDisp(page, "#historyMore"), "none");
  await shot(page, "S5-기록창-빈판");
  // 닫기·포커스·스페이스
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  eq(5, "창이 열려 있으면 스페이스로 안 돌림", await page.evaluate(() => document.body.classList.contains("busy")), false);
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  eq(5, "Esc로 닫힘·포커스가 '기록' 버튼으로 복귀", await page.evaluate(() => [document.getElementById("historyDialog").open, document.activeElement.id]), [false, "historyBtn"]);
  await openHist(page);
  await page.click("#historyCloseBtn");
  eq(5, "'닫기' 버튼으로 닫힘", await page.$eval("#historyDialog", d => d.open), false);
  // 확정하면 기록이 늘어남(점심 오늘 기록 덮어쓰기: 하루 1건)
  await page.click('#boardTabs .tab:text-is("술 한잔")');
  await page.click("#spin"); await page.waitForSelector("#overlay.show", { timeout: 12000 }); await page.waitForTimeout(500);
  const w = await page.textContent("#resultName"); await page.click("#okBtn");
  await openHist(page);
  const r5 = await rows(page);
  eq(5, "술 한잔판 확정 → 기록 맨 위에 오늘 + 방금 메뉴", r5[0].slice(0, 2), [fmt(TODAY), w]);
  eq(5, "기록 창은 지금 보던 판(술 한잔)으로 열림", (await chips(page))[1], ["술 한잔", "true"]);
  await page.click("#historyCloseBtn");
  // 회전 중 잠김
  await page.click("#spin"); await page.waitForTimeout(600);
  eq(5, "회전 중 '기록' 버튼 잠김(줄 inert·반투명)", await page.evaluate(() => [document.getElementById("boardBar").inert, getComputedStyle(document.getElementById("boardBar")).pointerEvents]), [true, "none"]);
  await page.waitForSelector("#overlay.show", { timeout: 12000 }); await page.click("#closeBtn");
  // 삭제하면 기록 화면에서도 사라짐 (시나리오 6 후반)
  await page.dispatchEvent('#boardTabs .tab[aria-current="true"]', "contextmenu");
  await page.waitForSelector("#boardDialog[open]");
  page.once("dialog", d => d.accept());
  await page.click("#boardDeleteBtn"); await page.waitForTimeout(400);
  await openHist(page);
  eq(6, "메뉴판 삭제 → 기록 화면 칩에서도 사라짐", (await chips(page)).map(c => c[0]), ["점심", "야식"]);
  eq(6, "삭제한 판 기록이 저장소에 없음", await page.evaluate(p => Object.keys(JSON.parse(localStorage.getItem(p + "history"))), P), ["bl"]);
  await page.click("#historyCloseBtn");
  errors.push(...page.errors);
  await ctx.close();
}

// ---- 시나리오 5 추가: 최근 30일이 비어 있을 때 / 기록 사이가 30일 넘게 빌 때 ----
{
  const allMore = async p => { for (let i = 0; i < 12 && (await shownDisp(p, "#historyMore")) !== "none"; i++) { await p.click("#historyMore"); await p.waitForTimeout(250); } };
  const mk = (id, name) => mkBoard(id, name, "오늘 점심은", "lunch", LUNCH8, id === "bo" ? 0 : 1);
  // (a) 최근 30일 기록 없이 40일 전·70일 전 기록만
  const oldOnly = [E(addDays(TODAY, -70), "국밥"), E(addDays(TODAY, -40), "돈가스")];
  // (b) 기록 사이가 30일 넘게 빈 경우: -1, -45, -100, -101
  const gappy = [E(addDays(TODAY, -101), "비빔밥"), E(addDays(TODAY, -100), "햄버거"), E(addDays(TODAY, -45), "짜장면"), E(addDays(TODAY, -1), "김치찌개")];
  const { ctx, page } = await fresh({}, { boards: [mk("bo", "점심"), mk("bg", "옛날")], history: { bo: oldOnly, bg: gappy }, device: { sound: false, lastBoardId: "bo", nickname: "" } });
  await openHist(page);
  const first = await rows(page);
  const more0 = await shownDisp(page, "#historyMore");
  const emptyShown = await page.$eval("#historyEmpty", e => getComputedStyle(e).display !== "none");
  rec(5, "(a) 최근 30일이 비어도 '더 보기'가 보임(기록이 있는데 없다고만 보이면 안 됨)", more0 === "block" && !emptyShown, { rows: first.length, more0, emptyShown });
  await shot(page, "S5-기록창-옛기록만");
  await allMore(page);
  eq(5, "(a) 더 보기를 눌러 나가면 40일 전·70일 전 기록이 최신순으로 모두 보임", (await rows(page)).map(r => [r[0], r[1]]), [[fmt(addDays(TODAY, -40)), "돈가스"], [fmt(addDays(TODAY, -70)), "국밥"]]);
  eq(5, "(a) 다 보인 뒤 '더 보기' 사라짐", await shownDisp(page, "#historyMore"), "none");
  eq(5, "(a) 30일 막대는 비어 있고 안내 문구가 보임", [(await bars(page)).length, await page.$eval("#statsEmpty", e => getComputedStyle(e).display !== "none")], [0, true]);
  await page.click('#rangeBtns [data-range="90"]'); await page.waitForTimeout(250);
  eq(5, "(a) 90일 막대: 40일 전·70일 전 모두 집계", (await bars(page)).map(b => b[0]), ["국밥", "돈가스"]);
  await page.click('#historyBoards [data-board-id="bg"]'); await page.waitForTimeout(300);
  const g1 = await rows(page);
  eq(5, "(b) 처음 30일: 어제 1건", g1.map(r => r[1]), ["김치찌개"]);
  eq(5, "(b) '더 보기' 보임", await shownDisp(page, "#historyMore"), "block");
  let clicks = 0; const seen = [g1.length];
  for (let i = 0; i < 12 && (await shownDisp(page, "#historyMore")) !== "none"; i++) { await page.click("#historyMore"); await page.waitForTimeout(250); clicks++; seen.push((await rows(page)).length); }
  const g2 = await rows(page);
  eq(5, "(b) 빈 구간을 건너 모든 기록이 최신순으로 나옴(빠지거나 겹침 없음)", g2.map(r => r[1]), ["김치찌개", "짜장면", "햄버거", "비빔밥"]);
  eq(5, "(b) 날짜가 겹치지 않음", new Set(g2.map(r => r[0])).size, 4);
  rec(5, "(b) '더 보기'를 눌러 나가는 횟수(참고)", true, { clicks, seen });
  eq(5, "(b) 다 보인 뒤 '더 보기' 사라짐", await shownDisp(page, "#historyMore"), "none");
  eq(5, "(b) 전체 막대 4건", await (async () => { await page.click('#rangeBtns [data-range="all"]'); await page.waitForTimeout(250); return (await bars(page)).length; })(), 4);
  errors.push(...page.errors);
  await ctx.close();
}
// 폰 폭 기록 창
{
  const boards = [mkBoard("bl", "점심", "오늘 점심은", "lunch", LUNCH8, 0)];
  const hist = []; for (let i = 0; i < 8; i++) hist.push(E(addDays(TODAY, -i * 3), LUNCH8[i % 4] + (i === 2 ? "와아주아주긴메뉴이름이에요한줄이넘어요" : "")));
  const { ctx, page } = await fresh({ viewport: { width: 390, height: 844 } }, { boards, history: { bl: hist.reverse() } });
  await openHist(page);
  await shot(page, "S5-기록창-폰390");
  const m = await page.evaluate(() => { const d = document.getElementById("historyDialog").getBoundingClientRect(); return { left: d.left, right: d.right, bottom: d.bottom, vw: innerWidth, vh: innerHeight, hscroll: document.documentElement.scrollWidth > innerWidth, dlgScrollX: document.getElementById("historyDialog").scrollWidth > document.getElementById("historyDialog").clientWidth }; });
  rec(5, "390px: 기록 창이 화면 가로 가득·아래에 붙음·가로 스크롤 없음", Math.abs(m.left) < 1 && Math.round(m.right) === m.vw && Math.round(m.bottom) === m.vh && !m.hscroll && !m.dlgScrollX, m);
  const btn = await page.$$eval("#historyDialog button", l => l.map(b => Math.round(b.getBoundingClientRect().height)).filter(h => h > 0));
  rec(5, "390px: 창 안 버튼 높이 모두 48px 이상", Math.min(...btn) >= 48, btn);
  errors.push(...page.errors);
  await ctx.close();
}

// ===================== 시나리오 8: 메뉴판 설정 버튼 =====================
{
  const boards = [mkBoard("bl", "점심", "오늘 점심은", "lunch", LUNCH8, 0), mkBoard("bd", "술 한잔", "오늘 먹으러 갈 곳은", "drinks", DRINK8, 1)];
  boards[1].excludeYesterday = false;
  const { ctx, page } = await fresh({}, { boards, history: {}, device: { sound: false, lastBoardId: "bl", nickname: "" } });
  const geo = () => page.evaluate(() => {
    const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const a = document.querySelector("aside").getBoundingClientRect(), f = document.getElementById("boardSettingsBtn");
    return { snd: r("snd"), reset: r("resetBtn"), foot: r("foot"), set: r("boardSettingsBtn"), aside: { x: Math.round(a.x), r: Math.round(a.right), b: Math.round(a.bottom) }, font: parseFloat(getComputedStyle(f).fontSize), last: document.querySelector("aside").lastElementChild.id, next: document.getElementById("boardSettingsBtn").nextElementSibling?.id, txt: f.textContent };
  });
  const g = await geo();
  // 2단계에서 기준 변경(진록 승인): #groupBtn 이 패널 맨 아래로 들어옴 → 메뉴판 설정 버튼은 #groupBtn 바로 위(사이에 다른 요소 없음), 맨 아래는 #groupBtn
  eq(8, "① 문구·위치: #foot 아래 별도 줄, #groupBtn 바로 위, #groupBtn이 패널 맨 아래", [g.txt, g.next, g.last, g.set.y >= g.foot.b], ["메뉴판 설정", "groupBtn", "groupBtn", true]);
  rec(8, "① 높이 48px 이상·글씨 18px 이상·패널 너비 가득", g.set.h >= 48 && g.font >= 18 && g.set.x - g.aside.x <= 20 && g.aside.r - g.set.r <= 20, g);
  await shot(page, "S8-설정버튼-PC");
  // ⑧ 원본 두 버튼 폭: 설정 버튼을 숨겼을 때와 같음
  const g0 = await page.evaluate(() => { const f = document.getElementById("boardSettingsBtn"); f.style.display = "none"; const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width), Math.round(b.height)]; }; const o = { snd: r("snd"), reset: r("resetBtn") }; f.style.display = ""; return o; });
  eq(8, "⑧ #snd·#resetBtn 폭이 버튼 없을 때와 같음", { snd: [g.snd.x, g.snd.w, g.snd.h], reset: [g.reset.x, g.reset.w, g.reset.h] }, g0);
  // ② 열기
  await page.click("#boardSettingsBtn");
  await page.waitForSelector("#boardDialog[open]");
  eq(8, "② 점심판: 고치기 창 제목·값", await page.evaluate(() => [boardDialogTitle.textContent, boardName.value, boardLead.value, boardExclude.checked, templateField.hidden, !boardDeleteBtn.hidden]), ["메뉴판 고치기", "점심", "오늘 점심은", true, true, true]);
  await shot(page, "S8-설정창");
  // ④ 취소 → 포커스
  await page.click("#boardCancelBtn"); await page.waitForTimeout(150);
  eq(8, "④ 취소하면 포커스가 '메뉴판 설정' 버튼으로", await page.evaluate(() => document.activeElement.id), "boardSettingsBtn");
  // ⑤ 키보드 + Esc
  await page.focus("#boardSettingsBtn"); await page.keyboard.press("Enter");
  eq(8, "⑤ 포커스 후 Enter로 열림", await page.$eval("#boardDialog", d => d.open), true);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  eq(8, "④ Esc로 닫으면 포커스 복귀", await page.evaluate(() => [boardDialog.open, document.activeElement.id]), [false, "boardSettingsBtn"]);
  await page.keyboard.press("Space"); await page.waitForTimeout(300);
  const sp = await page.evaluate(() => ({ dialogOpen: boardDialog.open, busy: document.body.classList.contains("busy") }));
  rec(8, "⑤ 버튼에 포커스를 두고 Space → 창이 열림(룰렛이 돌면 안 됨)", sp.dialogOpen && !sp.busy, sp);
  if (sp.busy) { await page.waitForSelector("#overlay.show", { timeout: 12000 }); await page.click("#closeBtn"); await page.waitForTimeout(200); }
  if (!sp.dialogOpen) { await page.focus("#boardSettingsBtn"); await page.keyboard.press("Enter"); await page.waitForSelector("#boardDialog[open]"); }
  // ⑦ 열려 있는 동안 스페이스로 안 돌림 (창 안 버튼에 포커스가 있어도)
  await page.keyboard.press("Space"); await page.waitForTimeout(300);
  eq(8, "⑦ 창이 열려 있으면 스페이스로 안 돌림", await page.evaluate(() => document.body.classList.contains("busy")), false);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  // ③ 술 한잔
  await page.click('#boardTabs .tab:text-is("술 한잔")'); await page.waitForTimeout(150);
  await page.click("#boardSettingsBtn"); await page.waitForSelector("#boardDialog[open]");
  eq(8, "③ 술 한잔판: 값이 그 판 것(제외 꺼짐)", await page.evaluate(() => [boardName.value, boardLead.value, boardExclude.checked]), ["술 한잔", "오늘 먹으러 갈 곳은", false]);
  // 설정 버튼으로 고쳐 저장하면 반영
  await page.fill("#boardName", "술집"); await page.click("#boardSaveBtn"); await page.waitForFunction(() => !boardDialog.open);
  eq(8, "고쳐서 저장하면 탭 이름 바뀜", await tabs(page), ["점심", "술집"]);
  // ⑥ 회전 중
  await page.click("#spin"); await page.waitForTimeout(600);
  const blocked = await page.evaluate(() => { const b = document.getElementById("boardSettingsBtn").getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { mouseReaches: !!(el && el.closest("#boardSettingsBtn")), asidePointer: getComputedStyle(document.querySelector("aside")).pointerEvents, opacity: getComputedStyle(document.querySelector("aside")).opacity }; });
  rec(8, "⑥ 회전 중 마우스·터치가 버튼에 닿지 않음(반투명)", blocked.mouseReaches === false && blocked.asidePointer === "none" && blocked.opacity === "0.5", blocked);
  await page.focus("#boardSettingsBtn"); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  const kbOpen = await page.$eval("#boardDialog", d => d.open);
  rec(8, "⑥ 회전 중 키보드(Enter)로도 열리지 않음", kbOpen === false, { kbOpen });
  if (kbOpen) await page.keyboard.press("Escape");
  await page.waitForSelector("#overlay.show", { timeout: 12000 }); await page.click("#closeBtn");
  // ⑩ 길게 누르기·우클릭 그대로
  await page.dispatchEvent('#boardTabs .tab[aria-current="true"]', "contextmenu");
  eq(8, "⑩ 탭 우클릭(contextmenu)으로도 열림", await page.$eval("#boardDialog", d => d.open), true);
  await page.click("#boardCancelBtn");
  const bx = await (await page.$('#boardTabs .tab[aria-current="true"]')).boundingBox();
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(150);
  eq(8, "⑩ 탭 길게 누르기로도 열림", await page.$eval("#boardDialog", d => d.open), true);
  await page.click("#boardCancelBtn");
  // ⑪ 새 컨트롤에 포커스를 두고 Space → 그 버튼이 눌림, 룰렛은 안 돎. 원본 버튼(#snd·#resetBtn)은 원본대로 Space=돌리기
  const busy = () => page.evaluate(() => document.body.classList.contains("busy"));
  await page.click('#boardTabs .tab:text-is("점심")'); await page.waitForTimeout(150);
  await page.focus('#boardTabs .tab:text-is("술집")'); await page.keyboard.press("Space"); await page.waitForTimeout(300);
  eq(8, "⑪ 다른 탭에 포커스 후 Space → 그 메뉴판으로 바뀜·룰렛 안 돎", [await page.$eval('#boardTabs .tab[aria-current="true"]', t => t.textContent), await busy()], ["술집", false]);
  await page.focus("#addBoardBtn"); await page.keyboard.press("Space"); await page.waitForTimeout(300);
  eq(8, "⑪ '+' 포커스 후 Space → 새 메뉴판 창 열림·룰렛 안 돎", [await page.$eval("#boardDialog", d => d.open), await page.textContent("#boardDialogTitle"), await busy()], [true, "새 메뉴판", false]);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.focus("#historyBtn"); await page.keyboard.press("Space"); await page.waitForTimeout(500);
  eq(8, "⑪ '기록' 포커스 후 Space → 기록 창 열림·룰렛 안 돎", [await page.$eval("#historyDialog", d => d.open), await busy()], [true, false]);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.focus("#boardSettingsBtn"); await page.keyboard.press("Space"); await page.waitForTimeout(300);
  eq(8, "⑪ '메뉴판 설정' 포커스 후 Space → 창 열림·룰렛 안 돎", [await page.$eval("#boardDialog", d => d.open), await busy()], [true, false]);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.focus("#snd"); await page.keyboard.press("Space"); await page.waitForTimeout(400);
  eq(8, "⑪ 원본 버튼 '소리'에 포커스 후 Space → 원본대로 룰렛이 돎(소리 문구는 그대로)", [await busy(), await page.textContent("#snd")], [true, "소리 꺼짐"]);
  await page.waitForSelector("#overlay.show", { timeout: 12000 }); await page.click("#closeBtn"); await page.waitForTimeout(200);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Space"); await page.waitForTimeout(300);
  eq(8, "⑪ 포커스가 아무 데도 없을 때 Space → 돌림(설계 그대로)", await busy(), true);
  await page.waitForSelector("#overlay.show", { timeout: 12000 }); await page.click("#closeBtn");
  errors.push(...page.errors);
  await ctx.close();
}
{ // ⑨ 390px
  const boards = [mkBoard("bl", "점심", "오늘 점심은", "lunch", LUNCH8, 0)];
  const { ctx, page } = await fresh({ viewport: { width: 390, height: 844 } }, { boards });
  const m = await page.evaluate(() => { const b = document.getElementById("boardSettingsBtn").getBoundingClientRect(), a = document.querySelector("aside").getBoundingClientRect(), f = document.getElementById("foot").getBoundingClientRect(), s = document.getElementById("snd").getBoundingClientRect(), r = document.getElementById("resetBtn").getBoundingClientRect(); return { hscroll: document.documentElement.scrollWidth > innerWidth, x: Math.round(b.x), right: Math.round(b.right), vw: innerWidth, h: Math.round(b.height), belowFoot: b.y >= f.bottom, last: document.querySelector("aside").lastElementChild.id, next: document.getElementById("boardSettingsBtn").nextElementSibling?.id, footOverflow: s.right > f.right + 1 || r.right > f.right + 1, asideBelowWheel: a.top >= document.getElementById("wheel").getBoundingClientRect().bottom - 1 }; });
  rec(8, "⑨ 390px: 가로 스크롤 없음·버튼이 화면 안·#groupBtn 바로 위(#groupBtn이 패널 맨 아래)·#foot 아래", !m.hscroll && m.x >= 0 && m.right <= m.vw && m.h >= 48 && m.belowFoot && m.next === "groupBtn" && m.last === "groupBtn" && !m.footOverflow && m.asideBelowWheel, m);
  await page.evaluate(() => document.getElementById("boardSettingsBtn").scrollIntoView({ block: "center" }));
  await shot(page, "S8-설정버튼-폰390");
  await page.click("#boardSettingsBtn"); await page.waitForSelector("#boardDialog[open]"); await page.waitForTimeout(400);
  await shot(page, "S8-설정창-폰390");
  errors.push(...page.errors);
  await ctx.close();
}

await browser.close();
const failed = R.filter(r => !r.ok);
fs.writeFileSync(`${CAP}/S2_result.json`, JSON.stringify({ results: R, errors }, null, 2));
console.log("콘솔·페이지 오류:", JSON.stringify(errors));
console.log(`시나리오 5·8(+6 후반): ${R.length - failed.length}/${R.length} 통과`);
process.exit(failed.length ? 1 : 0);
