import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate } from "../../client/js/views/history.js";

test("formatDate: 올해는 'M월 D일 (요일)'", () => {
  assert.equal(formatDate("2026-11-05", "2026-11-05"), "11월 5일 (목)");
  assert.equal(formatDate("2026-01-01", "2026-11-05"), "1월 1일 (목)");
});
test("formatDate: 올해가 아니면 연도를 붙인다", () => {
  assert.equal(formatDate("2025-12-31", "2026-11-05"), "2025년 12월 31일 (수)");
});
test("formatDate: 요일은 시간대와 상관없다(윤일 포함)", () => {
  assert.equal(formatDate("2028-02-29", "2028-03-01"), "2월 29일 (화)");
  assert.equal(formatDate("2026-11-08", "2026-11-09"), "11월 8일 (일)");
});
