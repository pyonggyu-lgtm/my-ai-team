import { test } from "node:test";
import assert from "node:assert/strict";
import { todayKST, addDays } from "../../client/js/kst.js";

// TZ=Asia/Seoul / America/Los_Angeles / UTC 로 각각 돌려도 같아야 한다 (npm run test:tz)
test("todayKST: 한국 자정 직전/직후", () => {
  assert.equal(todayKST(new Date("2026-11-05T14:59:59Z")), "2026-11-05");
  assert.equal(todayKST(new Date("2026-11-05T15:00:00Z")), "2026-11-06");
});
test("todayKST: 연말·연초, 윤day 경계", () => {
  assert.equal(todayKST(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.equal(todayKST(new Date("2028-02-28T15:00:00Z")), "2028-02-29");
});
test("todayKST: 인자 없이 부르면 YYYY-MM-DD 모양", () => {
  assert.match(todayKST(), /^\d{4}-\d{2}-\d{2}$/);
});
test("addDays: 월·연 경계, 음수, 0", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(addDays("2026-11-05", 0), "2026-11-05");
  assert.equal(addDays("2026-11-05", -29), "2026-10-07");
});
test("addDays: 미국 서머타임 전환일을 지나도 하루씩 센다", () => {
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02");
});
