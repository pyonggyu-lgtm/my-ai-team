import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceHistory, countByName, pageBefore, loadNextPage } from "../../client/js/records.js";
import { addDays } from "../../client/js/kst.js";

const T = "2026-11-05";
const e = (date, name = "가") => ({ date, name, nickname: "", confirmedAt: "" });
const days = (n, name = "가") => Array.from({ length: n }, (_, i) => e(addDays(T, -i), name)); // 오늘부터 과거로 n일

test("sliceHistory: 빈 기록", () => {
  assert.deepEqual(sliceHistory([], T), { entries: [], hasMore: false, oldest: null });
});
test("sliceHistory: 최신순, 기본 30일 (today-29 ~ today)", () => {
  const r = sliceHistory(days(40).reverse(), T); // 오름차순으로 넣어도
  assert.equal(r.entries.length, 30);
  assert.equal(r.entries[0].date, T);
  assert.equal(r.entries[29].date, addDays(T, -29));
  assert.equal(r.hasMore, true);
});
test("sliceHistory: 정확히 30일치면 hasMore false", () => {
  const r = sliceHistory(days(30), T);
  assert.equal(r.entries.length, 30);
  assert.equal(r.hasMore, false);
});
test("sliceHistory: before 이전 30일씩 이어서(더 보기)", () => {
  const all = days(70);
  const p1 = sliceHistory(all, T);
  const p2 = sliceHistory(all, T, { before: p1.entries.at(-1).date });
  assert.equal(p2.entries.length, 30);
  assert.equal(p2.entries[0].date, addDays(T, -30));
  assert.equal(p2.hasMore, true);
  const p3 = sliceHistory(all, T, { before: p2.entries.at(-1).date });
  assert.equal(p3.entries.length, 10);
  assert.equal(p3.hasMore, false);
});
test("sliceHistory: before는 포함하지 않는다 / 미래 날짜는 기본 범위 밖", () => {
  const r = sliceHistory([e(T), e(addDays(T, 1))], T);
  assert.deepEqual(r.entries.map(x => x.date), [T]);
  const r2 = sliceHistory([e(T), e(addDays(T, -1))], T, { before: T });
  assert.deepEqual(r2.entries.map(x => x.date), [addDays(T, -1)]);
});
test("sliceHistory: days 지정, 입력 배열을 바꾸지 않음", () => {
  const input = days(10);
  const copy = JSON.stringify(input);
  assert.equal(sliceHistory(input, T, { days: 7 }).entries.length, 7);
  assert.equal(JSON.stringify(input), copy);
});

test("countByName: 30일 범위는 today-29부터 (경계)", () => {
  const entries = [e(addDays(T, -29), "가"), e(addDays(T, -30), "가"), e(T, "나")];
  assert.deepEqual(countByName(entries, T, 30), [{ name: "가", count: 1 }, { name: "나", count: 1 }]);
});
test("countByName: 30·90·all 집계", () => {
  const entries = [e(T, "가"), e(addDays(T, -10), "가"), e(addDays(T, -40), "나"),
    e(addDays(T, -89), "나"), e(addDays(T, -90), "다"), e(addDays(T, -200), "다")];
  assert.deepEqual(countByName(entries, T, 30), [{ name: "가", count: 2 }]);
  assert.deepEqual(countByName(entries, T, 90), [{ name: "가", count: 2 }, { name: "나", count: 2 }]);
  assert.deepEqual(countByName(entries, T, "all"),
    [{ name: "가", count: 2 }, { name: "나", count: 2 }, { name: "다", count: 2 }]);
});
test("countByName: 횟수 내림차순 → 같으면 가나다순", () => {
  const entries = [e(T, "치킨"), e(addDays(T, -1), "국밥"), e(addDays(T, -2), "국밥"),
    e(addDays(T, -3), "가츠동"), e(addDays(T, -4), "피자")];
  assert.deepEqual(countByName(entries, T, 30).map(x => x.name), ["국밥", "가츠동", "치킨", "피자"]);
});
test("countByName: 기록 없음, 오늘보다 미래 기록은 30/90에서 제외", () => {
  assert.deepEqual(countByName([], T, "all"), []);
  assert.deepEqual(countByName([e(addDays(T, 1))], T, 30), []);
});

// ---- 더 보기: 30일 묶음 창 계산 / 빈 구간 건너뛰기 ----
const fetchFor = entries => async a => sliceHistory(entries, T, a);
const ago = (...ns) => ns.map(n => e(addDays(T, -n)));

