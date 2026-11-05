import { test } from "node:test";
import assert from "node:assert/strict";
import { createRemoteStore } from "../../client/js/store-remote.js";
import { yesterdayName, todayConfirmed } from "../../client/js/pool.js";
import { fakeStorage, fakeIo, fakeTarget, fakeServer, fakeTimers, settle } from "./_fakes.js";

const SIGNED_IN = { token: "tok1", groupId: "g1", memberId: "m1", sound: true, nickname: "하나" };

// 로그인된 기기 + 가짜 서버·소켓. connect=true 면 소켓까지 붙여 둔다.
async function setup({ connect = true, device = SIGNED_IN, storage, server = fakeServer(), target = fakeTarget(), now = "2026-11-05T03:00:00.000Z", timers } = {}) {
  const st = storage ?? fakeStorage({ "hanjan.v1.device": JSON.stringify(device) });
  const io = fakeIo();
  const clock = { t: now };
  const store = createRemoteStore({
    storage: st, io, target, fetchFn: server.fetch, now: () => new Date(clock.t),
    retryDelays: [], sleep: async () => {}, timers: timers ?? { setTimeout: () => 1, clearTimeout: () => {} },
  });
  const events = [];
  store.subscribe(e => events.push(e));
  const conn = [];
  store.onConnection(o => conn.push(o));
  await store.start();
  await settle();
  const sock = io.last();
  if (connect) { sock.serverConnect(); await settle(); }
  return { store, server, io, sock, st, events, conn, target, clock };
}
const types = events => events.map(e => e.type);
const calls = (server, method, path) => server.calls.filter(c => c.method === method && c.path === path);

test("로그인이 없으면 start 는 아무것도 열지 않는다", async () => {
  const io = fakeIo();
  const store = createRemoteStore({ storage: fakeStorage(), io, target: fakeTarget(), fetchFn: async () => { throw new Error("호출 금지"); } });
  assert.deepEqual(await store.start(), { signedIn: false });
  assert.equal(io.sockets.length, 0);
  assert.equal(store.isOnline(), false);
});

test("접속: auth 는 함수형(재연결 때마다 토큰·그룹을 새로 보냄), 연결되면 GET /state 후 온라인", async () => {
  const { store, sock, server, conn } = await setup();
  let sent;
  sock.opts.auth(a => { sent = a; });
  assert.deepEqual(sent, { token: "tok1", groupId: "g1" });
  assert.equal(typeof sock.opts.connectionStateRecovery, "undefined");
  assert.equal(calls(server, "GET", "/api/groups/g1/state").length >= 1, true);
  assert.equal(store.isOnline(), true);
  assert.deepEqual(conn, [true]);
  assert.equal(calls(server, "GET", "/api/groups/g1/state")[0].auth, "Bearer tok1");
});

test("getState 는 1단계 모양: items 는 on, skipped·history 는 메뉴판 id 별", async () => {
  const server = fakeServer();
  server.board.confirmed = { name: "국밥", nickname: "둘", confirmedAt: "2026-11-05T01:00:00.000Z" };
  server.board.yesterday = "돈가스";
  server.board.skipped = ["짜장면"];
  server.board.items[1].isOn = false;
  const { store } = await setup({ server });
  const s = await store.getState();
  assert.deepEqual(Object.keys(s).sort(), ["boards", "history", "skipped", "today"]);
  assert.equal(s.today, "2026-11-05");
  const b = s.boards[0];
  assert.deepEqual(b.items.map(i => [i.name, i.on]), [["국밥", true], ["돈가스", false], ["짜장면", true]]);
  assert.ok(!("isOn" in b.items[0]));
  assert.deepEqual(s.skipped.b1, ["짜장면"]);
  // 화면(app.js)이 쓰는 계산이 그대로 돌아간다
  assert.equal(todayConfirmed(s.history.b1, s.today), "국밥");
  assert.equal(yesterdayName(s.history.b1, s.today), "돈가스");
  assert.equal(b.resultLead, "오늘 점심은");
});

test("rev 규칙: 오래된·같은 rev 는 무시, 큰 rev 만 갈아 끼움, 같은 이벤트 두 번 와도 안전", async () => {
  const { store, sock, server, events } = await setup();
  const base = server.view();
  const newer = { ...base, rev: base.rev + 2, skipped: ["짜장면"] };
  const older = { ...base, rev: base.rev + 1, skipped: ["국밥"] };
  events.length = 0;
  sock.fire("board:updated", { board: newer, eventId: "e1" });
  sock.fire("board:updated", { board: older, eventId: "e2" });                   // 오래된 이벤트(순서 꼬임)
  sock.fire("board:updated", { board: newer, eventId: "e1" });                   // 같은 이벤트 중복
  sock.fire("board:updated", { board: { ...newer, skipped: ["돈가스"] }, eventId: "e3" }); // rev 가 같음
  assert.deepEqual((await store.getState()).skipped.b1, ["짜장면"]);
  assert.deepEqual(types(events), ["changed"]);
});

test("새 메뉴판 생성·삭제·순서 이벤트 반영", async () => {
  const { store, sock, server, events } = await setup();
  const b2 = { ...server.view(), id: "b2", name: "저녁", sortOrder: 1, rev: 1 };
  sock.fire("board:created", { board: b2, eventId: "c1" });
  assert.deepEqual((await store.getState()).boards.map(b => b.id), ["b1", "b2"]);
  sock.fire("boards:reordered", { boardIds: ["b2", "b1"], eventId: "c2" });
  assert.deepEqual((await store.getState()).boards.map(b => [b.id, b.sortOrder]), [["b2", 0], ["b1", 1]]);
  sock.fire("board:deleted", { boardId: "b2", eventId: "c3", by: { memberId: "m9" } });
  assert.deepEqual((await store.getState()).boards.map(b => b.id), ["b1"]);
  assert.ok(events.some(e => e.type === "boardDeleted" && e.boardId === "b2" && e.byMe === false));
});

test("남이 확정하면 confirmedByOther 알림, 내가 한 확정은 알리지 않음", async () => {
  const { sock, events } = await setup();
  const entry = { date: "2026-11-05", name: "국밥", nickname: "둘", confirmedAt: "x" };
  sock.fire("history:confirmed", { boardId: "b1", entry, replaced: null, by: { memberId: "m2", nickname: "둘" }, eventId: "h1" });
  sock.fire("history:confirmed", { boardId: "b1", entry, replaced: null, by: { memberId: "m2", nickname: "둘" }, eventId: "h1" });
  sock.fire("history:confirmed", { boardId: "b1", entry, replaced: null, by: { memberId: "m1", nickname: "하나" }, eventId: "h2" });
  const got = events.filter(e => e.type === "confirmedByOther");
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].entry, entry);
  assert.equal(got[0].by.nickname, "둘");
});

