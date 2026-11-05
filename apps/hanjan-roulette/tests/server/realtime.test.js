// 실시간 통합 시험(⑧⑨ 등) — 실제 서버·socket.io-client. 쓰기는 REST 로, 받기는 소켓으로.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { io as connectIo } from "socket.io-client";
import { createServer } from "../../server/index.js";

let dir, srv, rt, base, clock, sockets;
const now = () => new Date(clock);

beforeEach(async () => {
  dir = mkdtempSync(pathJoin(tmpdir(), "hanjan-rt-"));
  clock = "2026-11-05T03:00:00.000Z"; // KST 12:00
  sockets = [];
  srv = await createServer({ dbPath: pathJoin(dir, "t.db"), now });
  rt = srv.realtime; // createServer 가 실시간을 이미 연결해 둔다
  base = `http://127.0.0.1:${await srv.listen(0)}`;
});
afterEach(async () => {
  for (const s of sockets) s.close();
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function makeGroup(name, nickname) {
  const r = await call("POST", "/api/groups", { body: { name, nickname } });
  const st = (await call("GET", `/api/groups/${r.body.group.id}/state`, { token: r.body.token })).body;
  return { gid: r.body.group.id, code: r.body.group.inviteCode, mid: r.body.member.id, nick: nickname, token: r.body.token, board: st.boards[0] };
}
async function join(g, nickname) {
  const r = await call("POST", `/api/invites/${g.code}/join`, { body: { nickname } });
  return { gid: g.gid, mid: r.body.member.id, nick: nickname, token: r.body.token, board: g.board };
}

// 접속 시도 → 성공하면 소켓(받은 이벤트는 sock.log), 실패하면 Error(message=서버가 준 이유)
function connect(auth, { reconnection = false } = {}) {
  const sock = connectIo(base, { auth, transports: ["websocket"], reconnection, forceNew: true });
  sock.log = [];
  sock.onAny((event, payload) => sock.log.push({ event, payload }));
  sockets.push(sock);
  return new Promise((resolve, reject) => {
    sock.once("connect", () => resolve(sock));
    sock.once("connect_error", e => reject(new Error(e.message)));
  });
}
const open = m => connect({ token: m.token, groupId: m.gid });
const waitEvent = (sock, event, ms = 1000) => new Promise((resolve, reject) => {
  const hit = sock.log.find(l => l.event === event);
  if (hit) return resolve(hit.payload);
  const t = setTimeout(() => reject(new Error(`${event} 를 ${ms}ms 안에 못 받음`)), ms);
  sock.on(event, p => { clearTimeout(t); resolve(p); });
});
const waitDisconnect = (sock, ms = 1000) => new Promise((resolve, reject) => {
  if (sock.disconnected) return resolve("already");
  const t = setTimeout(() => reject(new Error("연결이 안 끊김")), ms);
  sock.once("disconnect", reason => { clearTimeout(t); resolve(reason); });
});
const quiet = ms => new Promise(r => setTimeout(r, ms));
const rejects = (p, msg) => assert.rejects(p, e => { assert.equal(e.message, msg); return true; });

test("접속 실패: 토큰 없음·틀림·타입 오류 → UNAUTHORIZED, 다른 그룹·없는 그룹·groupId 없음 → FORBIDDEN", async () => {
  const A = await makeGroup("가", "에이");
  const B = await makeGroup("나", "비");
  await rejects(connect({}), "UNAUTHORIZED");
  await rejects(connect(undefined), "UNAUTHORIZED");
  await rejects(connect({ token: "x".repeat(43), groupId: A.gid }), "UNAUTHORIZED");
  await rejects(connect({ token: 123, groupId: A.gid }), "UNAUTHORIZED");
  await rejects(connect({ token: A.token, groupId: B.gid }), "FORBIDDEN");
  await rejects(connect({ token: A.token, groupId: "nope" }), "FORBIDDEN");
  await rejects(connect({ token: A.token }), "FORBIDDEN");
  await rejects(connect({ token: A.token, groupId: { $ne: 1 } }), "FORBIDDEN");
  const ok = await open(A);
  assert.equal(ok.connected, true);
});

test("⑧ A가 메뉴를 끄면 B 가 1초 안에 board:updated(공통 필드 포함), 다른 그룹 C 는 못 받는다", async () => {
  const A = await makeGroup("회사", "에이");
  const B = await join(A, "비");
  const C = await makeGroup("남의그룹", "씨");
  const [sa, sb, sc] = [await open(A), await open(B), await open(C)];
  const item = A.board.items[0];
  const t0 = Date.now();
  const r = await call("PATCH", `/api/boards/${A.board.id}/items/${item.id}`, { token: A.token, body: { isOn: false } });
  assert.equal(r.status, 200);
  const ev = await waitEvent(sb, "board:updated");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(ev.board.id, A.board.id);
  assert.equal(ev.board.items.find(i => i.id === item.id).isOn, false);
  assert.equal(ev.board.rev, r.body.rev);
  assert.match(ev.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(new Date(ev.at).toISOString(), ev.at);
  assert.deepEqual(ev.by, { memberId: A.mid, nickname: "에이" });
  await waitEvent(sa, "board:updated"); // 보낸 사람 기기도 받는다(rev 로 걸러짐)
  await quiet(300);
  assert.deepEqual(sc.log, [], "다른 그룹은 아무것도 받으면 안 됨");
});

test("이벤트 두 개는 서로 다른 eventId", async () => {
  const A = await makeGroup("회사", "에이");
  const sa = await open(A);
  await call("POST", `/api/boards/${A.board.id}/skipped`, { token: A.token, body: { name: "국밥" } });
  await call("DELETE", `/api/boards/${A.board.id}/skipped`, { token: A.token });
  await quiet(200);
  const ids = sa.log.filter(l => l.event === "board:updated").map(l => l.payload.eventId);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test("확정하면 history:confirmed 다음 board:updated, 졌을 때(409)는 아무것도 안 감", async () => {
  const A = await makeGroup("회사", "에이");
  const B = await join(A, "비");
  const sa = await open(A);
  await call("POST", `/api/boards/${A.board.id}/history`, { token: B.token, body: { name: "국밥" } });
  await waitEvent(sa, "board:updated");
  assert.deepEqual(sa.log.map(l => l.event), ["history:confirmed", "board:updated"]);
  const h = sa.log[0].payload;
  assert.equal(h.entry.name, "국밥");
  assert.equal(h.entry.nickname, "비");
  assert.equal(h.replaced, null);
  assert.deepEqual(h.by, { memberId: B.mid, nickname: "비" });
  sa.log.length = 0;
  const lose = await call("POST", `/api/boards/${A.board.id}/history`, { token: A.token, body: { name: "돈가스" } });
  assert.equal(lose.status, 409);
  await quiet(300);
  assert.deepEqual(sa.log, []);
});

test("멤버가 참여하면 member:joined", async () => {
  const A = await makeGroup("회사", "에이");
  const sa = await open(A);
  const B = await join(A, "새멤버");
  const ev = await waitEvent(sa, "member:joined");
  assert.equal(ev.member.nickname, "새멤버");
  assert.equal(ev.member.id, B.mid);
  assert.deepEqual(ev.by, { memberId: B.mid, nickname: "새멤버" });
});

test("⑨ 나간 멤버: 모두 member:left 를 받고, 나간 사람 소켓은 끊기고(서버가 끊음), 토큰은 401, 다시 접속도 UNAUTHORIZED", async () => {
  const A = await makeGroup("회사", "에이");
  const B = await join(A, "비");
  const sa = await open(A);
  const sb1 = await open(B);
  const sb2 = await open(B); // 같은 멤버의 두 번째 기기
  const gone1 = waitDisconnect(sb1), gone2 = waitDisconnect(sb2);
  assert.equal((await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: B.token })).status, 204);
  const left = await waitEvent(sa, "member:left");
  assert.equal(left.member.id, B.mid);
  assert.equal(left.member.nickname, "비");
  assert.equal(await gone1, "io server disconnect");
  assert.equal(await gone2, "io server disconnect");
  assert.ok(sb1.log.some(l => l.event === "member:left"), "나가는 본인도 member:left 를 먼저 받는다");
  assert.equal(sa.connected, true, "남은 멤버는 그대로");
  assert.equal((await call("GET", `/api/groups/${A.gid}/state`, { token: B.token })).status, 401);
  await rejects(open(B), "UNAUTHORIZED");
});

test("서버가 끊은 소켓은 재연결 옵션이 켜져 있어도 스스로 다시 붙지 않는다", async () => {
  const A = await makeGroup("회사", "에이");
  const B = await join(A, "비");
  const sb = await connect({ token: B.token, groupId: B.gid }, { reconnection: true });
  const gone = waitDisconnect(sb);
  await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: B.token });
  assert.equal(await gone, "io server disconnect");
  await quiet(1500); // 기본 재연결 대기(1초 안팎)보다 길게
  assert.equal(sb.connected, false);
});

test("끊겼다 다시 접속하면 새 소켓도 그룹 방에 들어가 이벤트를 받는다", async () => {
  const A = await makeGroup("회사", "에이");
  const B = await join(A, "비");
  const sb = await open(B);
  sb.close();
  const sb2 = await open(B);
  await call("POST", `/api/boards/${A.board.id}/skipped`, { token: A.token, body: { name: "국밥" } });
  const ev = await waitEvent(sb2, "board:updated");
  assert.deepEqual(ev.board.skipped, ["국밥"]);
});

test("day:changed: 한국 자정이 지나면 모든 그룹에 한 번씩, 같은 날 다시 불러도 안 보냄", async () => {
  const A = await makeGroup("가", "에이");
  const C = await makeGroup("나", "씨");
  const [sa, sc] = [await open(A), await open(C)];
  clock = "2026-11-05T14:59:59.000Z"; // KST 23:59:59
  assert.equal(rt.checkDay(), false);
  await quiet(200);
  assert.deepEqual([sa.log, sc.log], [[], []]);
  clock = "2026-11-05T15:00:00.000Z"; // KST 00:00:00
  assert.equal(rt.checkDay(), true);
  for (const s of [sa, sc]) {
    const ev = await waitEvent(s, "day:changed");
    assert.equal(ev.today, "2026-11-06");
    assert.match(ev.eventId, /^[0-9a-f-]{36}$/);
    assert.ok(ev.at);
  }
  assert.equal(rt.checkDay(), false);
  await quiet(200);
  assert.equal(sa.log.filter(l => l.event === "day:changed").length, 1);
  // 서버가 말하는 오늘도 새 날짜
  assert.equal((await call("GET", `/api/groups/${A.gid}/state`, { token: A.token })).body.today, "2026-11-06");
});

test("Socket.IO 클라이언트 파일을 서버가 직접 준다, CORS 헤더는 붙지 않는다", async () => {
  const r = await fetch(base + "/socket.io/socket.io.esm.min.js");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  assert.ok((await r.text()).length > 1000);
  const p = await fetch(base + "/socket.io/?EIO=4&transport=polling", { headers: { Origin: "https://evil.example" } });
  assert.equal(p.headers.get("access-control-allow-origin"), null);
});

test("기기 → 서버 이벤트는 2단계에 없다: 소켓으로 보낸 쓰기는 무시", async () => {
  const A = await makeGroup("회사", "에이");
  const B = await join(A, "비");
  const [sa, sb] = [await open(A), await open(B)];
  sa.emit("spin:start", { boardId: A.board.id, names: ["a", "b"] });
  sa.emit("board:updated", { board: { id: A.board.id } });
  await quiet(300);
  assert.deepEqual(sb.log, []);
});

test("[D-2④] 접속 확인과 방 가입 사이에 나간 멤버는 방에 들어가지 못하고 서버가 끊는다", async () => {
  const A = await makeGroup("회사", "에이");
  const B = await join(A, "비");
  const sa = await open(A);
  // 인증 미들웨어(realtime) 통과 직후, connection 직전에 나가기가 끼어든 상황
  let once = true;
  srv.io.use((s, next) => {
    if (once && s.data.memberId === B.mid) { once = false; srv.db.leaveMember({ groupId: A.gid, memberId: B.mid }); }
    next();
  });
  const sb = connectIo(base, { auth: { token: B.token, groupId: B.gid }, transports: ["websocket"], reconnection: false, forceNew: true });
  sockets.push(sb);
  sb.log = [];
  sb.onAny((event, payload) => sb.log.push({ event, payload }));
  assert.equal(await new Promise(res => sb.once("disconnect", res)), "io server disconnect");
  const room = srv.io.sockets.adapter.rooms.get(`group:${A.gid}`);
  assert.ok(![...room].some(id => srv.io.sockets.sockets.get(id)?.data.memberId === B.mid));
  await call("PATCH", `/api/boards/${A.board.id}`, { token: A.token, body: { name: "바뀜" } });
  await quiet(100);
  assert.equal(sb.log.length, 0, "나간 멤버는 이벤트를 못 받는다");
  assert.equal(sa.connected, true);
});
