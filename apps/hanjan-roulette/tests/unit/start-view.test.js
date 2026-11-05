// 시작 화면(views/start.js)·기록 창(views/history.js)의 G-2 동작 — 가짜 DOM 으로.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom } from "./_fakedom.js";
import { initStart } from "../../client/js/views/start.js";
import { initHistory } from "../../client/js/views/history.js";
import { cleanCodeInput, isOtherGroupLink, ALREADY_IN_GROUP } from "../../client/js/start-logic.js";

const local = { getState: async () => ({ today: "2026-11-05", boards: [], skipped: {}, history: {} }), getDevice: async () => ({}), getMode: async () => null };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

function setup(remote) {
  const dom = installFakeDom();
  const calls = { solo: 0, back: 0, entered: 0 };
  const view = initStart({ local, remote, onSolo: () => calls.solo++, onEntered: () => calls.entered++, onBack: () => calls.back++ });
  return { ...dom, view, calls };
}

test("[G-2①] 초대 코드 칸은 maxlength 20 — 붙여넣은 공백·하이픈이 잘리지 않고 6자로 정리된다", () => {
  const html = readFileSync(new URL("../../client/index.html", import.meta.url), "utf8");
  assert.match(html, /id="joinCode"[^>]*maxlength="20"/);
  assert.equal(cleanCodeInput(" KPSC3A "), "KPSC3A");
  assert.equal(cleanCodeInput("kps - c3a  "), "KPSC3A");
  assert.equal(cleanCodeInput("  K P S C 3 A  \n"), "KPSC3A");
});

test("[G-2③] 만들기·참여 요청 중에는 '혼자 쓰기'·'돌아가기'가 막히고(비활성 + 눌러도 무시), 끝나면 풀린다", async () => {
  let release;
  const remote = { createGroup: () => new Promise(r => { release = r; }), joinGroup: async () => ({ ok: true }), previewInvite: async () => ({ ok: true, groupName: "g", memberCount: 1 }) };
  const { el, view, calls } = setup(remote);
  await view.show({ mode: "create", canGoBack: true });
  el("createGroupName").value = "우리 팀"; el("createNick").value = "민수";
  el("createForm").onsubmit({ preventDefault() {} });
  await settle();
  assert.equal(el("soloBtn").disabled, true);
  assert.equal(el("startBackBtn").disabled, true);
  el("soloBtn").onclick(); el("startBackBtn").onclick();
  assert.equal(calls.solo + calls.back, 0, "요청 중에는 눌러도 아무 일도 없다");
  release({ ok: false, code: "VALIDATION", message: "안 돼요." });
  await settle();
  assert.equal(el("soloBtn").disabled, false);
  assert.equal(el("startBackBtn").disabled, false);
  el("soloBtn").onclick(); el("startBackBtn").onclick();
  assert.equal(calls.solo, 1); assert.equal(calls.back, 1);
});

test("[G-2③] 참여 요청 중에도 막힌다", async () => {
  let release;
  const remote = { joinGroup: () => new Promise(r => { release = r; }), previewInvite: async () => ({ ok: true, groupName: "g", memberCount: 1 }) };
  const { el, view, calls } = setup(remote);
  await view.show({ mode: "join", code: "KPSC3A", canGoBack: true });
  el("joinNick").value = "영희";
  el("joinForm").onsubmit({ preventDefault() {} });
  await settle();
  assert.equal(el("soloBtn").disabled, true);
  el("soloBtn").onclick(); el("startBackBtn").onclick();
  assert.equal(calls.solo + calls.back, 0);
  release({ ok: true });
  await settle();
  assert.equal(calls.entered, 1);
});

test("[G-2④] 미리 보기가 실패하면 같은 코드를 다시 넣어도 다시 시도한다(성공하면 다시 안 부른다)", async () => {
  let n = 0;
  const remote = {
    previewInvite: async () => (++n === 1 ? { ok: false, code: "NETWORK", message: "x" } : { ok: true, groupName: "회사", memberCount: 3 }),
  };
  const { el, view } = setup(remote);
  await view.show({ mode: "join", canGoBack: false });
  const type = v => { el("joinCode").value = v; el("joinCode").fire("input"); };
  type("KPSC3A"); await settle();
  assert.equal(n, 1);
  assert.match(el("joinMsg").textContent, /연결이 안 돼요/);
  type("KPSC3"); type("KPSC3A"); await settle(); // 지웠다 다시 넣지 않고
  assert.equal(n, 2, "같은 코드를 다시 입력 이벤트로 넣으면 다시 시도");
  assert.equal(el("joinGroupName").textContent, "회사");
  type("KPSC3A"); await settle();
  assert.equal(n, 2, "성공한 코드는 되풀이해 묻지 않는다(시도 제한 보호)");
});

