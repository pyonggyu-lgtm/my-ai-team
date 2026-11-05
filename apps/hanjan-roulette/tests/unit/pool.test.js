import { test } from "node:test";
import assert from "node:assert/strict";
import { yesterdayName, todayConfirmed, computePool, itemTag } from "../../client/js/pool.js";

const mk = (names, off = []) => names.map(n => ({ name: n, on: !off.includes(n) }));
const T = "2026-11-05";

test("켜진 메뉴 0개 → 막힘", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나"], ["가", "나"]), skippedNames: [], yesterday: null }),
    { pool: [], block: true, msg: "메뉴를 2개 이상 켜 주세요." });
});
test("켜진 메뉴 1개 → 막힘", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나"], ["나"]), skippedNames: [], yesterday: null }),
    { pool: [], block: true, msg: "메뉴를 2개 이상 켜 주세요." });
});
test("정상: 켜진 메뉴 전부, 문구 없음", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나", "다"]), skippedNames: [], yesterday: null }),
    { pool: ["가", "나", "다"], msg: "" });
});
test("어제 메뉴 제외", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나", "다"]), skippedNames: [], yesterday: "나" }),
    { pool: ["가", "다"], msg: "" });
});
test("넘김 제외", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나", "다"]), skippedNames: ["가"], yesterday: null }),
    { pool: ["나", "다"], msg: "" });
});
test("넘김+어제 둘 다 제외", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나", "다", "라"]), skippedNames: ["가"], yesterday: "나" }),
    { pool: ["다", "라"], msg: "" });
});
test("부족하면 어제 메뉴 다시 넣음", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나"]), skippedNames: [], yesterday: "나" }),
    { pool: ["가", "나"], msg: "메뉴가 부족해서 어제 메뉴도 넣었어요." });
});
test("1개만 남음 → single", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나", "다"]), skippedNames: ["가", "나"], yesterday: null }),
    { pool: ["다"], single: true, msg: "남은 메뉴가 이것뿐이에요." });
});
test("모두 넘김 → resetSkipped + 이어 붙는 문구(없음)", () => {
  const r = computePool({ items: mk(["가", "나", "다"]), skippedNames: ["가", "나", "다"], yesterday: null });
  assert.deepEqual(r, { pool: ["가", "나", "다"], msg: "모든 메뉴를 한 번씩 넘겨서 처음부터 다시 돌려요.", resetSkipped: true });
});
test("모두 넘김 + 어제 메뉴 → 이어 붙는 문구(어제 메뉴도 넣었어요)", () => {
  const r = computePool({ items: mk(["가", "나"]), skippedNames: ["가", "나"], yesterday: "나" });
  assert.deepEqual(r, {
    pool: ["가", "나"],
    msg: "모든 메뉴를 한 번씩 넘겨서 처음부터 다시 돌려요. 메뉴가 부족해서 어제 메뉴도 넣었어요.",
    resetSkipped: true,
  });
});
test("꺼진 메뉴는 넘김·어제 계산에서 무시", () => {
  const r = computePool({ items: mk(["가", "나", "다", "라"], ["라"]), skippedNames: ["라"], yesterday: "라" });
  assert.deepEqual(r, { pool: ["가", "나", "다"], msg: "" });
});
test("넘긴 이름이 꺼진 메뉴뿐이어도 켜진 쪽은 영향 없음(기본 8개 중 7개 넘김 → single)", () => {
  const items = mk(["a", "b", "c", "d", "e", "f", "g", "h"]);
  const r = computePool({ items, skippedNames: ["a", "b", "c", "d", "e", "f", "g"], yesterday: null });
  assert.deepEqual(r, { pool: ["h"], single: true, msg: "남은 메뉴가 이것뿐이에요." });
});
test("excludeYesterday:false → 어제 메뉴가 후보에 남음", () => {
  assert.deepEqual(computePool({ items: mk(["가", "나", "다"]), skippedNames: [], yesterday: "나", excludeYesterday: false }),
    { pool: ["가", "나", "다"], msg: "" });
});
test("computePool은 입력을 바꾸지 않음", () => {
  const sk = ["가", "나"]; const items = mk(["가", "나"]);
  computePool({ items, skippedNames: sk, yesterday: null });
  assert.deepEqual(sk, ["가", "나"]);
  assert.deepEqual(items, mk(["가", "나"]));
});

test("yesterdayName: 오늘 기록을 건너뜀", () => {
  const h = [{ date: "2026-11-03", name: "가" }, { date: "2026-11-04", name: "나" }, { date: T, name: "다" }];
  assert.equal(yesterdayName(h, T), "나");
});
test("yesterdayName: 기록 없음/오늘만 있음 → null", () => {
  assert.equal(yesterdayName([], T), null);
  assert.equal(yesterdayName([{ date: T, name: "가" }], T), null);
});
test("todayConfirmed", () => {
  assert.equal(todayConfirmed([{ date: "2026-11-04", name: "가" }, { date: T, name: "나" }], T), "나");
  assert.equal(todayConfirmed([{ date: "2026-11-04", name: "가" }], T), null);
  assert.equal(todayConfirmed([], T), null);
});

test("itemTag 우선순위: 확정 > 넘김 > 어제", () => {
  const ctx = { confirmed: "가", skippedNames: ["가", "나"], yesterday: "가" };
  assert.equal(itemTag({ name: "가", on: true }, ctx), "오늘 확정");
  assert.equal(itemTag({ name: "나", on: true }, ctx), "오늘 넘김");
  assert.equal(itemTag({ name: "다", on: true }, { ...ctx, yesterday: "다" }), "어제 먹음");
  assert.equal(itemTag({ name: "가", on: true }, { confirmed: null, skippedNames: ["가"], yesterday: "가" }), "오늘 넘김");
  assert.equal(itemTag({ name: "라", on: true }, ctx), "");
});
test("itemTag: 꺼진 메뉴는 태그 없음", () => {
  assert.equal(itemTag({ name: "가", on: false }, { confirmed: "가", skippedNames: ["가"], yesterday: "가" }), "");
});

// ---- 1단계 추가분: excludeYesterday:false ----
test("excludeYesterday:false → 어제 메뉴가 후보에 남는다", () => {
  const r = computePool({ items: mk(["가", "나", "다"]), skippedNames: [], yesterday: "나", excludeYesterday: false });
  assert.deepEqual(r, { pool: ["가", "나", "다"], msg: "" });
});
test("excludeYesterday:false → 어제 메뉴 때문에 '부족해서' 문구가 붙지 않는다", () => {
  const r = computePool({ items: mk(["가", "나"]), skippedNames: [], yesterday: "나", excludeYesterday: false });
  assert.deepEqual(r, { pool: ["가", "나"], msg: "" });
});
test("excludeYesterday:false → 태그 '어제 먹음'이 없다(yesterday:null을 넘기는 약속)", () => {
  const item = { name: "나", on: true };
  assert.equal(itemTag(item, { confirmed: null, skippedNames: [], yesterday: null }), "");
  assert.equal(itemTag(item, { confirmed: null, skippedNames: [], yesterday: "나" }), "어제 먹음"); // 켜진 메뉴판 대조
});
test("excludeYesterday:false 이고 모두 넘김 → 문구에 '어제' 안내 없음", () => {
  const r = computePool({ items: mk(["가", "나"]), skippedNames: ["가", "나"], yesterday: "나", excludeYesterday: false });
  assert.deepEqual(r, { pool: ["가", "나"], msg: "모든 메뉴를 한 번씩 넘겨서 처음부터 다시 돌려요.", resetSkipped: true });
});