test("pageBefore: pages=0 은 기본(내일), 1 이면 29일 전, 2 이면 59일 전", () => {
  assert.equal(pageBefore(T, 0), addDays(T, 1));
  assert.equal(pageBefore(T, 1), addDays(T, -29));
  assert.equal(pageBefore(T, 2), addDays(T, -59));
});
test("loadNextPage: 연속 기록은 30일씩 이어 붙는다", async () => {
  const all = days(70);
  const p1 = await loadNextPage(fetchFor(all), T, 1);
  assert.equal(p1.entries.length, 30); assert.equal(p1.pages, 2); assert.equal(p1.hasMore, true);
  assert.equal(p1.entries[0].date, addDays(T, -30));
  const p2 = await loadNextPage(fetchFor(all), T, p1.pages);
  assert.equal(p2.entries.length, 10); assert.equal(p2.hasMore, false);
});
test("재현①: 40·70일 전 기록만 → 첫 화면은 비어 있고(hasMore), 더 보기가 빈 구간을 건너뛴다", async () => {
  const all = ago(40, 70);
  const first = sliceHistory(all, T);
  assert.deepEqual([first.entries.length, first.hasMore], [0, true]);
  const n1 = await loadNextPage(fetchFor(all), T, 1);       // 30~59일 전 → 40일 전
  assert.deepEqual(n1.entries.map(x => x.date), [addDays(T, -40)]);
  assert.equal(n1.hasMore, true); assert.equal(n1.pages, 2);
  const n2 = await loadNextPage(fetchFor(all), T, n1.pages); // 60~89일 전 → 70일 전
  assert.deepEqual(n2.entries.map(x => x.date), [addDays(T, -70)]);
  assert.equal(n2.hasMore, false);
});
test("재현①: 첫 묶음이 비면 pages=1 에서 시작한 loadNextPage 가 처음 기록을 찾아낸다", async () => {
  const n = await loadNextPage(fetchFor(ago(70)), T, 1);     // 30~59 비어 있음 → 60~89 에서 발견
  assert.deepEqual(n.entries.map(x => x.date), [addDays(T, -70)]);
  assert.deepEqual([n.pages, n.hasMore], [3, false]);
});
test("재현②: 오늘·5·45·50·100일 전 → 더 보기를 누를 때마다 다음 기록 묶음, 빠짐없이 모두", async () => {
  const all = ago(0, 5, 45, 50, 100);
  const seen = [];
  let cur = sliceHistory(all, T);
  seen.push(...cur.entries);
  assert.equal(cur.entries.length, 2); assert.equal(cur.hasMore, true);
  let pages = 1, hasMore = cur.hasMore, clicks = 0;
  while (hasMore) {
    const nx = await loadNextPage(fetchFor(all), T, pages);
    seen.push(...nx.entries); pages = nx.pages; hasMore = nx.hasMore; clicks++;
    assert.ok(nx.entries.length > 0, "더 보기를 눌렀는데 아무것도 안 나오면 안 된다");
  }
  assert.equal(clicks, 2);   // 45·50일 전 묶음, 100일 전 묶음
  assert.deepEqual(seen.map(x => x.date), [0, 5, 45, 50, 100].map(n => addDays(T, -n)));
});
test("loadNextPage: 더 오래된 기록이 없으면 빈 결과로 끝난다(무한 반복 없음)", async () => {
  const r = await loadNextPage(fetchFor(days(3)), T, 1);
  assert.deepEqual([r.entries.length, r.hasMore], [0, false]);
  const r2 = await loadNextPage(fetchFor([]), T, 5);
  assert.deepEqual([r2.entries.length, r2.hasMore], [0, false]);
});

// ---- 깨진 기록·무한 반복 방지 ----
test("sliceHistory·countByName: 형식이 틀린 date/name 은 무시(hasMore 도 계산에서 제외)", () => {
  const bad = [{ date: "", name: "x" }, { date: "2026-1-5", name: "x" }, { date: "2026-10-01", name: 3 }, null];
  const r = sliceHistory([e(T), ...bad], T);
  assert.deepEqual([r.entries.length, r.hasMore, r.oldest], [1, false, T]);
  assert.deepEqual(countByName([e(T, "가"), ...bad], T, "all"), [{ name: "가", count: 1 }]);
});
test("loadNextPage: 깨진 date 가 섞여 있어도 끝난다(sliceHistory 기준)", async () => {
  const all = [...ago(70), { date: "", name: "깨짐" }];
  const r1 = await loadNextPage(fetchFor(all), T, 1);
  assert.deepEqual([r1.entries.length, r1.hasMore], [1, false]);
});
test("loadNextPage 상한 ①: oldest 보다 앞서면 멈춘다(hasMore 만 거짓으로 참인 응답)", async () => {
  let calls = 0;
  const liar = async () => { calls++; return { entries: [], hasMore: true, oldest: "2026-01-01" }; };
  const r = await loadNextPage(liar, T, 1);
  assert.deepEqual([r.entries.length, r.hasMore], [0, false]);
  assert.ok(calls < 20, "calls=" + calls);
});
test("loadNextPage 상한 ②: oldest 도 모르는 거짓 응답은 maxPages 에서 멈춘다", async () => {
  let calls = 0;
  const liar = async () => { calls++; return { entries: [], hasMore: true }; };
  const r = await loadNextPage(liar, T, 1, 30, 50);
  assert.deepEqual([r.entries.length, r.hasMore], [0, false]);
  assert.equal(calls, 49);
});