test("멤버 참여·나감 이벤트, 내가 나가졌으면 signedOut", async () => {
  const { store, sock, st, events, server } = await setup();
  const two = { id: "m2", nickname: "둘", isOwner: false, joinedAt: "x" };
  sock.fire("member:joined", { member: two, eventId: "j1" });
  sock.serverDrop(); await settle(); // 끊긴 동안은 받아 둔 목록을 보여 준다
  assert.deepEqual((await store.listMembers()).map(m => m.nickname), ["하나", "둘"]);
  sock.fire("member:left", { member: { id: "m2", nickname: "둘" }, eventId: "l1" });
  assert.deepEqual((await store.listMembers()).map(m => m.nickname), ["하나"]);
  void server;
  sock.fire("member:left", { member: { id: "m1", nickname: "하나" }, eventId: "l2" });
  assert.ok(types(events).includes("signedOut"));
  assert.ok(!JSON.parse(st.getItem("hanjan.v1.device")).token);
});

test("day:changed 를 받으면 GET /state 를 다시 받는다", async () => {
  const { sock, server } = await setup();
  const n = calls(server, "GET", "/api/groups/g1/state").length;
  server.today = "2026-11-06"; server.board.confirmed = null; server.bump();
  sock.fire("day:changed", { today: "2026-11-06", eventId: "d1" });
  await settle();
  assert.equal(calls(server, "GET", "/api/groups/g1/state").length, n + 1);
});

// ───── 오프라인 편집 거부 ─────
test("연결이 없으면(소켓 미접속·끊김·브라우저 offline) 메뉴·메뉴판 편집은 OFFLINE", async () => {
  const OFF = { ok: false, code: "OFFLINE", message: "연결되면 바꿀 수 있어요." };
  const { store, sock, server, target } = await setup({ connect: false });
  const all = s => Promise.all([
    s.createBoard({ name: "새" }), s.updateBoard("b1", { name: "x" }), s.deleteBoard("b1"), s.reorderBoards(["b1"]),
    s.addItem("b1", "새메뉴"), s.setItemOn("b1", "i0", false), s.removeItem("b1", "i0"), s.resetBoard("b1"),
  ]);
  for (const r of await all(store)) assert.deepEqual(r, OFF);
  sock.serverConnect(); await settle();
  assert.equal((await store.setItemOn("b1", "i0", false)).ok, true);
  sock.serverDrop(); await settle();
  for (const r of await all(store)) assert.deepEqual(r, OFF);
  sock.serverConnect(); await settle();
  target.navigator.onLine = false; // false 는 믿는다
  for (const r of await all(store)) assert.deepEqual(r, OFF);
  // 거부된 편집은 서버에 아무것도 보내지 않았다
  assert.equal(server.calls.filter(c => ["POST", "PATCH", "DELETE", "PUT"].includes(c.method)).length, 1);
});

test("요청이 네트워크 오류로 실패하면 오프라인으로 보고 이후 편집을 거부(자동 재시도·대기열 없음)", async () => {
  const { store, server } = await setup();
  server.down = true;
  assert.equal((await store.addItem("b1", "새메뉴")).code, "OFFLINE");
  assert.equal(store.isOnline(), false);
  assert.equal(store.pendingCount(), 0);
  assert.equal(calls(server, "POST", "/api/boards/b1/items").length, 1);
});

test("온라인 편집: 1단계와 같은 반환 모양(item/index/board)과 검사 메시지", async () => {
  const { store, server } = await setup();
  const a = await store.addItem("b1", "  떡볶이 ", 1);
  assert.deepEqual([a.ok, a.item.name, a.item.on], [true, "떡볶이", true]);
  assert.equal(calls(server, "POST", "/api/boards/b1/items")[0].body.sortOrder, 1);
  assert.deepEqual((await store.getState()).boards[0].items.map(i => i.name), ["국밥", "떡볶이", "돈가스", "짜장면"]);
  const rm = await store.removeItem("b1", a.item.id);
  assert.deepEqual([rm.ok, rm.item.name, rm.index], [true, "떡볶이", 1]);
  assert.deepEqual(await store.addItem("b1", "국밥"), { ok: false, code: "DUPLICATE", message: "이미 있는 메뉴예요." });
  assert.equal((await store.addItem("b1", "")).code, "EMPTY");
  assert.equal((await store.addItem("b1", "가".repeat(21))).code, "NAME_TOO_LONG");
  assert.equal((await store.addItem("zzz", "x")).code, "NOT_FOUND");
  assert.equal((await store.setItemOn("b1", "nope", true)).code, "NOT_FOUND");
  assert.equal((await store.deleteBoard("b1")).code, "LAST_BOARD");
  assert.equal((await store.updateBoard("b1", { name: "" })).code, "EMPTY_NAME");
  assert.equal((await store.updateBoard("b1", { resultLead: "가".repeat(21) })).code, "LEAD_TOO_LONG");
});

// ───── 확정·대기열 ─────
test("연결돼 있으면 확정은 바로 간다(date 는 안 보냄), 409 는 ALREADY_CONFIRMED + existing", async () => {
  const { store, server } = await setup();
  const r = await store.confirm("b1", "국밥");
  assert.equal(r.ok, true);
  assert.equal(r.queued, undefined);
  assert.deepEqual(calls(server, "POST", "/api/boards/b1/history")[0].body, { name: "국밥", overwrite: false });
  assert.equal(todayConfirmed((await store.getState()).history.b1, "2026-11-05"), "국밥");
  // 누군가 먼저 확정
  const s2 = fakeServer(); s2.setConfirmed("돈가스", "둘");
  const o = await setup({ server: s2 });
  const lose = await o.store.confirm("b1", "국밥");
  assert.equal(lose.ok, false);
  assert.equal(lose.code, "ALREADY_CONFIRMED");
  assert.deepEqual(lose.existing, { name: "돈가스", nickname: "둘", confirmedAt: "2026-11-05T01:00:00.000Z" });
  assert.equal(o.store.pendingCount(), 0);
  const win = await o.store.confirm("b1", "국밥", { overwrite: true });
  assert.equal(win.ok, true);
  assert.equal(calls(s2, "POST", "/api/boards/b1/history").at(-1).body.overwrite, true);
});

