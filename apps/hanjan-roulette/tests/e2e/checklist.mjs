// 시험 D: 동작 점검표 23항목. 원본·새 화면에서 같은 절차를 실행해 관측값을 비교한다.
// 결과: tests/e2e/0단계_점검표.md, docs/design/0단계_캡처/D_result.json
import fs from "node:fs";
import { launch, open, settle, ORIG, NEW, CAP, readKey } from "./_lib.mjs";

fs.mkdirSync(CAP, { recursive: true });
const browser = await launch();
const DEFAULT8 = ["김치찌개", "제육볶음", "돈가스", "짜장면", "국밥", "비빔밥", "햄버거", "샐러드"];

async function run(url, tag) {
  const O = {};
  const put = (i, k, v, tol) => { (O[i] ??= {})[k] = { v, tol }; };
  const errors = [];
  const names = p => p.$$eval("#list li", l => l.map(li => li.querySelector(".name").textContent));
  const tags = p => p.$$eval("#list li", l => l.map(li => li.querySelector(".tag").textContent));
  const ls = (p, k) => readKey(p, url, k);
  const ev = p => p.evaluate(() => window.__ev);
  const shot = (p, n) => p.screenshot({ path: `${CAP}/D-${n}-${tag}.png` });
  const waitShow = p => p.waitForSelector("#overlay.show", { timeout: 12000 });
  const add = async (p, v) => { await p.fill("#addInput", v); await p.press("#addInput", "Enter"); };

  // ===== 시나리오 A: 첫 화면 → 돌리기 → 닫기 → 스페이스 → 확정 → 다시 돌리기 → 새로고침 =====
  {
    const { ctx, page } = await open(browser, url);
    await settle(page);
    put(1, "메뉴 이름", await names(page));
    put(1, "켜짐 상태", await page.$$eval("#list input", a => a.map(c => c.checked)));
    put(1, "룰렛 글자", await page.evaluate(() => window.__texts));
    put(2, "개수 글자", await page.textContent("#count"));
    put(8, "소리 버튼 문구", await page.textContent("#snd"));
    put(8, "on 클래스", await page.$eval("#snd", e => e.classList.contains("on")));
    put(8, "aria-pressed", await page.$eval("#snd", e => e.getAttribute("aria-pressed")));
    put(8, "저장된 sound", await ls(page, "sound"));
    put(8, "AudioContext 생성 수(클릭 전)", await page.evaluate(() => window.__audio.ctxCount));
    await shot(page, "01-첫화면");

    // 7: 소리 켜기 → 틱 한 번
    await page.click("#snd");
    put(7, "켠 직후 문구", await page.textContent("#snd"));
    put(7, "켠 직후 소리 기록", await page.evaluate(() => window.__audio.osc));
    put(7, "저장된 sound(켠 뒤)", await ls(page, "sound"));
    await page.evaluate(() => { window.__kicks = []; window.__audio.osc = []; });

    // 3·4·5·6: 돌리기
    await page.click("#spin");
    await page.waitForTimeout(1200);
    put(5, "회전 중 #spin disabled", await page.$eval("#spin", e => e.disabled));
    put(4, "회전 중 body.busy", await page.evaluate(() => document.body.classList.contains("busy")));
    put(4, "aside opacity", await page.$eval("aside", e => getComputedStyle(e).opacity));
    put(4, "aside pointer-events", await page.$eval("aside", e => getComputedStyle(e).pointerEvents));
    put(4, "체크박스 위치 클릭이 aside에 닿는가", await page.evaluate(() => { const r = document.querySelector("#list input").getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!(el && el.closest("aside")); }));
    await shot(page, "02-회전중");
    await waitShow(page);
    await page.waitForTimeout(150);
    const e1 = await ev(page);
    const t0 = e1.find(e => e.busy).t, t1 = e1.find(e => e.t > t0 && !e.busy).t, t2 = e1.find(e => e.t >= t1 && e.show)?.t;
    put(3, "회전 시간(ms)", Math.round(t1 - t0), 300);
    put(3, "회전 끝 → 카드 표시(ms)", Math.round(t2 - t1), 100);
    put(3, "회전 끝나면 busy 해제", await page.evaluate(() => !document.body.classList.contains("busy")));
    put(5, "회전 후 #spin disabled", await page.$eval("#spin", e => e.disabled));
    const win1 = await page.textContent("#resultName");
    put(3, "멈춘 메뉴(같은 난수 시드)", win1);
    const kicks = await page.evaluate(() => window.__kicks);
    put(6, "포인터 튕김 최소값", +Math.min(...kicks).toFixed(3));
    put(6, "튕김 0 아님 프레임 수가 20 이상", kicks.filter(k => Math.abs(k) > 0.01).length >= 20);
    put(6, "마지막 프레임 튕김", kicks[kicks.length - 1]);
    const au = await page.evaluate(() => window.__audio.osc);
    put(7, "회전 중 틱(900Hz) 횟수", au.filter(a => a.f === 900).length, 8);
    put(7, "틱 한 번의 값(길이·볼륨)", [...new Set(au.filter(a => a.f === 900).map(a => `${a.dur}/${a.vol}`))]);
    put(7, "차임 소리(마지막 3개)", au.slice(-3));
    // 9: 결과 카드·색종이
    put(9, "카드 첫 줄", await page.textContent("#card .lead"));
    put(9, "카드 메뉴 이름이 목록에 있음", (await names(page)).includes(win1));
    put(9, "버튼 문구", await page.$$eval("#card button", b => b.map(x => x.textContent + ":" + (getComputedStyle(x).display !== "none"))));
    put(9, "카드 애니메이션 이름(기본)", await page.$eval("#card", e => getComputedStyle(e).animationName));
    const confettiPx = () => page.$eval("#confetti", c => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 0; });
    put(9, "0.4초 뒤 색종이 그려짐", await (async () => { await page.waitForTimeout(250); return confettiPx(); })());
    put(9, "색종이 캔버스 크기=창 크기", await page.$eval("#confetti", c => c.width === innerWidth && c.height === innerHeight));
    await shot(page, "03-결과카드");
    await page.waitForTimeout(4300);
    put(9, "4.5초 뒤 색종이 지워짐", !(await confettiPx()));
    // 12: 닫기 → 저장 없음
    await page.click("#closeBtn");
    put(12, "카드 닫힘", await page.evaluate(() => !document.getElementById("overlay").classList.contains("show")));
    put(12, "저장된 history", await ls(page, "history"));
    put(12, "저장된 skipped", await ls(page, "skipped"));
    put(12, "상단 확정 글", await page.textContent("#today"));
    put(12, "목록 태그", await tags(page));
    // 13: 스페이스바
    await page.evaluate(() => { window.__ev = []; });
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    put(13, "스페이스 후 회전 시작(busy)", await page.evaluate(() => document.body.classList.contains("busy")));
    await waitShow(page);
    // 10: 확정
    const win2 = await page.textContent("#resultName");
    await page.click("#okBtn");
    put(10, "확정 메뉴(시드)", win2);
    put(10, "상단 글", await page.textContent("#today"));
    put(10, "상단 글 모양", await page.$eval("#today", e => { const s = getComputedStyle(e); return [s.borderTopWidth, s.fontWeight, s.display]; }));
    put(10, "목록 태그", await tags(page));
    put(10, "저장된 history", await ls(page, "history"));
    put(10, "저장된 skipped", await ls(page, "skipped"));
    put(10, "카드 닫힘", await page.evaluate(() => !document.getElementById("overlay").classList.contains("show")));
    // 11: 다시 돌리기
    await page.evaluate(() => { window.__ev = []; });
    await page.click("#spin");
    await waitShow(page);
    const win3 = await page.textContent("#resultName");
    await page.evaluate(() => { window.__ev = []; });
    await page.click("#againBtn");
    put(11, "넘긴 메뉴(시드)", win3);
    put(11, "누른 직후 카드 닫힘", await page.evaluate(() => !document.getElementById("overlay").classList.contains("show")));
    put(11, "누른 직후 목록 태그", await tags(page));
    put(11, "저장된 skipped", await ls(page, "skipped"));
    await page.waitForTimeout(1500);
    const e3 = await ev(page), click = await page.evaluate(() => window.__againClick);
    const busyOn = e3.find(e => e.busy);
    put(11, "다시 돌리기 → 자동 회전까지(ms)", busyOn ? Math.round(busyOn.t - click) : null, 80);
    put(11, "자동 회전 중 목록 태그", await tags(page));
    await waitShow(page);
    put(11, "자동 회전 결과가 넘긴 메뉴와 다름", (await page.textContent("#resultName")) !== win3);
    put(11, "자동 회전 뒤 룰렛 글자 수", await page.evaluate(() => window.__texts.length));
    await page.click("#closeBtn");
    // 23: 새로고침 후 유지
    await page.reload({ waitUntil: "load" });
    await settle(page);
    put(23, "소리 버튼 문구", await page.textContent("#snd"));
    put(23, "상단 확정 글", await page.textContent("#today"));
    put(23, "목록 태그", await tags(page));
    put(23, "룰렛 글자 수(넘긴 메뉴 빠짐)", await page.evaluate(() => window.__texts.length));
    put(23, "저장된 history", await ls(page, "history"));
    put(23, "저장된 skipped", await ls(page, "skipped"));
    put(23, "저장된 sound", await ls(page, "sound"));
    errors.push(...page.errors);
    await ctx.close();
  }

  // ===== 시나리오 B: 입력창 (14·15·16·17·20) =====
  {
    const { ctx, page } = await open(browser, url);
    await settle(page);
    await page.focus("#addInput");
    await page.keyboard.type("a b");
    put(14, "입력칸 값", await page.inputValue("#addInput"));
    put(14, "스페이스로 회전이 시작되지 않음", await page.evaluate(() => !document.body.classList.contains("busy") && !document.getElementById("overlay").classList.contains("show")));
    await page.fill("#addInput", "");
    await page.keyboard.type("가".repeat(21));
    put(17, "maxlength 속성", await page.getAttribute("#addInput", "maxlength"));
    put(17, "21자 입력 후 길이", (await page.inputValue("#addInput")).length);
    await page.fill("#addInput", "");
    await add(page, "김치찌개");
    put(16, "중복 메시지", await page.textContent("#addMsg"));
    put(16, "개수 그대로", await page.textContent("#count"));
    await page.keyboard.type("x");
    put(16, "입력하면 메시지 지워짐", await page.textContent("#addMsg"));
    await page.fill("#addInput", "");
    await add(page, "가나다라마바사아자"); // 9자
    await add(page, "가나다라마바사아");   // 8자
    put(20, "목록에는 전체 이름", (await names(page)).slice(-2));
    put(20, "룰렛 글자(9자→7자+…, 8자 그대로)", (await page.evaluate(() => window.__texts)).slice(-2));
    put(20, "목록 title 속성", await page.$$eval("#list .name", l => l.slice(-2).map(x => x.title)));
    for (let i = 1; i <= 6; i++) await add(page, "메뉴" + i);
    put(15, "16개 채운 뒤 개수", await page.textContent("#count"));
    put(15, "16개 채운 뒤 메시지", await page.textContent("#addMsg"));
    await add(page, "열일곱째");
    put(15, "17번째 메시지", await page.textContent("#addMsg"));
    put(15, "17번째 시도 뒤 목록 수", (await names(page)).length);
    put(15, "17번째 시도 뒤 입력칸 값 그대로", await page.inputValue("#addInput"));
    put(15, "저장된 items 수", JSON.parse(await ls(page, "items")).length);
    errors.push(...page.errors);
    await ctx.close();
  }

  // ===== 시나리오 C: 삭제·되돌리기·초기화 (18·19) =====
  {
    const { ctx, page } = await open(browser, url);
    await settle(page);
    const before = await names(page);
    const toast = () => page.$eval("#toast", e => ({ text: e.textContent, display: getComputedStyle(e).display }));
    await page.click("#list li:nth-child(3) .x");
    const t = await toast();
    put(18, "알림 글", t.text); put(18, "알림 보임", t.display);
    put(18, "삭제 뒤 개수", await page.textContent("#count"));
    put(18, "x 버튼 title", await page.$eval("#list li .x", e => e.title));
    await page.waitForTimeout(4500);
    put(18, "4.5초 뒤 알림 보임", (await toast()).display);
    await page.waitForTimeout(900);
    put(18, "5.4초 뒤 알림 사라짐", (await toast()).display);
    // 되돌리기: 이번엔 4번째 줄
    const mid = await names(page);
    await page.click("#list li:nth-child(4) .x");
    await page.click("#toast button");
    put(18, "되돌리기 뒤 목록이 되돌리기 전과 같은 순서", JSON.stringify(await names(page)) === JSON.stringify(mid));
    put(18, "되돌리기 뒤 알림", (await toast()).display);
    put(18, "저장된 items 수", JSON.parse(await ls(page, "items")).length);
    // 되돌리기로 처음 삭제한 것도 복구(3번째 자리)
    await page.click("#list li:nth-child(1) .x");
    await page.click("#toast button");
    put(18, "첫 줄 삭제 후 되돌리면 첫 자리", (await names(page))[0]);
    // 19: 처음 메뉴로 되돌리기
    const msgs = [];
    page.on("dialog", async d => { msgs.push([d.type(), d.message()]); if (msgs.length === 1) await d.dismiss(); else await d.accept(); });
    await page.click("#resetBtn");
    put(19, "취소하면 그대로(개수)", await page.textContent("#count"));
    await page.click("#resetBtn");
    put(19, "확인하면 처음 8개", JSON.stringify(await names(page)) === JSON.stringify(DEFAULT8));
    put(19, "확인창 종류·문구", msgs);
    put(19, "확인 뒤 개수", await page.textContent("#count"));
    errors.push(...page.errors);
    await ctx.close();
  }

  // ===== 시나리오 D: 폭 860px (21) =====
  {
    const { ctx, page } = await open(browser, url, { viewport: { width: 390, height: 844 } });
    await settle(page);
    const m = () => page.evaluate(() => {
      const a = document.querySelector("aside").getBoundingClientRect(), w = document.getElementById("wheel").getBoundingClientRect();
      return { cols: getComputedStyle(document.body).gridTemplateColumns.split(" ").length, asideBelowWheel: a.top >= w.bottom - 1, asideLeft: Math.round(a.left), asideW: Math.round(a.width), wheelW: Math.round(w.width), wheelH: Math.round(w.height), noHScroll: document.documentElement.scrollWidth <= innerWidth, bodyOverflowY: getComputedStyle(document.body).overflowY };
    });
    put(21, "390px 배치", await m());
    await shot(page, "04-모바일390");
    await page.setViewportSize({ width: 860, height: 900 }); await page.waitForTimeout(300);
    put(21, "860px 열 수", (await m()).cols);
    await page.setViewportSize({ width: 861, height: 900 }); await page.waitForTimeout(300);
    put(21, "861px 열 수", (await m()).cols);
    errors.push(...page.errors);
    await ctx.close();
  }

  // ===== 시나리오 E: 움직임 줄이기 (22) =====
  {
    const { ctx, page } = await open(browser, url, { reducedMotion: "reduce" });
    await settle(page);
    put(22, "prefers-reduced-motion 적용", await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
    await page.click("#spin");
    await waitShow(page);
    put(22, "카드 애니메이션 이름", await page.$eval("#card", e => getComputedStyle(e).animationName));
    put(22, "카드 불투명도", await page.$eval("#card", e => getComputedStyle(e).opacity));
    const e = await ev(page);
    const t0 = e.find(x => x.busy).t, t1 = e.find(x => x.t > t0 && !x.busy).t;
    put(22, "회전 시간(ms, 줄이기 설정에서도 그대로)", Math.round(t1 - t0), 300);
    errors.push(...page.errors);
    await ctx.close();
  }
  put(0, "콘솔·페이지 오류", errors);
  return O;
}