test("[G-2④] 같은 코드가 그대로 남아 있어도 실패 뒤 다시 입력 이벤트가 오면 다시 시도한다", async () => {
  let n = 0;
  const remote = { previewInvite: async () => (++n === 1 ? { ok: false, code: "RATE_LIMITED", message: "x", retryAfterSec: 60 } : { ok: true, groupName: "회사", memberCount: 3 }) };
  const { el, view } = setup(remote);
  await view.show({ mode: "join", canGoBack: false });
  el("joinCode").value = "KPSC3A"; el("joinCode").fire("input"); await settle();
  assert.equal(n, 1);
  el("joinCode").fire("input"); await settle(); // 코드는 그대로
  assert.equal(n, 2);
});

test("[G-2②] 메뉴판이 0개면 '기록' 창을 열지 않는다(오류 없이)", async () => {
  const dom = installFakeDom();
  let boards = [];
  const store = { listHistory: async () => ({ entries: [], hasMore: false }), stats: async () => [] };
  initHistory({ store, getBoards: () => boards, getCurrentId: () => null, getToday: () => "2026-11-05" });
  const dlg = dom.el("historyDialog");
  await dom.el("historyBtn").fire("click");
  await settle();
  assert.equal(dlg.shown ?? 0, 0);
});

test("[G-2⑤] 이미 그룹인 기기로 다른 초대 링크를 열면 알린다 — 같은 그룹 링크·코드 없음은 조용히", () => {
  assert.equal(isOtherGroupLink("ZZZZ22", { inviteCode: "KPSC3A" }), true);
  assert.equal(isOtherGroupLink("kpsc3a", { inviteCode: "KPSC3A" }), false);
  assert.equal(isOtherGroupLink("", { inviteCode: "KPSC3A" }), false);
  assert.equal(isOtherGroupLink(null, { inviteCode: "KPSC3A" }), false);
  assert.equal(isOtherGroupLink("ZZZZ22", null), true, "그룹 정보를 모르면 안내");
  assert.equal(ALREADY_IN_GROUP, "이미 그룹에 들어 있어요. 다른 그룹에 들어가려면 그룹 설정에서 나가기를 먼저 해 주세요.");
});

test("[G-3②] 같은 코드의 input 이벤트가 다시 와도 이미 뜬 미리 보기를 숨기지 않고 다시 요청하지 않는다", async () => {
  let n = 0;
  const remote = { previewInvite: async () => { n++; return { ok: true, groupName: "회사", memberCount: 3 }; } };
  const { el, view } = setup(remote);
  await view.show({ mode: "join", canGoBack: false });
  el("joinCode").value = "KPSC3A"; el("joinCode").fire("input"); await settle();
  assert.equal(el("joinPreview").hidden, false);
  el("joinCode").value = " KPSC3A "; el("joinCode").fire("input"); await settle(); // 붙여넣기 뒤 같은 코드
  assert.equal(el("joinPreview").hidden, false);
  assert.equal(n, 1);
  assert.equal(el("joinCode").value, "KPSC3A");
});

test("[G-3⑤] 미리 보기 인원이 30명이면 '다 찼어요' 안내 + 참여 버튼 비활성, 다른 코드로 바꾸면 풀린다", async () => {
  const remote = { previewInvite: async c => ({ ok: true, groupName: "꽉 찬 방", memberCount: c === "KPSC3A" ? 30 : 5 }) };
  const { el, view } = setup(remote);
  await view.show({ mode: "join", canGoBack: false });
  el("joinCode").value = "KPSC3A"; el("joinCode").fire("input"); await settle();
  assert.equal(el("joinMsg").textContent, "이 그룹은 30명이 다 찼어요.");
  assert.equal(el("joinBtn").disabled, true);
  el("joinCode").value = "KPSC3"; el("joinCode").fire("input");
  assert.equal(el("joinBtn").disabled, false);
  assert.equal(el("joinMsg").textContent, "");
  el("joinCode").value = "ZZZZZ2"; el("joinCode").fire("input"); await settle();
  assert.equal(el("joinBtn").disabled, false);
  assert.equal(el("joinGroupCount").textContent, "지금 5명이 함께 있어요");
});

test("[G-3⑤] 29명이면 참여할 수 있다", async () => {
  const remote = { previewInvite: async () => ({ ok: true, groupName: "g", memberCount: 29 }) };
  const { el, view } = setup(remote);
  await view.show({ mode: "join", canGoBack: false });
  el("joinCode").value = "KPSC3A"; el("joinCode").fire("input"); await settle();
  assert.equal(el("joinBtn").disabled, false);
});

test("[G-4ⓐ] 참여 탭을 코드와 함께 열 때 안내 문구는 코드를 채운 뒤에 남는다", async () => {
  const remote = { previewInvite: async () => ({ ok: true, groupName: "회사", memberCount: 3 }) };
  const { el, view } = setup(remote);
  await view.show({ mode: "join", code: "kpsc3a", canGoBack: false, notice: "그룹에서 나갔거나 연결 정보가 사라졌어요. 다시 참여해 주세요." });
  assert.equal(el("joinCode").value, "KPSC3A");
  assert.equal(el("joinMsg").textContent, "그룹에서 나갔거나 연결 정보가 사라졌어요. 다시 참여해 주세요.");
});