test("끊김 중 쌓기: 확정·넘김이 대기열에 들어가고 화면에는 바로 보인다 → 재연결되면 들어간 순서대로 하나씩", async () => {
  const { store, sock, server, events } = await setup();
  sock.serverDrop(); await settle();
  assert.equal(store.isOnline(), false);
  const a = await store.addSkip("b1", "짜장면");
  const b = await store.confirm("b1", "국밥");
  const c = await store.clearSkip("b1");
  assert.deepEqual([a, b, c].map(r => [r.ok, r.queued]), [[true, true], [true, true], [true, true]]);
  assert.equal(store.pendingCount(), 3);
  const s = await store.getState();
  assert.deepEqual(s.skipped.b1, []);
  assert.equal(todayConfirmed(s.history.b1, s.today), "국밥");
  assert.equal(server.calls.filter(x => x.method !== "GET").length, 0, "끊긴 동안은 아무것도 안 보냄");

  const before = server.calls.length;
  sock.serverConnect(); await settle(12);
  const writes = server.calls.slice(before).filter(x => x.method !== "GET").map(x => `${x.method} ${x.path}`);
  assert.deepEqual(writes, ["POST /api/boards/b1/skipped", "POST /api/boards/b1/history", "DELETE /api/boards/b1/skipped"]);
  assert.deepEqual(server.calls.slice(before).find(x => x.path.endsWith("/history") && x.method === "POST").body,
    { name: "국밥", overwrite: false, date: "2026-11-05" }); // 누른 날짜 포함
  assert.equal(store.pendingCount(), 0);
  assert.ok(!types(events).includes("conflict"));
  assert.equal(server.board.confirmed.name, "국밥");
});

test("대기열이 있는 동안 새 확정도 줄 뒤에 선다(순서 유지)", async () => {
  const { store, sock, server } = await setup();
  sock.serverDrop(); await settle();
  await store.addSkip("b1", "짜장면");
  sock.connected = true; sock.fire("connect"); // 연결 직후 flush 가 도는 중
  const r = await store.confirm("b1", "국밥");
  await settle(12);
  assert.equal(r.ok, true);
  const order = server.calls.filter(x => x.method === "POST").map(x => x.path);
  assert.deepEqual(order, ["/api/boards/b1/skipped", "/api/boards/b1/history"]);
});

test("직접 보내다 네트워크 오류가 나면 대기열에 들어가고, 되살아나면 보낸다", async () => {
  const { store, sock, server } = await setup();
  server.failNext.push(() => { throw new TypeError("끊김"); });
  const r = await store.confirm("b1", "국밥");
  assert.deepEqual([r.ok, r.queued], [true, true]);
  assert.equal(store.pendingCount(), 1);
  sock.serverDrop(); await settle();
  sock.serverConnect(); await settle(12);
  assert.equal(store.pendingCount(), 0);
  assert.equal(server.board.confirmed.name, "국밥");
});

test("그사이 남이 확정했으면 409 → 멈추고 conflict 신호 {boardId, existing, pending}, 뒤 항목은 보내지 않음", async () => {
  const { store, sock, server, events } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "국밥");
  await store.addSkip("b1", "짜장면");
  server.setConfirmed("돈가스", "둘"); // 오프라인 동안 B 가 확정
  const before = server.calls.length;
  events.length = 0;
  sock.serverConnect(); await settle(12);
  const c = events.find(e => e.type === "conflict");
  assert.ok(c);
  assert.equal(c.boardId, "b1");
  assert.deepEqual(c.existing, { name: "돈가스", nickname: "둘", confirmedAt: "2026-11-05T01:00:00.000Z" });
  assert.deepEqual(c.pending, { name: "국밥", date: "2026-11-05" });
  assert.equal(events.filter(e => e.type === "conflict").length, 1, "같은 충돌을 한 번만 알림");
  assert.equal(store.pendingCount(), 2);
  assert.equal(server.calls.slice(before).filter(x => x.method === "POST").length, 1, "충돌에서 멈춤");

  // "바꾸기"
  await store.resolveConflict(true);
  await settle(12);
  assert.equal(server.board.confirmed.name, "국밥");
  assert.deepEqual(calls(server, "POST", "/api/boards/b1/history").at(-1).body, { name: "국밥", overwrite: true, date: "2026-11-05" });
  assert.equal(store.pendingCount(), 0);
  assert.ok(calls(server, "POST", "/api/boards/b1/skipped").length >= 1, "뒤 항목도 이어서 보냄");
});

test("충돌에서 '그대로 두기'면 그 확정만 버리고 나머지를 보낸다", async () => {
  const { store, sock, server } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "국밥");
  await store.addSkip("b1", "짜장면");
  server.setConfirmed("돈가스", "둘");
  sock.serverConnect(); await settle(12);
  await store.resolveConflict(false);
  await settle(12);
  assert.equal(server.board.confirmed.name, "돈가스");
  assert.equal(store.pendingCount(), 0);
  assert.equal(calls(server, "POST", "/api/boards/b1/history").length, 1);
});

test("오래된 날짜(400)는 그 항목을 버리고 dropped 알림, 다음 항목은 계속", async () => {
  const { store, sock, server, events } = await setup({ now: "2026-11-05T03:00:00.000Z" });
  sock.serverDrop(); await settle();
  await store.confirm("b1", "옛날", { date: "2026-10-01" });
  await store.confirm("b1", "국밥");
  events.length = 0;
  sock.serverConnect(); await settle(12);
  const d = events.find(e => e.type === "dropped");
  assert.ok(d);
  assert.equal(d.reason, "VALIDATION");
  assert.equal(d.item.name, "옛날");
  assert.equal(store.pendingCount(), 0);
  assert.equal(server.board.confirmed.name, "국밥");
});

test("이미 서버에 들어간 내 확정을 다시 보내 409 가 와도(같은 메뉴·같은 닉네임) 충돌이 아니라 완료", async () => {
  const { store, sock, server, events } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "국밥");
  server.setConfirmed("국밥", "하나"); // 보내고 응답만 못 받았던 경우
  events.length = 0;
  sock.serverConnect(); await settle(12);
  assert.ok(!types(events).includes("conflict"));
  assert.equal(store.pendingCount(), 0);
});

