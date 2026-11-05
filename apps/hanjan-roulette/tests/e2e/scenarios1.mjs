// 1단계 브라우저 시나리오 1·2·3·4·6 (5·7은 묶음 D 뒤). 설명은 1단계_시나리오.md. 결과: docs/design/1단계_캡처/S_result.json
// 실행: LD_LIBRARY_PATH=$(cat /home/claude/chrome-deps/ldpath.txt) FONTCONFIG_FILE=/home/claude/chrome-deps/fonts.conf node tests/e2e/scenarios1.mjs
import fs from "node:fs";
import { launch, open, settle, NEW } from "./_lib.mjs";

const CAP = "/workspace/apps/hanjan-roulette/docs/design/1단계_캡처";
const P = "hanjan.v1.";
fs.mkdirSync(CAP, { recursive: true });
const browser = await launch();
const R = [];            // {sc, item, ok, got}
const rec = (sc, item, ok, got) => { R.push({ sc, item, ok: !!ok, got }); console.log(ok ? "OK  " : "FAIL", sc, item, ok ? "" : JSON.stringify(got)); };
const eq = (sc, item, got, want) => rec(sc, item, JSON.stringify(got) === JSON.stringify(want), got);

const todayKST = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const yesterdayKST = () => todayKST(new Date(Date.now() - 24 * 3600e3));
const LUNCH8 = ["김치찌개", "제육볶음", "돈가스", "짜장면", "국밥", "비빔밥", "햄버거", "샐러드"];
const DRINK8 = ["고깃집", "치킨집", "횟집", "곱창집", "족발·보쌈", "전집", "이자카야", "호프집"];

const tabs = p => p.$$eval("#boardTabs .tab", t => t.map(x => x.textContent));
const cur = p => p.$eval('#boardTabs .tab[aria-current="true"]', t => t.textContent).catch(() => null);
const names = p => p.$$eval("#list li .name", l => l.map(x => x.textContent));
const tags = p => p.$$eval("#list li", l => l.map(li => [li.querySelector(".name").textContent, li.querySelector(".tag").textContent]).filter(x => x[1]));
const wheelTexts = p => p.evaluate(() => window.__texts.slice());
const store = (p, k) => p.evaluate(([a, k]) => { try { return JSON.parse(localStorage.getItem(a + k)); } catch { return "BROKEN"; } }, [P, k]);
const shot = (p, n) => p.screenshot({ path: `${CAP}/${n}.png` });
const fresh = async (opts, seed) => {
  const { ctx, page } = await open(browser, NEW, opts);
  const bad404 = []; page.on("response", r => { if (r.status() >= 400) bad404.push(r.status() + " " + r.url()); }); page.bad404 = bad404;
  if (seed) { await page.evaluate(([p, s]) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(p + k, JSON.stringify(v)); }, [P, seed]); await page.reload({ waitUntil: "load" }); }
  await settle(page);
  return { ctx, page };
};
const spinConfirm = async (p, { expectLead } = {}) => {
  await p.click("#spin");
  await p.waitForSelector("#overlay.show", { timeout: 12000 });
  const lead = await p.textContent("#resultLead"), win = await p.textContent("#resultName");
  await p.waitForTimeout(500);
  return { lead, win, ok: () => p.click("#okBtn") };
};
const makeBoard = async (p, { template, name, lead, exclude } = {}) => {
  await p.click("#addBoardBtn");
  await p.waitForSelector("#boardDialog[open]");
  if (template) await p.check(`input[name=template][value=${template}]`);
  const auto = { name: await p.inputValue("#boardName"), lead: await p.inputValue("#boardLead") };
  if (name != null) await p.fill("#boardName", name);
  if (lead != null) await p.fill("#boardLead", lead);
  if (exclude != null) await p.setChecked("#boardExclude", exclude);
  return auto;
};
const errors = [];