const NAMES = {
  1: "첫 화면 기본 메뉴 8개", 2: "\"8 / 16\" 개수", 3: "돌리기 → 약 5초 회전", 4: "회전 중 패널 반투명·조작 불가", 5: "회전 중 버튼 비활성",
  6: "포인터 튕김", 7: "소리 켬 → 틱·차임", 8: "소리 기본 꺼짐, 버튼 문구", 9: "결과 카드·색종이", 10: "확정 → 상단 확정 글, 목록 태그",
  11: "다시 돌리기 → 오늘 넘김, 0.35초 뒤 자동 회전", 12: "닫기 → 저장 없음", 13: "스페이스바로 돌리기", 14: "입력칸에서 스페이스는 글자 입력",
  15: "17번째 추가 → 16개까지 안내", 16: "중복 → 이미 있는 메뉴", 17: "21자 입력 불가", 18: "삭제 → 5초 되돌리기 알림, 같은 자리로", 19: "처음 메뉴로 되돌리기 확인창 문구",
  20: "9자 이상 이름 7자+…", 21: "폭 860px 이하 세로 배치", 22: "움직임 줄이기 → 카드 애니메이션 없음", 23: "새로고침 후 기록·넘김·소리 유지", 0: "(참고) 콘솔·페이지 오류",
};