test("자정을 넘겨 보내는 넘김은 의미가 없으니 조용히 버린다", async () => {
  const { store, sock, server, clock, events } = await setup();
  sock.serverDrop(); await settle();
  await store.addSkip("b1", "짜장면");
  clock.t = "2026-11-05T15:00:01.000Z"; // KST 11-06
  events.length = 0;
  sock.serverConnect(); await settle(12);
  assert.equal(store.pendingCount(), 0);
  assert.equal(calls(server, "POST", "/api/boards/b1/skipped").length, 0);
  assert.ok(!types(events).includes("dropped"));
});

test("대기열은 저장돼 앱을 껐다 켜도 남고, 다시 연결되면 보낸다", async () => {
  const a = await setup();
  a.sock.serverDrop(); await settle();
  await a.store.confirm("b1", "국밥");
  a.store.stop();
  const b = await setup({ storage: a.st, server: a.server, connect: true });
  assert.equal(b.server.board.confirmed?.name, "국밥");
  assert.equal(b.store.pendingCount(), 0);
});

test("연결 없이 자정을 넘기면 어제 확정은 '어제 메뉴'가 되고 넘김은 비워 보인다", async () => {
  const server = fakeServer();
  server.board.confirmed = { name: "국밥", nickname: "둘", confirmedAt: "x" };
  server.board.skipped = ["짜장면"];
  const { store, sock, clock } = await setup({ server });
  sock.serverDrop(); await settle();
  clock.t = "2026-11-05T15:00:01.000Z";
  const s = await store.getState();
  assert.equal(s.today, "2026-11-06");
  assert.equal(todayConfirmed(s.history.b1, s.today), null);
  assert.equal(yesterdayName(s.history.b1, s.today), "국밥");
  assert.deepEqual(s.skipped.b1, []);
});

// ───── 로그아웃·재연결·복귀 ─────
test("401 이면 토큰을 지우고 signedOut 신호(다른 기기 설정은 남김), 대기열도 비움", async () => {
  const { store, sock, server, st, events } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "국밥");
  server.failNext.push(() => ({ status: 401, ok: false, json: async () => ({ error: { code: "UNAUTHORIZED", message: "다시 참여해 주세요." } }) }));
  sock.serverConnect(); await settle(12);
  assert.ok(types(events).includes("signedOut"));
  const dev = JSON.parse(st.getItem("hanjan.v1.device"));
  assert.equal(dev.token, undefined);
  assert.equal(dev.groupId, undefined);
  assert.equal(dev.sound, true);
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.isSignedIn(), false);
});

test("connect_error UNAUTHORIZED/FORBIDDEN → 토큰 지우고 signedOut, socket.connect() 를 부르지 않는다", async () => {
  for (const msg of ["UNAUTHORIZED", "FORBIDDEN"]) {
    const { sock, events, st } = await setup({ connect: false });
    sock.fire("connect_error", new Error(msg));
    await settle();
    assert.ok(types(events).includes("signedOut"), msg);
    assert.ok(!sock.calls.includes("connect"), msg);
    assert.equal(JSON.parse(st.getItem("hanjan.v1.device")).token, undefined);
  }
});

test("서버가 끊은 소켓('io server disconnect')은 로그아웃, 그 밖의 끊김은 소켓에 맡긴다", async () => {
  const a = await setup();
  a.sock.serverDrop("io server disconnect"); await settle();
  assert.ok(types(a.events).includes("signedOut"));
  assert.ok(!a.sock.calls.includes("connect"));
  const b = await setup();
  b.sock.serverDrop("transport close"); await settle();
  b.sock.fire("connect_error", new Error("xhr poll error")); await settle();
  assert.ok(!types(b.events).includes("signedOut"));
  assert.equal(b.store.isSignedIn(), true);
  assert.equal(b.store.isOnline(), false);
});

test("재연결할 때마다 GET /state 를 다시 받는다", async () => {
  const { sock, server } = await setup();
  const n = calls(server, "GET", "/api/groups/g1/state").length;
  server.board.skipped = ["짜장면"]; server.bump();
  sock.serverDrop(); await settle();
  sock.serverConnect(); await settle();
  assert.equal(calls(server, "GET", "/api/groups/g1/state").length, n + 1);
});

test("돌아왔을 때(visibilitychange visible·pageshow persisted·online) GET /state, 동시에 하나만", async () => {
  const { sock, server, target, store } = await setup();
  const n = () => calls(server, "GET", "/api/groups/g1/state").length;
  const base = n();
  target.fire("visibilitychange"); target.fire("visibilitychange"); target.fire("online");
  await settle();
  assert.equal(n(), base + 1, "동시에 하나");
  target.document.visibilityState = "hidden";
  target.fire("visibilitychange"); await settle();
  assert.equal(n(), base + 1, "보이지 않을 때는 안 받음");
  target.fire("pageshow", { persisted: false }); await settle();
  assert.equal(n(), base + 1);
  target.fire("pageshow", { persisted: true }); await settle();
  assert.equal(n(), base + 2);
  target.document.visibilityState = "visible";
  // 소켓이 끊겨 있으면 다시 붙인다
  sock.serverDrop(); await settle();
  sock.calls.length = 0;
  target.fire("online"); await settle();
  assert.ok(sock.calls.includes("connect"));
  void store;
});

test("돌아왔는데 GET /state 가 실패하면 소켓을 끊었다 다시 붙인다", async () => {
  const { sock, server, target } = await setup();
  server.down = true;
  sock.calls.length = 0;
  target.fire("visibilitychange"); await settle(10);
  assert.deepEqual(sock.calls.slice(0, 2), ["disconnect", "connect"]);
});

test("stop 하면 브라우저 이벤트 듣기를 풀고 소켓을 닫는다", async () => {
  const { store, target, sock } = await setup();
  assert.ok(target.count("visibilitychange") > 0);
  store.stop();
  assert.equal(target.count("visibilitychange"), 0);
  assert.equal(target.count("online"), 0);
  assert.ok(sock.calls.includes("disconnect"));
});

test("연결 표시: onConnection 은 바뀔 때만 알린다", async () => {
  const { sock, conn } = await setup();
  sock.serverDrop(); await settle();
  sock.serverDrop(); await settle();
  sock.serverConnect(); await settle();
  assert.deepEqual(conn, [true, false, true]);
});