// ===== 시나리오 1: 점심판에서 돌려 확정 → 배지·태그 =====
let ctx1, page1, win1;
{
  const { ctx, page } = await fresh(); ctx1 = ctx; page1 = page;
  eq(1, "처음 실행: 탭이 '점심' 하나", await tabs(page), ["점심"]);
  eq(1, "현재 탭 = 점심 (aria-current)", await cur(page), "점심");
  eq(1, "기본 메뉴 8개", await names(page), LUNCH8);
  eq(1, "title", await page.title(), "한잔메뉴룰렛");
  eq(1, "저장 키: boards/history/skipped/device 접두어 hanjan.v1.", (await store(page, "boards")).length, 1);
  const s = await spinConfirm(page);
  eq(1, "결과 카드 첫 줄 = 오늘 점심은", s.lead, "오늘 점심은");
  win1 = s.win;
  await shot(page, "S1-결과카드");
  await s.ok();
  eq(1, "상단 배지", await page.textContent("#today"), `오늘 점심 확정: ${win1}`);
  eq(1, "목록 태그 = 확정한 메뉴 하나에 '오늘 확정'", await tags(page), [[win1, "오늘 확정"]]);
  const h = await store(page, "history"), b = (await store(page, "boards"))[0];
  rec(1, "history[점심판id] 1건(오늘 KST 날짜·메뉴)", h && h[b.id]?.length === 1 && h[b.id][0].date === todayKST() && h[b.id][0].name === win1, h);
  await shot(page, "S1-확정후");
  errors.push(...page.errors, ...page.bad404.map(x => "http " + x));
}

// ===== 시나리오 2: 술 한잔 템플릿으로 새 메뉴판 =====
let win2;
{
  const page = page1;
  const auto = await makeBoard(page, { template: "drinks" });
  await shot(page, "S2-새메뉴판창");
  rec(2, "템플릿 '술 한잔' 고르면 이름·문구 칸이 기본값으로 채워짐", auto.name === "술 한잔" && auto.lead === "오늘 먹으러 갈 곳은", auto);
  await page.click("#boardSaveBtn");
  await page.waitForFunction(() => !document.getElementById("boardDialog").open);
  eq(2, "탭 = 점심, 술 한잔", await tabs(page), ["점심", "술 한잔"]);
  eq(2, "새 메뉴판이 열려 있음", await cur(page), "술 한잔");
  eq(2, "기본 메뉴 8곳", await names(page), DRINK8);
  eq(2, "배지 비어 있음(점심 확정이 섞이지 않음)", await page.textContent("#today"), "");
  eq(2, "태그 없음", await tags(page), []);
  const s = await spinConfirm(page);
  eq(2, "결과 카드 첫 줄 = 오늘 먹으러 갈 곳은", s.lead, "오늘 먹으러 갈 곳은");
  rec(2, "당첨은 술집 목록 안", DRINK8.includes(s.win), s.win);
  win2 = s.win;
  await shot(page, "S2-결과카드");
  await s.ok();
  eq(2, "상단 배지", await page.textContent("#today"), `오늘 술 한잔 확정: ${win2}`);
  eq(2, "태그", await tags(page), [[win2, "오늘 확정"]]);
  // 이름을 직접 쓰는 경우 + 오류 문구
  const a2 = await makeBoard(page, { template: "empty", name: "야식", lead: "" });
  rec(2, "빈 메뉴판은 이름 '새 메뉴판'·문구 '오늘의 선택은'이 자동", a2.name === "새 메뉴판" && a2.lead === "오늘의 선택은", a2);
  await page.fill("#boardLead", "");
  await page.click("#boardSaveBtn");
  await page.waitForFunction(() => !document.getElementById("boardDialog").open);
  eq(2, "결과 문구를 비워 저장하면 템플릿 기본 문구가 들어감", (await store(page, "boards")).find(b => b.name === "야식")?.resultLead, "오늘의 선택은");
  await makeBoard(page, {});
  await page.fill("#boardName", "가".repeat(13));
  rec(2, "이름 칸은 12자까지만 입력됨(maxlength)", (await page.inputValue("#boardName")).length === 12, await page.inputValue("#boardName"));
  await page.click("#boardCancelBtn");
  eq(2, "취소하면 메뉴판이 늘지 않음", await tabs(page), ["점심", "술 한잔", "야식"]);
  // 메뉴판 10개 제한
  for (let i = 0; i < 7; i++) { await makeBoard(page, { template: "empty", name: "판" + i }); await page.click("#boardSaveBtn"); await page.waitForFunction(() => !document.getElementById("boardDialog").open); }
  eq(2, "10개째까지 만들어짐", (await tabs(page)).length, 10);
  await makeBoard(page, { template: "empty", name: "열한째" }); await page.click("#boardSaveBtn");
  eq(2, "11번째 → 안내 문구", (await page.textContent("#boardMsg")).trim(), "메뉴판은 10개까지 만들 수 있어요.");
  await page.click("#boardCancelBtn");
  // 가로로 밀리는지
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  rec(2, "폭 390px, 탭 10개: 탭 줄만 가로로 밀림(+ 버튼은 화면 안)", await page.evaluate(() => { const t = document.getElementById("boardTabs"), a = document.getElementById("addBoardBtn").getBoundingClientRect(); return t.scrollWidth > t.clientWidth && a.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }), null);
  await shot(page, "S2-탭10개-폰");
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  errors.push(...page.errors);
}