const same = (a, b, tol) => tol != null && typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= tol : JSON.stringify(a) === JSON.stringify(b);
const short = (v, n = 150) => { const s = JSON.stringify(v); return s.length > n ? s.slice(0, n) + "…" : s; };

const orig = await run(ORIG, "orig");
const neu = await run(NEW, "new");
await browser.close();

const rows = [], diffs = [];
for (const i of [...Array(23).keys()].map(x => x + 1).concat([0])) {
  const ks = [...new Set([...Object.keys(orig[i] || {}), ...Object.keys(neu[i] || {})])];
  const bad = [];
  for (const k of ks) {
    const a = orig[i]?.[k], b = neu[i]?.[k];
    if (!a || !b || !same(a.v, b.v, a.tol ?? b.tol)) bad.push({ k, orig: a?.v, new: b?.v });
  }
  const ok = bad.length === 0;
  rows.push({ i, name: NAMES[i], ok, n: ks.length, bad, sample: ks.slice(0, 4).map(k => `${k}=${short(neu[i]?.[k]?.v, 60)}`).join("; ") });
  if (!ok) diffs.push(...bad.map(b => ({ i, ...b })));
}
fs.writeFileSync(`${CAP}/D_result.json`, JSON.stringify({ orig, new: neu, rows }, null, 2));