// ───── 기기 정보·그룹 ─────
test("기기 정보: 토큰 필드를 건드리지 않고 sound·lastBoardId·nickname 만 바꾼다", async () => {
  const { store, st } = await setup({ connect: false });
  await store.setDevice({ sound: false, lastBoardId: "b1", token: "해킹", groupId: "남의그룹" });
  const dev = JSON.parse(st.getItem("hanjan.v1.device"));
  assert.deepEqual([dev.token, dev.groupId, dev.memberId, dev.sound, dev.lastBoardId], ["tok1", "g1", "m1", false, "b1"]);
  assert.deepEqual(await store.getDevice(), { sound: false, lastBoardId: "b1", nickname: "하나" });
  assert.ok(!("token" in (await store.getDevice())));
});

test("마지막 상태를 hanjan.v1.remote.cache 에 저장해 두었다가 다음에 연결 없이도 연다", async () => {
  const a = await setup();
  assert.ok(a.st.getItem("hanjan.v1.remote.cache"));
  const io = fakeIo();
  const offline = createRemoteStore({ storage: a.st, io, target: fakeTarget(), fetchFn: async () => { throw new TypeError("offline"); }, retryDelays: [], sleep: async () => {} });
  const s = await offline.getState();
  assert.deepEqual(s.boards[0].items.map(i => i.name), ["국밥", "돈가스", "짜장면"]);
  assert.equal((await offline.getGroup()).name, "회사");
  assert.equal((await offline.addItem("b1", "새")).code, "OFFLINE");
});

test("getGroup·listMembers, 그룹 나가기(성공하면 로그아웃)", async () => {
  const { store, events, st } = await setup();
  assert.deepEqual(await store.getGroup(), { id: "g1", name: "회사", inviteCode: "ABC234" });
  assert.deepEqual((await store.listMembers()).map(m => m.nickname), ["하나"]);
  assert.deepEqual(await store.leaveGroup(), { ok: true });
  assert.ok(types(events).includes("signedOut"));
  assert.equal(JSON.parse(st.getItem("hanjan.v1.device")).token, undefined);
});

test("그룹 나가기 실패(만든 사람)는 서버 문구를 그대로", async () => {
  const { store, server } = await setup();
  server.failNext.push(() => ({ status: 400, ok: false, json: async () => ({ error: { code: "VALIDATION", message: "다른 멤버가 있으면 만든 사람은 나갈 수 없어요." } }) }));
  const r = await store.leaveGroup();
  assert.deepEqual([r.ok, r.message], [false, "다른 멤버가 있으면 만든 사람은 나갈 수 없어요."]);
  assert.equal(store.isSignedIn(), true);
});

test("기록·통계: 온라인이면 서버에서, 끊기면 마지막으로 받은 것(없으면 빈 값)", async () => {
  const { store, sock } = await setup();
  const h = await store.listHistory("b1");
  assert.equal(h.entries.length, 0);
  assert.deepEqual(await store.stats("b1", "30"), [{ name: "국밥", count: 2 }]);
  sock.serverDrop(); await settle();
  assert.deepEqual(await store.stats("b1", "30"), [{ name: "국밥", count: 2 }]);
  assert.equal((await store.stats("b1", "90")).length, 0);
  const off = await store.listHistory("b1", { before: "2026-10-01", days: 30 });
  assert.deepEqual([off.entries.length, off.hasMore, off.offline], [0, false, true]);
});

test("그룹 만들기·참여는 받은 토큰을 기기에 저장하고 바로 시작한다(토큰은 응답에서 한 번만)", async () => {
  const st = fakeStorage({ "hanjan.v1.device": JSON.stringify({ sound: true, nickname: "" }) });
  const server = fakeServer();
  const baseFetch = server.fetch;
  const posted = [];
  const fetchFn = async (url, init) => {
    if (url === "/api/groups" && init.method === "POST") {
      posted.push(JSON.parse(init.body));
      return { status: 201, ok: true, json: async () => ({ group: { id: "g1", name: "회사", inviteCode: "ABC234" }, member: { id: "m1", nickname: "하나", isOwner: true }, token: "tok1" }) };
    }
    return baseFetch(url, init);
  };
  const io = fakeIo();
  const store = createRemoteStore({ storage: st, io, target: fakeTarget(), fetchFn, retryDelays: [], sleep: async () => {} });
  const r = await store.createGroup({ name: "회사", nickname: "하나", importBoards: [] });
  assert.equal(r.ok, true);
  const dev = JSON.parse(st.getItem("hanjan.v1.device"));
  assert.deepEqual([dev.token, dev.groupId, dev.memberId, dev.sound], ["tok1", "g1", "m1", true]);
  assert.equal(io.sockets.length, 1);
  // 빈 importBoards 는 서버에 보내지 않는다(서버가 기본 메뉴판을 만든다)
  assert.deepEqual(posted, [{ name: "회사", nickname: "하나" }]);
});

test("서버가 거부한 만들기·참여는 문구를 그대로 돌려주고 토큰을 저장하지 않는다", async () => {
  const st = fakeStorage();
  const fetchFn = async () => ({ status: 404, ok: false, json: async () => ({ error: { code: "NOT_FOUND", message: "없는 초대 코드예요." } }) });
  const store = createRemoteStore({ storage: st, io: fakeIo(), target: fakeTarget(), fetchFn, retryDelays: [], sleep: async () => {} });
  const r = await store.joinGroup("ZZZZZZ", "둘");
  assert.deepEqual([r.ok, r.code, r.message], [false, "NOT_FOUND", "없는 초대 코드예요."]);
  assert.equal(st.getItem("hanjan.v1.device"), null);
  const p = await store.previewInvite("ZZZZZZ");
  assert.equal(p.ok, false);
});

// ───── 진육 E 리뷰 수정(E-2) ─────
test("[E-2 필수1] 자정이 지났는데 rev 가 같아도 새 날짜면 서버 값을 쓴다(어제 확정이 오늘로 보이지 않음)", async () => {
  const server = fakeServer();
  server.board.confirmed = { name: "국밥", nickname: "둘", confirmedAt: "x" };
  server.board.skipped = ["짜장면"];
  const { store, sock, server: srv } = await setup({ server });
  assert.equal(todayConfirmed((await store.getState()).history.b1, "2026-11-05"), "국밥");
  // 자정: 서버는 rev 를 올리지 않지만 오늘 확정·넘김이 비고 어제 메뉴가 생긴다
  srv.today = "2026-11-06"; srv.board.confirmed = null; srv.board.skipped = []; srv.board.yesterday = "국밥";
  sock.fire("day:changed", { today: "2026-11-06", eventId: "d1" });
  await settle();
  const s = await store.getState();
  assert.equal(s.today, "2026-11-06");
  assert.equal(todayConfirmed(s.history.b1, s.today), null);
  assert.equal(yesterdayName(s.history.b1, s.today), "국밥");
  assert.deepEqual(s.skipped.b1, []);
});

