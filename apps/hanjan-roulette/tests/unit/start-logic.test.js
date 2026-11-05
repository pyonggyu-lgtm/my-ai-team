import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanCodeInput, isFullCode, validateCreate, validateJoin, startErrorMessage, hasMovable, buildImport, importSummary, inviteLink, joinParam,
} from "../../client/js/start-logic.js";
import { TEMPLATES } from "../../client/js/templates.js";

test("초대 코드 입력 다듬기: 대문자·허용 글자만·6글자까지·전각 처리", () => {
  assert.equal(cleanCodeInput("abc-234"), "ABC234");
  assert.equal(cleanCodeInput(" a b c 2 3 4 5 6 "), "ABC234");
  assert.equal(cleanCodeInput("ＡＢＣ２３４"), "ABC234");
  assert.equal(cleanCodeInput("0O1IL"), "");        // 헷갈리는 글자는 지움
  assert.equal(cleanCodeInput("ABC가나234"), "ABC234");
  assert.equal(cleanCodeInput(undefined), "");
  assert.ok(isFullCode("ABC234"));
  assert.ok(!isFullCode("ABC23") && !isFullCode("ABC23O"));
});

test("그룹 만들기 검사: 빈칸·공백뿐·길이(20/10자)를 보내기 전에 막는다", () => {
  assert.equal(validateCreate({ name: "우리 팀", nickname: "민수" }), null);
  assert.deepEqual(validateCreate({ name: "", nickname: "민수" }), { field: "name", message: "그룹 이름을 써 주세요." });
  assert.equal(validateCreate({ name: "   ", nickname: "민수" }).field, "name");
  assert.equal(validateCreate({ name: "가".repeat(21), nickname: "민수" }).message, "그룹 이름은 20자까지 쓸 수 있어요.");
  assert.equal(validateCreate({ name: "가".repeat(20), nickname: "민수" }), null);
  assert.deepEqual(validateCreate({ name: "팀", nickname: " " }), { field: "nickname", message: "내 이름을 써 주세요." });
  assert.equal(validateCreate({ name: "팀", nickname: "나".repeat(11) }).message, "내 이름은 10자까지 쓸 수 있어요.");
  assert.equal(validateCreate({ name: "팀", nickname: "나".repeat(10) }), null);
  assert.equal(validateCreate({ name: "  가".padEnd(23, " "), nickname: "x" }), null); // 앞뒤 공백은 빼고 센다
  assert.equal(validateCreate({}).field, "name");
});

test("참여 검사: 코드 6글자·닉네임", () => {
  assert.equal(validateJoin({ code: "abc-234", nickname: "영희" }), null);
  assert.equal(validateJoin({ code: "ABC", nickname: "영희" }).field, "code");
  assert.equal(validateJoin({ code: "ABC234", nickname: "" }).message, "내 이름을 써 주세요.");
  assert.equal(validateJoin({ code: "ABC234", nickname: "나".repeat(11) }).field, "nickname");
});

test("오류 문구: 429 는 분 단위, 연결 안 됨, 코드 없음, 그 밖은 서버 문구 그대로", () => {
  assert.equal(startErrorMessage({ code: "RATE_LIMITED", retryAfterSec: 540 }, "join"), "너무 여러 번 시도했어요. 9분 뒤에 다시 해 주세요.");
  assert.equal(startErrorMessage({ code: "RATE_LIMITED", retryAfterSec: 20 }, "join"), "너무 여러 번 시도했어요. 1분 뒤에 다시 해 주세요.");
  assert.equal(startErrorMessage({ code: "RATE_LIMITED" }, "create"), "너무 여러 번 시도했어요. 잠시 뒤에 다시 해 주세요.");
  assert.equal(startErrorMessage({ code: "OFFLINE", message: "x" }, "create"), "연결이 안 돼요. 잠시 뒤에 다시 해 주세요.");
  assert.equal(startErrorMessage({ code: "NOT_FOUND", message: "없는 초대 코드예요." }, "join"), "초대 코드를 찾을 수 없어요. 다시 확인해 주세요.");
  assert.equal(startErrorMessage({ code: "VALIDATION", message: "서버가 준 문구" }, "create"), "서버가 준 문구");
});

const lunchBoard = (over = {}) => ({
  id: "b1", name: "점심", resultLead: "오늘 점심은", template: "lunch", excludeYesterday: true, sortOrder: 0,
  items: TEMPLATES.lunch.items.map((n, i) => ({ id: "i" + i, name: n, on: true })), ...over,
});

test("가져갈 것이 있는지: 처음 상태 그대로면 없음, 기록·두 번째 메뉴판·바뀐 메뉴가 있으면 있음", () => {
  const base = { boards: [lunchBoard()], history: { b1: [] } };
  assert.equal(hasMovable(base), false);
  assert.equal(hasMovable({ boards: [], history: {} }), false);
  assert.equal(hasMovable({ ...base, history: { b1: [{ date: "2026-11-04", name: "국밥" }] } }), true);
  assert.equal(hasMovable({ boards: [lunchBoard(), lunchBoard({ id: "b2" })], history: {} }), true);
  assert.equal(hasMovable({ boards: [lunchBoard({ items: lunchBoard().items.slice(1) })], history: {} }), true);
  assert.equal(hasMovable({ boards: [lunchBoard({ items: lunchBoard().items.map((i, k) => ({ ...i, on: k !== 0 })) })], history: {} }), true);
  assert.equal(hasMovable({ boards: [lunchBoard({ name: "저녁" })], history: {} }), true);
  assert.equal(hasMovable({ boards: [lunchBoard({ excludeYesterday: false })], history: {} }), true);
});

test("가져가기 데이터: 서버 모양, 오늘 이후·같은 날 중복 기록은 뺌, 최신순", () => {
  const state = {
    boards: [lunchBoard({ items: [{ id: "i", name: "국밥", on: false }] })],
    history: { b1: [
      { date: "2026-11-03", name: "A", nickname: "나", confirmedAt: "2026-11-03T03:00:00.000Z" },
      { date: "2026-11-05", name: "B", nickname: "", confirmedAt: "" },
      { date: "2026-11-06", name: "미래", nickname: "", confirmedAt: "" },
      { date: "2026-11-03", name: "중복", nickname: "", confirmedAt: "" },
    ] },
  };
  const out = buildImport(state, "2026-11-05");
  assert.deepEqual(out[0].items, [{ name: "국밥", on: false }]);
  assert.deepEqual(out[0].history.map(h => [h.date, h.name]), [["2026-11-05", "B"], ["2026-11-03", "A"]].map(([d, n]) => [d, n]));
  assert.equal(out[0].history[1].confirmedAt, "2026-11-03T03:00:00.000Z");
  assert.ok(!("confirmedAt" in out[0].history[0]));
  assert.equal(out[0].excludeYesterday, true);
  assert.ok(!("id" in out[0]) && !("sortOrder" in out[0]));
  assert.equal(importSummary(out), "메뉴판 1개, 기록 2일치를 그룹으로 옮겨요");
});

test("초대 링크와 ?join= 읽기", () => {
  assert.equal(inviteLink("https://hanjan.pygprg.com", "ABC234"), "https://hanjan.pygprg.com/?join=ABC234");
  assert.equal(joinParam("?join=abc234"), "ABC234");
  assert.equal(joinParam("?join=abc-23"), "ABC23");
  assert.equal(joinParam("?x=1"), null);
  assert.equal(joinParam(""), null);
});