const main = rows.filter(r => r.i >= 1);
const md = [];
md.push("# 0단계 동작 점검표 (시험 D)", "");
md.push(`- 실행: \`node tests/e2e/checklist.mjs\` (원본 = \`docs/reference/점심메뉴_룰렛.html\` 파일을 브라우저로 연 것, 새 화면 = \`http://localhost:8080/\`)`);
md.push("- 방법: 같은 절차를 두 화면에서 실행하고 관측값을 비교. 두 화면 모두 `Math.random`을 같은 시드(12345)로 고정해 같은 난수 순서를 받게 했고, AudioContext는 가짜로 바꿔 소리 호출(주파수·길이·볼륨)을 기록했다. 시간 값은 ms 단위 허용 오차가 있다(회전 ±300, 자동 회전 지연 ±80, 틱 횟수 ±8).");
md.push("- 항목별 관측값 전체는 `docs/design/0단계_캡처/D_result.json`, 화면 캡처는 `docs/design/0단계_캡처/D-*.png`.", "");
md.push(`**결과: ${main.filter(r => r.ok).length} / 23 항목 같음**`, "", "| # | 항목 | 결과 | 확인한 값(새 화면 기준, 일부) |", "|---|---|---|---|");
for (const r of main) md.push(`| ${r.i} | ${r.name} | ${r.ok ? "같음" : "**다름**"} | ${r.sample.replace(/\|/g, "\\|")} |`);
md.push("", `참고: 콘솔·페이지 오류 — 원본 ${short(orig[0]?.["콘솔·페이지 오류"]?.v)}, 새 화면 ${short(neu[0]?.["콘솔·페이지 오류"]?.v)}`);
if (diffs.length) {
  md.push("", "## 다른 점 상세", "", "| # | 관측 | 원본 | 새 화면 |", "|---|---|---|---|");
  for (const d of diffs) md.push(`| ${d.i} | ${d.k} | ${short(d.orig, 200).replace(/\|/g, "\\|")} | ${short(d.new, 200).replace(/\|/g, "\\|")} |`);
}
fs.writeFileSync("/workspace/apps/hanjan-roulette/tests/e2e/0단계_점검표.md", md.join("\n") + "\n");
console.log(main.map(r => `${String(r.i).padStart(2)} ${r.ok ? "같음" : "다름"}  ${r.name}`).join("\n"));
for (const d of diffs) console.log("DIFF", d.i, d.k, "orig=", short(d.orig, 200), "new=", short(d.new, 200));
console.log(`오류(원본/새) ${short(orig[0]?.["콘솔·페이지 오류"]?.v)} / ${short(neu[0]?.["콘솔·페이지 오류"]?.v)}`);
console.log(`시험 D: ${main.filter(r => r.ok).length}/23 같음`);
process.exit(main.every(r => r.ok) ? 0 : 1);