// ===== 시나리오 3: 탭을 오가며 섞이지 않음 (새로고침 포함) =====
{
  const page = page1;
  // 위 시나리오에서 만든 '판0~7'은 지우지 않고 그대로 둔다(삭제 시험은 6번). 점심·술 한잔만 오간다.
  const go = async n => { await page.click(`#boardTabs .tab:text-is("${n}")`); await page.waitForTimeout(150); };
  for (let round = 0; round < 2; round++) {
    await go("점심");
    eq(3, `점심 탭(${round + 1}회): 배지`, await page.textContent("#today"), `오늘 점심 확정: ${win1}`);
    eq(3, `점심 탭(${round + 1}회): 태그`, await tags(page), [[win1, "오늘 확정"]]);
    eq(3, `점심 탭(${round + 1}회): 메뉴`, await names(page), LUNCH8);
    await go("술 한잔");
    eq(3, `술 한잔 탭(${round + 1}회): 배지`, await page.textContent("#today"), `오늘 술 한잔 확정: ${win2}`);
    eq(3, `술 한잔 탭(${round + 1}회): 태그`, await tags(page), [[win2, "오늘 확정"]]);
    eq(3, `술 한잔 탭(${round + 1}회): 메뉴`, await names(page), DRINK8);
  }
  // 한쪽에서 다시 돌리기(넘김)와 메뉴 끄기가 다른 쪽에 영향 없음
  await go("점심");
  const s = await spinConfirm(page); await page.click("#againBtn");
  await page.waitForSelector("#overlay.show", { timeout: 12000 }); await page.waitForTimeout(500); await page.click("#closeBtn");
  const skippedTag = (await tags(page)).filter(t => t[1] === "오늘 넘김").map(t => t[0]);
  rec(3, "점심판에서 다시 돌리기 → '오늘 넘김' 태그가 점심판에만", skippedTag.includes(s.win), skippedTag);
  await go("술 한잔");
  eq(3, "술 한잔 태그는 그대로(넘김 없음)", await tags(page), [[win2, "오늘 확정"]]);
  const uncheck = DRINK8.find(n => n !== win2);
  await page.uncheck(`#list li:has(.name:text-is("${uncheck}")) input[type=checkbox]`);
  await go("점심");
  rec(3, "술 한잔판에서 끈 메뉴가 점심판에는 영향 없음", (await page.textContent("#count")).startsWith("8"), await page.textContent("#count"));
  await go("술 한잔");
  eq(3, "술 한잔판 켜진 개수 7(8 중 1 끔) - 목록은 8", [await names(page).then(n => n.length), (await wheelTexts(page)).length], [8, 7]);
  // 새로고침 후에도 섞이지 않음
  await page.reload({ waitUntil: "load" }); await settle(page);
  eq(3, "새로고침 뒤 마지막으로 보던 탭이 열림(술 한잔)", await cur(page), "술 한잔");
  eq(3, "새로고침 뒤 술 한잔 배지", await page.textContent("#today"), `오늘 술 한잔 확정: ${win2}`);
  await shot(page, "S3-술한잔");
  await page.click('#boardTabs .tab:text-is("점심")'); await page.waitForTimeout(150);
  eq(3, "새로고침 뒤 점심 배지", await page.textContent("#today"), `오늘 점심 확정: ${win1}`);
  await shot(page, "S3-점심");
  // 다른 탭(브라우저 탭)에서 바뀌면 다시 그림 (subscribe)
  const page2 = await page.context().newPage();
  await page2.goto(NEW, { waitUntil: "load" }); await settle(page2);
  await page2.click('#boardTabs .tab:text-is("술 한잔")'); await page2.waitForTimeout(150);
  await page2.uncheck(`#list li:has(.name:text-is("${DRINK8.find(n => n !== win2 && n !== uncheck)}")) input[type=checkbox]`);
  await page.click('#boardTabs .tab:text-is("술 한잔")'); await page.waitForTimeout(400);
  eq(3, "다른 브라우저 탭에서 끈 메뉴가 이쪽 술 한잔판에 반영(룰렛 글자 6)", (await wheelTexts(page)).length, 6);
  await page2.close();
  errors.push(...page.errors);
  await ctx1.close();
}