test("[E-2 필수2] 바로 보낸 확정이 409 여도 대기열은 잠기지 않는다(이후 넘김이 정상으로 나감, conflict 신호 없음)", async () => {
  const server = fakeServer();
  server.setConfirmed("돈가스", "둘");
  const { store, sock, events } = await setup({ server });
  const lose = await store.confirm("b1", "국밥");
  assert.deepEqual([lose.ok, lose.code, lose.existing.name], [false, "ALREADY_CONFIRMED", "돈가스"]);
  assert.ok(!types(events).includes("conflict"));
  assert.equal(store.pendingCount(), 0);
  // 바로 이어서 넘김 → 곧바로 서버로
  const before = calls(server, "POST", "/api/boards/b1/skipped").length;
  assert.equal((await store.addSkip("b1", "짜장면")).queued, undefined);
  assert.equal(calls(server, "POST", "/api/boards/b1/skipped").length, before + 1);
  // 끊겼다 이어져도 대기열 항목이 정상적으로 나간다
  sock.serverDrop(); await settle();
  await store.addSkip("b1", "국밥");
  sock.serverConnect(); await settle(12);
  assert.equal(store.pendingCount(), 0);
  assert.deepEqual(server.board.skipped, ["짜장면", "국밥"]);
  // 덮어쓰기로 다시 보내면 바뀐다
  assert.equal((await store.confirm("b1", "국밥", { overwrite: true })).ok, true);
  assert.equal(server.board.confirmed.name, "국밥");
});

test("[E-2 필수3] 대기열을 보내다 502 가 나면 버리지 않고 멈췄다가, 다음 연결에 보낸다", async () => {
  const { store, sock, server, events } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "국밥");
  await store.addSkip("b1", "짜장면");
  // 서버 문제가 연결 직후 두 번(보내기 + refresh 뒤 다시 보내기) 이어진다
  for (let i = 0; i < 2; i++) server.failNext.push(({ path }) => (path === "/api/boards/b1/history" ? ({ status: 502, ok: false, json: async () => { throw new SyntaxError("html"); } }) : null));
  events.length = 0;
  sock.serverConnect(); await settle(12);
  assert.equal(store.pendingCount(), 2, "아무것도 버리지 않음");
  assert.ok(!types(events).includes("dropped"));
  assert.equal(server.board.confirmed, null);
  // 서버가 돌아옴 → 다음 연결에서 순서대로
  sock.serverDrop(); await settle();
  sock.serverConnect(); await settle(12);
  assert.equal(store.pendingCount(), 0);
  assert.equal(server.board.confirmed.name, "국밥");
});

test("[E-2 필수3] 5xx 는 다음 refresh 때도 다시 보낸다(돌아왔을 때 신호)", async () => {
  const { store, sock, server, target } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "국밥");
  for (let i = 0; i < 2; i++) server.failNext.push(({ path }) => (path === "/api/boards/b1/history" ? ({ status: 503, ok: false, json: async () => ({}) }) : null));
  sock.serverConnect(); await settle(12);
  assert.equal(store.pendingCount(), 1);
  target.fire("visibilitychange"); await settle(12);
  assert.equal(store.pendingCount(), 0);
});

test("[E-2 필수3] 400 만 버린다(5xx 와 구분)", async () => {
  const { store, sock, server, events } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "옛날", { date: "2026-10-01" });
  sock.serverConnect(); await settle(12);
  assert.equal(store.pendingCount(), 0);
  assert.equal(events.filter(e => e.type === "dropped").length, 1);
  void server;
});

test("[E-2 권고2] 보내는 중에 들어온 새 확정은 줄 뒤에 서서 순서를 지킨다", async () => {
  const { store, sock, server } = await setup();
  sock.serverDrop(); await settle();
  await store.addSkip("b1", "짜장면");
  // 대기열 전송이 시작된 뒤(첫 쓰기 응답을 늦춘다) 새 확정을 누른다
  let release;
  const gate = new Promise(r => { release = r; });
  server.failNext.push(({ method, path }) => (method === "POST" && path === "/api/boards/b1/skipped" ? gate.then(() => null) : null));
  const seen = [];
  const inner = server.fetch;
  server.fetch = async (url, init) => { const u = new URL(url, "http://x"); if (init?.method === "POST") seen.push(u.pathname); return inner(url, init); };
  void seen;
  sock.serverConnect(); await settle(6);
  const pending = store.confirm("b1", "국밥");
  release();
  const r = await pending;
  await settle(12);
  assert.equal(r.ok, true);
  const order = server.calls.filter(c => c.method === "POST").map(c => c.path);
  assert.deepEqual(order, ["/api/boards/b1/skipped", "/api/boards/b1/history"]);
  assert.equal(store.pendingCount(), 0);
});

test("[E-2 권고3] 연결 없이 이틀 이상 지나면 어제 메뉴는 없음(null), 정확히 하루면 어제 확정이 어제 메뉴", async () => {
  const server = fakeServer();
  server.board.confirmed = { name: "국밥", nickname: "둘", confirmedAt: "x" };
  server.board.yesterday = "돈가스";
  const { store, sock, clock } = await setup({ server });
  sock.serverDrop(); await settle();
  clock.t = "2026-11-06T03:00:00.000Z";
  let s = await store.getState();
  assert.equal(yesterdayName(s.history.b1, s.today), "국밥");
  clock.t = "2026-11-07T03:00:00.000Z";
  s = await store.getState();
  assert.equal(s.today, "2026-11-07");
  assert.equal(yesterdayName(s.history.b1, s.today), null);
  assert.equal(todayConfirmed(s.history.b1, s.today), null);
});

test("[E-2 권고4] REST 403 은 바로 로그아웃하지 않고 GET /state 를 다시 받는다", async () => {
  const { store, server, events } = await setup();
  const n = calls(server, "GET", "/api/groups/g1/state").length;
  server.failNext.push(({ path }) => (path === "/api/boards/b1/items" ? ({ status: 403, ok: false, json: async () => ({ error: { code: "FORBIDDEN", message: "이 그룹의 멤버가 아니에요." } }) }) : null));
  const r = await store.addItem("b1", "새메뉴");
  assert.equal(r.ok, false);
  await settle();
  assert.ok(!types(events).includes("signedOut"));
  assert.equal(store.isSignedIn(), true);
  assert.equal(calls(server, "GET", "/api/groups/g1/state").length, n + 1);
});

