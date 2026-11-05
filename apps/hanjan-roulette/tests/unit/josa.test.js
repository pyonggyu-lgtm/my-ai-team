import { test } from "node:test";
import assert from "node:assert/strict";
import { withRo } from "../../client/js/josa.js";

test("withRo: 받침 없음 → 로", () => {
    assert.equal(withRo("피자"), "피자로");
  assert.equal(withRo("샐러드"), "샐러드로");
});
test("withRo: 받침 있음 → 으로", () => {
  assert.equal(withRo("국밥"), "국밥으로");
  assert.equal(withRo("짜장면"), "짜장면으로");
  assert.equal(withRo("김치찌개"), "김치찌개로");
  assert.equal(withRo("돈가스"), "돈가스로");
  assert.equal(withRo("족발·보쌈"), "족발·보쌈으로");
});
test("withRo: ㄹ 받침 → 로", () => {
  assert.equal(withRo("냉면집 달"), "냉면집 달로");
  assert.equal(withRo("칼"), "칼로");
  assert.equal(withRo("회식 술"), "회식 술로");
});
test("withRo: 한글이 아니면 (으)로, 빈 값도 안전", () => {
  assert.equal(withRo("KFC"), "KFC(으)로");
  assert.equal(withRo("3번"), "3번으로");
  assert.equal(withRo("A3"), "A3(으)로");
  assert.equal(withRo("🍕"), "🍕(으)로");
  assert.equal(withRo(""), "(으)로");
  assert.equal(withRo(undefined), "(으)로");
});