// ===== 시나리오 4: 어제 기록 → 태그·후보 제외 → 설정에서 끄기 =====
{
  const y = yesterdayKST(), YN = "국밥";
  const board = { id: "b-l", name: "점심", resultLead: "오늘 점심은", template: "lunch", excludeYesterday: true, sortOrder: 0, items: LUNCH8.map((n, i) => ({ id: "i" + i, name: n, on: true })) };
  const { ctx, page } = await fresh({}, { boards: [board], history: { "b-l": [{ date: y, name: YN, nickname: "", confirmedAt: y + "T12:00:00+09:00" }] } });
  eq(4, "어제 먹은 메뉴에 '어제 먹음' 태그", await tags(page), [[YN, "어제 먹음"]]);
  const t1 = await wheelTexts(page);
  rec(4, "룰렛 후보에서 어제 메뉴가 빠짐(7칸)", t1.length === 7 && !t1.includes(YN), t1);
  eq(4, "배지 비어 있음(오늘 확정 없음)", await page.textContent("#today"), "");
  await shot(page, "S4-어제먹음");
  // 여러 번 돌려도 어제 메뉴가 나오지 않음
  const got = [];
  for (let i = 0; i < 3; i++) { const s = await spinConfirm(page); got.push(s.win); await page.click("#closeBtn"); }
  rec(4, "3번 돌려 모두 어제 메뉴 아님", !got.includes(YN), got);
  // 설정에서 제외 끄기
  await page.dispatchEvent('#boardTabs .tab[aria-current="true"]', "contextmenu");
  await page.waitForSelector("#boardDialog[open]");
  eq(4, "고치기 창: 제목", await page.textContent("#boardDialogTitle"), "메뉴판 고치기");
  rec(4, "고치기 창: 템플릿 고르기는 숨김, 삭제 버튼 보임", await page.evaluate(() => document.getElementById("templateField").hidden && !document.getElementById("boardDeleteBtn").hidden), null);
  eq(4, "고치기 창: '어제 먹은 메뉴는 빼기' 켜져 있음", await page.isChecked("#boardExclude"), true);
  await shot(page, "S4-고치기창");
  await page.uncheck("#boardExclude");
  await page.click("#boardSaveBtn");
  await page.waitForFunction(() => !document.getElementById("boardDialog").open);
  eq(4, "끄면 '어제 먹음' 태그가 사라짐", await tags(page), []);
  const t2 = await wheelTexts(page);
  rec(4, "후보에 어제 메뉴가 다시 들어옴(8칸)", t2.length === 8 && t2.includes(YN), t2);
  eq(4, "저장된 excludeYesterday=false", (await store(page, "boards"))[0].excludeYesterday, false);
  await shot(page, "S4-제외끔");
  await page.reload({ waitUntil: "load" }); await settle(page);
  eq(4, "새로고침 뒤에도 태그 없음·8칸", [await tags(page), (await wheelTexts(page)).length], [[], 8]);
  // 길게 누르기(0.5초)로도 열림
  const box = await (await page.$('#boardTabs .tab[aria-current="true"]')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  rec(4, "탭 길게 누르기(0.7초) → 고치기 창", await page.$eval("#boardDialog", d => d.open), null);
  await page.click("#boardCancelBtn");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
  rec(4, "짧게 누르기는 창이 안 열림", !(await page.$eval("#boardDialog", d => d.open)), null);
  errors.push(...page.errors, ...page.bad404.map(x => "http " + x));
  await ctx.close();
}

// ===== 시나리오 6: 삭제 → 사라짐, 마지막 메뉴판 기억 =====
{
  const { ctx, page } = await fresh();
  await makeBoard(page, { template: "drinks" }); await page.click("#boardSaveBtn"); await page.waitForFunction(() => !document.getElementById("boardDialog").open);
  const s = await spinConfirm(page); await s.ok();
  const bs = await store(page, "boards"); const dId = bs.find(b => b.name === "술 한잔").id, lId = bs.find(b => b.name === "점심").id;
  eq(6, "술 한잔 기록이 저장됨", ((await store(page, "history"))[dId] || []).length, 1);
  // 마지막 본 메뉴판 기억
  eq(6, "device.lastBoardId = 술 한잔", (await store(page, "device")).lastBoardId, dId);
  await page.reload({ waitUntil: "load" }); await settle(page);
  eq(6, "새로고침하면 마지막으로 본 '술 한잔'이 열림", await cur(page), "술 한잔");
  await page.click('#boardTabs .tab:text-is("점심")'); await page.reload({ waitUntil: "load" }); await settle(page);
  eq(6, "점심을 보다 새로고침하면 점심이 열림", await cur(page), "점심");
  // 삭제: 확인창 취소 → 그대로, 확인 → 삭제
  const dlgs = []; page.on("dialog", async d => { dlgs.push([d.type(), d.message()]); if (dlgs.length === 1) await d.dismiss(); else await d.accept(); });
  await page.click('#boardTabs .tab:text-is("술 한잔")');
  await page.dispatchEvent('#boardTabs .tab[aria-current="true"]', "contextmenu");
  await page.waitForSelector("#boardDialog[open]");
  await page.click("#boardDeleteBtn"); await page.waitForTimeout(300);
  eq(6, "삭제 확인창 문구", dlgs[0], ["confirm", "‘술 한잔’ 메뉴판을 지울까요? 이 메뉴판의 기록도 함께 사라져요."]);
  eq(6, "취소하면 그대로(창 열림, 탭 2개)", [await page.$eval("#boardDialog", d => d.open), (await tabs(page)).length], [true, 2]);
  await page.click("#boardDeleteBtn"); await page.waitForTimeout(400);
  eq(6, "삭제하면 탭에서 사라짐", await tabs(page), ["점심"]);
  eq(6, "삭제 뒤 점심판이 열림", await cur(page), "점심");
  eq(6, "창이 닫힘", await page.$eval("#boardDialog", d => d.open), false);
  const h = await store(page, "history"), sk = await store(page, "skipped");
  rec(6, "저장소에서 history·skipped·boards 모두 사라짐", !(h && dId in h) && !(sk && dId in sk) && !(await store(page, "boards")).some(b => b.id === dId), { h, sk });
  // 지운 판을 마지막으로 보고 있었다면 첫 메뉴판
  await page.reload({ waitUntil: "load" }); await settle(page);
  eq(6, "새로고침 뒤 점심판", await cur(page), "점심");
  // 마지막 1개는 못 지움
  await page.dispatchEvent('#boardTabs .tab[aria-current="true"]', "contextmenu");
  await page.waitForSelector("#boardDialog[open]");
  await page.click("#boardDeleteBtn"); await page.waitForTimeout(300);
  eq(6, "마지막 1개 삭제 → 안내 문구", (await page.textContent("#boardMsg")).trim(), "메뉴판은 1개 이상 있어야 해요.");
  eq(6, "마지막 1개는 그대로", await tabs(page), ["점심"]);
  await shot(page, "S6-마지막1개");
  // 마지막으로 본 메뉴판이 사라진 상태로 시작하면 첫 메뉴판
  await page.click("#boardCancelBtn");
  await page.evaluate(([p, id]) => { const d = JSON.parse(localStorage.getItem(p + "device") || "{}"); d.lastBoardId = id; localStorage.setItem(p + "device", JSON.stringify(d)); }, [P, dId]);
  await page.reload({ waitUntil: "load" }); await settle(page);
  eq(6, "lastBoardId가 없는 메뉴판이면 첫 메뉴판", await cur(page), "점심");
  errors.push(...page.errors);
  await ctx.close();
}

await browser.close();
const failed = R.filter(r => !r.ok);
fs.writeFileSync(`${CAP}/S_result.json`, JSON.stringify({ results: R, errors }, null, 2));
console.log("콘솔·페이지 오류:", JSON.stringify(errors));
console.log(`시나리오 1·2·3·4·6: ${R.length - failed.length}/${R.length} 통과`);
process.exit(failed.length ? 1 : 0);