test("[E-2 권고4] GET /state 자체가 403 이면 그때 로그아웃", async () => {
  const { server, sock, events, store } = await setup();
  server.failNext.push(({ path }) => (path === "/api/groups/g1/state" ? ({ status: 403, ok: false, json: async () => ({ error: { code: "FORBIDDEN", message: "x" } }) }) : null));
  sock.fire("day:changed", { today: "2026-11-06", eventId: "x1" });
  await settle(12);
  assert.ok(types(events).includes("signedOut"));
  assert.equal(store.isSignedIn(), false);
});

test("[E-2 권고4] 소켓 connect_error FORBIDDEN 은 로그아웃(설계 4.3)", async () => {
  const { sock, events } = await setup({ connect: false });
  sock.fire("connect_error", new Error("FORBIDDEN"));
  await settle();
  assert.ok(types(events).includes("signedOut"));
});

// ───── E-3 ─────
const rateLimited = sec => ({ status: 429, ok: false, json: async () => ({ error: { code: "RATE_LIMITED", message: "시도가 너무 많아요. 잠시 후 다시 해 주세요.", retryAfterSec: sec } }) });

test("[E-3] 서버의 retryAfterSec 를 오류 결과에 그대로 넘긴다(만들기·참여·미리 보기)", async () => {
  const fetchFn = async () => rateLimited(540);
  const store = createRemoteStore({ storage: fakeStorage(), io: fakeIo(), target: fakeTarget(), fetchFn, retryDelays: [], sleep: async () => {} });
  for (const r of [await store.createGroup({ name: "g", nickname: "n" }), await store.joinGroup("ABC234", "n"), await store.previewInvite("ABC234")]) {
    assert.deepEqual([r.ok, r.code, r.retryAfterSec], [false, "RATE_LIMITED", 540]);
  }
  const plain = createRemoteStore({ storage: fakeStorage(), io: fakeIo(), target: fakeTarget(), retryDelays: [], sleep: async () => {},
    fetchFn: async () => ({ status: 404, ok: false, json: async () => ({ error: { code: "NOT_FOUND", message: "없는 초대 코드예요." } }) }) });
  assert.equal("retryAfterSec" in (await plain.joinGroup("ZZZZZZ", "n")), false);
});

test("[E-3] 소켓 파일을 못 불러와도 REST 는 계속 쓰고(편집·확정 가능), 연결 띠용 상태는 끊김, 30초→60→120→240→300→300 간격으로 다시 불러 본다", async () => {
  const server = fakeServer();
  const timers = fakeTimers();
  let tries = 0;
  const io = fakeIo();
  const st = fakeStorage({ "hanjan.v1.device": JSON.stringify(SIGNED_IN) });
  const store = createRemoteStore({ storage: st, loadIo: async () => (++tries <= 6 ? null : io), target: fakeTarget(), fetchFn: server.fetch, retryDelays: [], sleep: async () => {}, timers });
  const conn = [];
  store.onConnection(o => conn.push(o));
  await store.start(); await settle();
  assert.equal(io.sockets.length, 0);
  assert.equal(store.isOnline(), false, "실시간이 없으니 연결 띠 쪽은 끊김");
  assert.deepEqual(conn, []);
  assert.ok(timers.pending().includes(30_000));
  // REST 로는 계속 동작
  assert.equal((await store.getState()).boards[0].items.length, 3);
  assert.equal((await store.setItemOn("b1", "i0", false)).ok, true);
  assert.equal((await store.confirm("b1", "국밥")).queued, undefined);
  assert.equal(server.board.confirmed.name, "국밥");
  // 재시도 간격
  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(timers.pending().filter(ms => ms >= 30_000)[0]);
    await timers.fireNext(seen.at(-1)); await settle();
  }
  assert.deepEqual(seen, [30_000, 60_000, 120_000, 240_000, 300_000]);
  assert.equal(timers.pending().filter(ms => ms >= 30_000)[0], 300_000, "최대 5분 간격");
  assert.equal(io.sockets.length, 0);
  await timers.fireNext(300_000); await settle();   // 7번째 시도에서 성공
  assert.equal(io.sockets.length, 1);
  io.last().serverConnect(); await settle();
  assert.equal(store.isOnline(), true);
  assert.deepEqual(conn, [true]);
  assert.equal(timers.pending().filter(ms => ms >= 30_000).length, 0, "붙으면 재시도 타이머는 없어진다");
});

test("[E-3] 소켓 파일 재시도는 돌아왔을 때(visibilitychange)·online 신호에도 바로 한다", async () => {
  const server = fakeServer();
  const io = fakeIo();
  const target = fakeTarget();
  let ok = false, tries = 0;
  const timers = fakeTimers();
  const st = fakeStorage({ "hanjan.v1.device": JSON.stringify(SIGNED_IN) });
  const store = createRemoteStore({ storage: st, loadIo: async () => { tries++; return ok ? io : null; }, target, fetchFn: server.fetch, retryDelays: [], sleep: async () => {}, timers });
  await store.start(); await settle();
  assert.equal(tries, 1);
  assert.equal(io.sockets.length, 0);
  assert.ok(target.count("visibilitychange") > 0, "소켓이 없어도 돌아옴 신호는 듣는다");
  target.fire("online"); await settle();          // 아직 안 됨 → 또 실패, 타이머는 하나만
  assert.equal(tries, 2);
  assert.equal(timers.pending().filter(ms => ms >= 30_000).length, 1);
  ok = true;
  target.fire("visibilitychange"); await settle(8);
  assert.equal(io.sockets.length, 1);
  assert.equal(timers.pending().filter(ms => ms >= 30_000).length, 0);
});

test("[E-3] 바로 보내는 요청이 가는 중일 때도 뒤 요청은 줄 뒤에 선다(addSkip 직후 clearSkip 이 뒤집히지 않음)", async () => {
  const { store, server } = await setup();
  let release;
  const gate = new Promise(r => { release = r; });
  server.failNext.push(({ method, path }) => (method === "POST" && path === "/api/boards/b1/skipped" ? gate.then(() => null) : null));
  const p1 = store.addSkip("b1", "짜장면");
  await settle(4);                       // 첫 요청이 서버 응답을 기다리는 중
  const p2 = store.clearSkip("b1");
  await settle(4);
  assert.equal(server.calls.filter(c => c.method === "DELETE" && c.path.endsWith("/skipped")).length, 0, "앞 요청이 끝나기 전에는 안 보냄");
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.deepEqual([a.ok, b.ok], [true, true]);
  const order = server.calls.filter(c => c.path === "/api/boards/b1/skipped").map(c => c.method);
  assert.deepEqual(order, ["POST", "DELETE"]);
  assert.deepEqual(server.board.skipped, []);
  assert.equal(store.pendingCount(), 0);
});

test("[E-3] 앞 요청이 네트워크 오류로 대기열에 남아도 뒤 요청이 앞서 나가지 않는다", async () => {
  const { store, sock, server } = await setup();
  let release;
  const gate = new Promise(r => { release = r; });
  server.failNext.push(async ({ method, path }) => { if (method === "POST" && path === "/api/boards/b1/skipped") { await gate; throw new TypeError("끊김"); } return null; });
  const p1 = store.addSkip("b1", "짜장면");
  await settle(4);
  const p2 = store.clearSkip("b1");
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.deepEqual([a.queued, b.queued], [true, true]);
  assert.equal(store.pendingCount(), 2);
  sock.serverDrop(); await settle();
  sock.serverConnect(); await settle(12);
  const writes = server.calls.filter(c => c.path === "/api/boards/b1/skipped" && c.method !== "GET").map(c => c.method);
  assert.deepEqual(writes.slice(-2), ["POST", "DELETE"]);
  assert.equal(store.pendingCount(), 0);
});

test("[E-3] resolveConflict 는 충돌 난 항목이 아직 맨 앞일 때만 건드린다(오래된 답이 다른 항목을 지우지 않음)", async () => {
  const { store, sock, server, events } = await setup();
  sock.serverDrop(); await settle();
  await store.confirm("b1", "국밥");
  server.setConfirmed("돈가스", "둘");
  sock.serverConnect(); await settle(12);
  assert.ok(types(events).includes("conflict"));
  await store.resolveConflict(false);          // 정상 답: 그 항목을 버림
  await settle(8);
  assert.equal(store.pendingCount(), 0);
  // 오프라인에서 새 항목을 쌓은 뒤, 이미 처리된 충돌에 대한 늦은 답이 또 들어옴
  sock.serverDrop(); await settle();
  await store.addSkip("b1", "짜장면");
  await store.resolveConflict(false);
  assert.equal(store.pendingCount(), 1, "엉뚱한 항목을 지우면 안 됨");
  await store.resolveConflict(true);
  assert.equal(store.pendingCount(), 1);
});

test("[E-3] 바로 보낸 넘김이 403 이면 버리지 않고 대기열에 남기고 GET /state 를 다시 받는다 — 로그인이 유지되면 다음에 다시 보낸다", async () => {
  const timers = fakeTimers();
  const { store, server, events } = await setup({ timers });
  const n = calls(server, "GET", "/api/groups/g1/state").length;
  server.failNext.push(({ method, path }) => (method === "POST" && path === "/api/boards/b1/skipped" ? ({ status: 403, ok: false, json: async () => ({ error: { code: "FORBIDDEN", message: "x" } }) }) : null));
  const r = await store.addSkip("b1", "짜장면");
  assert.deepEqual([r.ok, r.queued], [true, true]);
  await settle(8);
  assert.equal(store.pendingCount(), 1);
  assert.equal(store.isSignedIn(), true);
  assert.equal(calls(server, "GET", "/api/groups/g1/state").length, n + 1);
  assert.ok(!types(events).includes("signedOut"));
  assert.deepEqual(server.board.skipped, []);
  await timers.fireNext(30_000); await settle(12);
  assert.deepEqual(server.board.skipped, ["짜장면"]);
  assert.equal(store.pendingCount(), 0);
});

test("[E-3] 403 뒤 GET /state 도 403 이면 로그아웃하고 대기열도 비운다", async () => {
  const { store, server, events } = await setup();
  server.failNext.push(({ method, path }) => (method === "POST" && path === "/api/boards/b1/skipped" ? ({ status: 403, ok: false, json: async () => ({ error: { code: "FORBIDDEN", message: "x" } }) }) : null));
  server.failNext.push(({ path }) => (path === "/api/groups/g1/state" ? ({ status: 403, ok: false, json: async () => ({ error: { code: "FORBIDDEN", message: "x" } }) }) : null));
  const r = await store.addSkip("b1", "짜장면");
  await settle(10);
  assert.ok(types(events).includes("signedOut"));
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.isSignedIn(), false);
  assert.equal(r.ok === false || r.queued === true, true);
});

test("[E-3] 연결이 유지돼도 5xx 로 멈추면 30초→60→120초…(최대 5분) 간격으로 다시 보내 본다", async () => {
  const timers = fakeTimers();
  const { store, server } = await setup({ timers });
  const down = () => ({ status: 503, ok: false, json: async () => ({}) });
  for (let i = 0; i < 3; i++) server.failNext.push(({ method, path }) => (method === "POST" && path === "/api/boards/b1/skipped" ? down() : null));
  const r = await store.addSkip("b1", "짜장면");
  assert.equal(r.queued, true);
  assert.equal(store.pendingCount(), 1);
  assert.deepEqual(timers.pending().filter(ms => ms >= 30_000), [30_000]);
  await timers.fireNext(30_000); await settle(8);        // 두 번째 실패
  assert.deepEqual(timers.pending().filter(ms => ms >= 30_000), [60_000]);
  await timers.fireNext(60_000); await settle(8);        // 세 번째 실패
  assert.deepEqual(timers.pending().filter(ms => ms >= 30_000), [120_000]);
  await timers.fireNext(120_000); await settle(8);       // 서버 복구
  assert.equal(store.pendingCount(), 0);
  assert.deepEqual(server.board.skipped, ["짜장면"]);
  assert.equal(timers.pending().filter(ms => ms >= 30_000).length, 0, "성공하면 타이머와 간격이 초기화");
});

test("[E-3] stop 하면 재시도 타이머도 정리한다", async () => {
  const timers = fakeTimers();
  const { store, server } = await setup({ timers });
  server.failNext.push(({ method, path }) => (method === "POST" ? ({ status: 502, ok: false, json: async () => ({}) }) : null));
  await store.addSkip("b1", "짜장면");
  assert.ok(timers.pending().includes(30_000));
  store.stop();
  assert.equal(timers.pending().filter(ms => ms >= 30_000).length, 0);
});
