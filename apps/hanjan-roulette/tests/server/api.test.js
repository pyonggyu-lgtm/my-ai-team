// REST API 통합 시험(설계 3.3 ①~⑦) — 실제 서버를 임의 포트·임시 DB 파일로 띄우고 내장 fetch 로 호출한다.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { createServer } from "../../server/index.js";
import { hashToken } from "../../server/auth.js";

let dir, srv, base, clock, logs, events;
const now = () => new Date(clock);

async function start(opts = {}) {
  dir = mkdtempSync(pathJoin(tmpdir(), "hanjan-api-"));
  clock = "2026-11-05T03:00:00.000Z"; // KST 2026-11-05 12:00
  logs = [];
  events = [];
  // 그룹 만들기 제한(주소당 1시간 5번)은 전용 시험에서만 기본값을 쓴다
  srv = await createServer({ dbPath: pathJoin(dir, "t.db"), now, log: m => logs.push(m), createLimit: { max: 1000 }, ...opts });
  const orig = srv.realtime.emit;
  srv.realtime.emit = (gid, event, payload, by) => { events.push({ gid, event, payload, by }); return orig(gid, event, payload, by); };
  base = `http://127.0.0.1:${await srv.listen(0)}`;
}
beforeEach(() => start());
afterEach(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

// ip: X-Forwarded-For 로 보내는 가짜 IP(시도 제한 시험용)
async function call(method, path, { token, body, ip, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (ip) headers["X-Forwarded-For"] = ip;
  let payload;
  if (raw !== undefined) { payload = raw; headers["Content-Type"] = "application/json"; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
  return { status: res.status, body: json };
}

let invSeq = 0;
async function makeGroup(name = "회사", nickname = "하나", extra = {}) {
  const r = await call("POST", "/api/groups", { body: { name, nickname, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { group, member, token } = r.body;
  const state = (await call("GET", `/api/groups/${group.id}/state`, { token })).body;
  return { gid: group.id, code: group.inviteCode, mid: member.id, token, board: state.boards[0], state };
}
async function join(code, nickname = "둘") {
  const r = await call("POST", `/api/invites/${code}/join`, { body: { nickname } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, mid: r.body.member.id, gid: r.body.group.id };
}
const boardOf = async (g, bid = g.board.id) =>
  (await call("GET", `/api/groups/${g.gid}/state`, { token: g.token })).body.boards.find(b => b.id === bid);

// ───────── ① 토큰 없음 401, 다른 그룹 토큰 403 — 2단계 API 전체 ─────────
// [메서드, 경로, 본문, 범위]  범위: g=그룹 id 경로, b=메뉴판 id 경로, "me"=그룹 id 경로(내 정보)
const API_TABLE = [
  ["GET", "/api/groups/:gid/state", undefined, "g"],
  ["GET", "/api/groups/:gid/members", undefined, "g"],
  ["DELETE", "/api/groups/:gid/members/me", undefined, "g"],
  ["POST", "/api/groups/:gid/boards", { name: "새판" }, "g"],
  ["PUT", "/api/groups/:gid/boards/order", { boardIds: [] }, "g"],
  ["PATCH", "/api/boards/:bid", { name: "바꿈" }, "b"],
  ["DELETE", "/api/boards/:bid", undefined, "b"],
  ["POST", "/api/boards/:bid/items", { name: "새메뉴" }, "b"],
  ["PATCH", "/api/boards/:bid/items/:iid", { isOn: false }, "b"],
  ["DELETE", "/api/boards/:bid/items/:iid", undefined, "b"],
  ["POST", "/api/boards/:bid/reset", undefined, "b"],
  ["POST", "/api/boards/:bid/skipped", { name: "국밥" }, "b"],
  ["DELETE", "/api/boards/:bid/skipped", undefined, "b"],
  ["POST", "/api/boards/:bid/history", { name: "국밥" }, "b"],
  ["GET", "/api/boards/:bid/history", undefined, "b"],
  ["GET", "/api/boards/:bid/stats", undefined, "b"],
];
// 로그인이 필요 없는 공개 API(초대 코드 쪽은 시도 제한으로 막는다)
const PUBLIC_TABLE = [
  ["GET", "/api/health"],
  ["POST", "/api/groups"],
  ["GET", "/api/invites/:code"],
  ["POST", "/api/invites/:code/join"],
];

test("① 서버에 등록된 모든 API 가 이 표에 있다(권한 확인이 빠진 API·4단계 API 가 없다)", () => {
  const registered = new Set();
  for (const layer of srv.app.router.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) registered.add(`${m.toUpperCase()} ${layer.route.path}`);
  }
  const listed = new Set([...API_TABLE.map(([m, p]) => `${m} ${p}`), ...PUBLIC_TABLE.map(([m, p]) => `${m} ${p}`)]);
  assert.deepEqual([...registered].sort(), [...listed].sort());
});

test("① 토큰 없음·틀림·나간 멤버 401, 다른 그룹 토큰 403, 없는 id 404 — 표의 모든 API", async () => {
  const A = await makeGroup("A그룹", "에이");
  const B = await makeGroup("B그룹", "비");
  const gone = await join(A.code, "나갈이");
  assert.equal((await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: gone.token })).status, 204);
  const iid = A.board.items[0].id;
  const fill = (p, g, gboard) => p.replace(":gid", g.gid).replace(":bid", gboard.id).replace(":iid", iid);
  const snapshot = async () => JSON.stringify(await boardOf(A));

  for (const [method, path, body] of API_TABLE) {
    const url = fill(path, A, A.board);
    const label = `${method} ${path}`;
    const before = await snapshot();
    for (const [what, token] of [["토큰 없음", undefined], ["틀린 토큰", "x".repeat(43)], ["나간 멤버", gone.token]]) {
      const r = await call(method, url, { token, body });
      assert.equal(r.status, 401, `${label} ${what}`);
      assert.equal(r.body.error.code, "UNAUTHORIZED", `${label} ${what}`);
    }
    const r403 = await call(method, url, { token: B.token, body });
    assert.equal(r403.status, 403, `${label} 다른 그룹`);
    assert.equal(r403.body.error.code, "FORBIDDEN", `${label} 다른 그룹`);
    // 없는 id 는 (토큰이 맞으면) 404
    const nf = await call(method, path.replace(":gid", "nope").replace(":bid", "nope").replace(":iid", iid), { token: A.token, body });
    assert.equal(nf.status, 404, `${label} 없는 id`);
    assert.equal(await snapshot(), before, `${label} 거부된 요청이 데이터를 바꾸면 안 됨`);
  }
  // 토큰 확인이 먼저: 없는 id + 토큰 없음 → 401
  assert.equal((await call("GET", "/api/groups/nope/state")).status, 401);
  // 거부된 요청은 이벤트도 없다(가입·나가기 제외)
  assert.ok(!events.some(e => !["member:joined", "member:left"].includes(e.event)));
});

test("① 같은 그룹의 다른 메뉴판 id 로 메뉴를 건드릴 수 없다(404)", async () => {
  const A = await makeGroup();
  const second = (await call("POST", `/api/groups/${A.gid}/boards`, { token: A.token, body: { name: "둘째", template: "lunch" } })).body;
  const r = await call("PATCH", `/api/boards/${second.id}/items/${A.board.items[0].id}`, { token: A.token, body: { isOn: false } });
  assert.equal(r.status, 404);
  assert.equal((await boardOf(A)).items[0].isOn, true);
});

// ───────── ② 초대 코드 시도 제한 ─────────
test("② 초대 코드: 틀린 시도 10번은 404, 11번째는 429 + retryAfterSec (조회·참여 합산, 맞는 코드도 막힘)", async () => {
  const A = await makeGroup();
  for (let i = 0; i < 5; i++) assert.equal((await call("GET", `/api/invites/${A.code}`, { ip: "7.7.7.7" })).status, 200); // 맞는 코드는 안 센다
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? await call("POST", "/api/invites/ZZZZZZ/join", { body: { nickname: "x" }, ip: "7.7.7.7" })
                    : await call("GET", "/api/invites/ZZZZZZ", { ip: "7.7.7.7" });
    assert.equal(r.status, 404, "시도 " + (i + 1));
  }
  const r = await call("GET", `/api/invites/${A.code}`, { ip: "7.7.7.7" });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "RATE_LIMITED");
  assert.ok(r.body.error.retryAfterSec > 0);
  assert.equal((await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: "x" }, ip: "7.7.7.7" })).status, 429);
  assert.equal((await call("GET", `/api/invites/${A.code}`, { ip: "8.8.8.8" })).status, 200); // 다른 IP
  clock = "2026-11-05T03:10:01.000Z"; // 10분 뒤
  assert.equal((await call("GET", `/api/invites/${A.code}`, { ip: "7.7.7.7" })).status, 200);
});

test("② 형식이 틀린 코드는 404 이지만 틀린 시도로 세지 않는다(오타로 막히지 않음)", async () => {
  const A = await makeGroup();
  for (let i = 0; i < 25; i++) {
    const r = i % 2 ? await call("GET", "/api/invites/abc", { ip: "5.5.5.5" })
                    : await call("POST", "/api/invites/AB0O1I/join", { ip: "5.5.5.5", body: { nickname: "x" } });
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, "NOT_FOUND");
  }
  assert.equal((await call("GET", `/api/invites/${A.code}`, { ip: "5.5.5.5" })).status, 200);
  assert.equal((await call("GET", `/api/invites/${encodeURIComponent("ＡＢＣ")}`, { ip: "5.5.5.5" })).status, 404);
  // 형식은 맞지만 없는 코드는 센다
  for (let i = 0; i < 10; i++) assert.equal((await call("GET", "/api/invites/ZZZZZZ", { ip: "5.5.5.5" })).status, 404);
  assert.equal((await call("GET", `/api/invites/${A.code}`, { ip: "5.5.5.5" })).status, 429);
});

test("[C권고1] 로그에 초대 코드가 남지 않는다(경로를 가림)", async () => {
  const A = await makeGroup();
  await call("GET", `/api/invites/${A.code}`);
  await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: "둘" } });
  await call("GET", "/api/invites/ZZZZZZ");
  await call("GET", "/api/invites/ZZZZZZ/join");
  const text = logs.join("\n");
  assert.ok(!text.includes(A.code) && !text.includes("ZZZZZZ"));
  assert.ok(logs.includes("GET /api/invites/*** 200"));
  assert.ok(logs.includes("POST /api/invites/***/join 201"));
});

test("[C권고2] 그룹 만들기는 주소당 1시간에 5번(맞든 틀리든), 6번째부터 429 — 초대 제한과 별개", async () => {
  await srv.close(); rmSync(dir, { recursive: true, force: true });
  await start({ createLimit: undefined }); // 기본값(5번/1시간)
  const ip = "6.6.6.6";
  const mk = body => call("POST", "/api/groups", { body, ip });
  for (let i = 0; i < 3; i++) assert.equal((await mk({ name: "g" + i, nickname: "n" })).status, 201);
  assert.equal((await mk({ name: "", nickname: "n" })).status, 400); // 틀린 요청도 센다
  assert.equal((await mk({ name: "g4", nickname: "n" })).status, 201);
  const r = await mk({ name: "g5", nickname: "n" });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "RATE_LIMITED");
  assert.ok(r.body.error.retryAfterSec > 3500);
  assert.equal(srv.db.sqlite.prepare("SELECT COUNT(*) c FROM groups").get().c, 4);
  assert.equal((await call("POST", "/api/groups", { body: { name: "g", nickname: "n" }, ip: "6.6.6.7" })).status, 201); // 다른 주소
  // IPv6 는 /64 로 묶는다
  for (let i = 0; i < 5; i++) assert.equal((await call("POST", "/api/groups", { body: { name: "g", nickname: "n" }, ip: `2001:db8:1:2:${i + 1}::1` })).status, 201);
  assert.equal((await call("POST", "/api/groups", { body: { name: "g", nickname: "n" }, ip: "2001:db8:1:2:ffff::9" })).status, 429);
  // 초대 코드 틀린 시도 제한은 영향 없음
  assert.equal((await call("GET", "/api/invites/ZZZZZZ", { ip })).status, 404);
  clock = "2026-11-05T04:00:01.000Z"; // 1시간 뒤
  assert.equal((await mk({ name: "g6", nickname: "n" })).status, 201);
});

test("② 시도 제한 값은 createServer 로 바꿀 수 있다", async () => {
  await srv.close(); rmSync(dir, { recursive: true, force: true });
  await start({ rateLimit: { max: 2, windowMs: 1000 } });
  assert.equal((await call("GET", "/api/invites/AAAAAA")).status, 404);
  assert.equal((await call("GET", "/api/invites/AAAAAA")).status, 404);
  assert.equal((await call("GET", "/api/invites/AAAAAA")).status, 429);
});

test("초대 코드: 소문자·앞뒤 공백도 받는다, 미리 보기와 참여, 닉네임 검사", async () => {
  const A = await makeGroup("우리회사");
  const p = await call("GET", `/api/invites/${encodeURIComponent("  " + A.code.slice(0, 3).toLowerCase() + "-" + A.code.slice(3) + " ")}`);
  assert.deepEqual(p.body, { groupName: "우리회사", memberCount: 1 });
  assert.equal((await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: "   " } })).status, 400);
  assert.equal((await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: "가".repeat(11) } })).status, 400);
  assert.equal((await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: 5 } })).status, 400);
  const B = await join(A.code.toLowerCase(), "둘째");
  assert.equal(B.gid, A.gid);
  assert.equal((await call("GET", `/api/invites/${A.code}`)).body.memberCount, 2);
  const ev = events.find(e => e.event === "member:joined");
  assert.equal(ev.payload.member.nickname, "둘째");
  assert.equal(ev.gid, A.gid);
});

test("활성 멤버 0명 그룹은 초대 조회·참여 404(데이터는 그대로)", async () => {
  const A = await makeGroup();
  assert.equal((await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: A.token })).status, 204); // 혼자라 나갈 수 있음
  for (const r of [await call("GET", `/api/invites/${A.code}`), await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: "누구" } })]) {
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, "NOT_FOUND");
  }
  assert.equal(srv.db.sqlite.prepare("SELECT COUNT(*) c FROM boards WHERE group_id = ?").get(A.gid).c, 1);
});

// ───────── ③ 동시 확정 ─────────
test("③ 같은 메뉴판·같은 날 확정 2건 동시 → 201 하나·409 하나, 409 본문에 먼저 확정한 사람", async () => {
  const A = await makeGroup("회사", "하나");
  const B = await join(A.code, "둘");
  const [r1, r2] = await Promise.all([
    call("POST", `/api/boards/${A.board.id}/history`, { token: A.token, body: { name: "국밥" } }),
    call("POST", `/api/boards/${A.board.id}/history`, { token: B.token, body: { name: "돈가스" } }),
  ]);
  const win = [r1, r2].find(r => r.status === 201);
  const lose = [r1, r2].find(r => r.status === 409);
  assert.ok(win && lose, `상태: ${r1.status}, ${r2.status}`);
  const winner = win === r1 ? { nick: "하나", name: "국밥" } : { nick: "둘", name: "돈가스" };
  assert.equal(lose.body.error.code, "ALREADY_CONFIRMED");
  assert.equal(lose.body.error.existing.nickname, winner.nick);
  assert.equal(lose.body.error.existing.name, winner.name);
  assert.ok(lose.body.error.existing.confirmedAt);
  assert.equal(lose.body.error.message, `${winner.nick}님이 ${winner.name === "국밥" ? "국밥으로" : "돈가스로"} 확정했어요. 바꿀까요?`);
  const h = (await call("GET", `/api/boards/${A.board.id}/history`, { token: A.token })).body;
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].name, winner.name);
  assert.equal(events.filter(e => e.event === "history:confirmed").length, 1); // 졌을 때는 이벤트 없음
});

// ───────── ④ overwrite ─────────
test("④ overwrite:true 면 바뀌고 넘김이 비워진다(+ replaced, 이벤트)", async () => {
  const A = await makeGroup("회사", "하나");
  const B = await join(A.code, "둘");
  const bid = A.board.id;
  await call("POST", `/api/boards/${bid}/skipped`, { token: A.token, body: { name: "김치찌개" } });
  const c1 = await call("POST", `/api/boards/${bid}/history`, { token: A.token, body: { name: "국밥" } });
  assert.equal(c1.status, 201);
  assert.deepEqual(c1.body.board.skipped, []); // 확정하면 넘김이 비워짐
  await call("POST", `/api/boards/${bid}/skipped`, { token: A.token, body: { name: "짜장면" } });
  const rev0 = (await boardOf(A)).rev;
  const c2 = await call("POST", `/api/boards/${bid}/history`, { token: B.token, body: { name: "돈가스", overwrite: false } });
  assert.equal(c2.status, 409);
  assert.equal((await boardOf(A)).rev, rev0);
  assert.deepEqual((await boardOf(A)).skipped, ["짜장면"]);
  events.length = 0;
  const c3 = await call("POST", `/api/boards/${bid}/history`, { token: B.token, body: { name: "돈가스", overwrite: true } });
  assert.equal(c3.status, 201);
  assert.deepEqual(c3.body.entry.nickname, "둘");
  assert.deepEqual(c3.body.board.confirmed.name, "돈가스");
  assert.deepEqual(c3.body.board.skipped, []);
  assert.equal(c3.body.board.rev, rev0 + 1);
  const names = events.map(e => e.event);
  assert.deepEqual(names, ["history:confirmed", "board:updated"]);
  assert.deepEqual(events[0].payload.replaced, { name: "국밥", nickname: "하나" });
  assert.deepEqual(events[0].by, { memberId: B.mid, nickname: "둘" });
  assert.equal(events[0].gid, A.gid);
});

test("확정 이름이 지금 메뉴판에 없어도 받는다", async () => {
  const A = await makeGroup();
  assert.equal((await call("POST", `/api/boards/${A.board.id}/history`, { token: A.token, body: { name: "지워진메뉴" } })).status, 201);
});

// ───────── ⑤ 입력 제한 ─────────
test("⑤ 메뉴 17개째·중복 이름·21자·빈 값·타입 오류 거부", async () => {
  const A = await makeGroup();
  const url = `/api/boards/${A.board.id}/items`;
  for (let i = 0; i < 8; i++) assert.equal((await call("POST", url, { token: A.token, body: { name: "추가" + i } })).status, 201);
  const r17 = await call("POST", url, { token: A.token, body: { name: "열일곱째" } });
  assert.equal(r17.status, 422);
  assert.equal(r17.body.error.code, "LIMIT_REACHED");
  assert.equal(r17.body.error.message, "16개까지 넣을 수 있어요.");
  const dup = await call("POST", url, { token: A.token, body: { name: "  국밥  " } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "DUPLICATE_NAME");
  assert.equal(dup.body.error.message, "이미 있는 메뉴예요.");
  const rev = (await boardOf(A)).rev;
  for (const body of [{ name: "가".repeat(21) }, { name: "   " }, {}, { name: 5 }, { name: ["a"] }, { name: "ok", sortOrder: "1" }, { name: "ok", sortOrder: -1 }, { name: "ok", sortOrder: 1.5 }]) {
    const r = await call("POST", url, { token: A.token, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, "VALIDATION");
  }
  assert.equal((await boardOf(A)).rev, rev);
  assert.equal((await call("POST", url, { token: A.token, body: { name: "가".repeat(20) } })).status, 422); // 20자는 길이 통과(개수 초과)
});

test("⑤ 메뉴판 11번째·이름 13자·마지막 메뉴판 삭제 거부", async () => {
  const A = await makeGroup();
  const url = `/api/groups/${A.gid}/boards`;
  for (let i = 0; i < 9; i++) assert.equal((await call("POST", url, { token: A.token, body: { name: "판" + i } })).status, 201);
  const r = await call("POST", url, { token: A.token, body: { name: "열한째" } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.message, "메뉴판은 10개까지 만들 수 있어요.");
  await srv.close(); rmSync(dir, { recursive: true, force: true });
  await start();
  const B = await makeGroup();
  for (const body of [{ name: "가".repeat(13) }, { name: "ok", resultLead: "가".repeat(21) }, { name: "ok", template: "nope" }, { name: "ok", excludeYesterday: "yes" }, { name: 1 }]) {
    assert.equal((await call("POST", `/api/groups/${B.gid}/boards`, { token: B.token, body })).status, 400, JSON.stringify(body));
  }
  const del = await call("DELETE", `/api/boards/${B.board.id}`, { token: B.token });
  assert.equal(del.status, 400);
  assert.equal(del.body.error.code, "VALIDATION");
  assert.equal(del.body.error.message, "메뉴판은 1개 이상 있어야 해요.");
});

test("⑤ 그룹 이름 21자·닉네임 11자·빈 값·타입 오류는 400, 그룹이 안 생긴다", async () => {
  for (const body of [{ name: "가".repeat(21), nickname: "a" }, { name: "g", nickname: "가".repeat(11) }, { name: "", nickname: "a" }, { name: "g" }, { name: 1, nickname: "a" }, { name: "g", nickname: {} }]) {
    const r = await call("POST", "/api/groups", { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, "VALIDATION");
  }
  assert.equal(srv.db.sqlite.prepare("SELECT COUNT(*) c FROM groups").get().c, 0);
  assert.equal((await call("POST", "/api/groups", { body: { name: "가".repeat(20), nickname: "나".repeat(10), 모르는필드: 1 } })).status, 201);
});

test("본문이 JSON 이 아니거나 객체가 아니면 400, 너무 크면 413(그룹 만들기만 1MB)", async () => {
  const A = await makeGroup();
  assert.equal((await call("POST", "/api/groups", { raw: "{깨진" })).status, 400);
  assert.equal((await call("POST", "/api/groups", { raw: "[1,2]" })).status, 400);
  assert.equal((await call("POST", `/api/boards/${A.board.id}/items`, { token: A.token, raw: '"문자열"' })).status, 400);
  const big = { name: "x", pad: "a".repeat(20 * 1024) };
  const r = await call("POST", `/api/boards/${A.board.id}/items`, { token: A.token, body: big });
  assert.equal(r.status, 413);
  assert.equal(r.body.error.code, "VALIDATION");
  assert.equal((await call("POST", "/api/groups", { body: { name: "g", nickname: "n", pad: "a".repeat(20 * 1024) } })).status, 201);
});

// ───────── ⑥ 한국 자정 ─────────
test("⑥ KST 23:59:59 와 00:00:00 확정은 서로 다른 날짜, 어제 메뉴 계산이 맞다", async () => {
  const A = await makeGroup();
  const bid = A.board.id;
  clock = "2026-11-05T14:59:59.000Z"; // KST 23:59:59 (11-05)
  const c1 = await call("POST", `/api/boards/${bid}/history`, { token: A.token, body: { name: "국밥" } });
  assert.equal(c1.status, 201);
  assert.equal(c1.body.entry.date, "2026-11-05");
  clock = "2026-11-05T15:00:00.000Z"; // KST 00:00:00 (11-06)
  const c2 = await call("POST", `/api/boards/${bid}/history`, { token: A.token, body: { name: "돈가스" } });
  assert.equal(c2.status, 201, "새 날이라 409 가 아니다");
  assert.equal(c2.body.entry.date, "2026-11-06");
  const st = (await call("GET", `/api/groups/${A.gid}/state`, { token: A.token })).body;
  assert.equal(st.today, "2026-11-06");
  assert.equal(st.boards[0].yesterday, "국밥");
  assert.equal(st.boards[0].confirmed.name, "돈가스");
  const h = (await call("GET", `/api/boards/${bid}/history`, { token: A.token })).body;
  assert.deepEqual(h.entries.map(e => [e.date, e.name]), [["2026-11-06", "돈가스"], ["2026-11-05", "국밥"]]);
  assert.equal((await call("GET", "/api/health")).body.today, "2026-11-06");
  // 자정이 지나면 전날 넘김은 오늘 화면에서 안 보인다
  clock = "2026-11-05T14:59:59.000Z";
  await call("POST", `/api/boards/${bid}/skipped`, { token: A.token, body: { name: "짜장면" } });
  assert.deepEqual((await boardOf(A)).skipped, ["짜장면"]);
  clock = "2026-11-05T15:00:00.000Z";
  assert.deepEqual((await boardOf(A)).skipped, []);
});

test("확정 date: 오늘·어제만, 그보다 오래됐거나 미래·형식 오류는 400", async () => {
  const A = await makeGroup();
  const url = `/api/boards/${A.board.id}/history`;
  const post = date => call("POST", url, { token: A.token, body: { name: "국밥", date } });
  const old = await post("2026-11-03");
  assert.equal(old.status, 400);
  assert.equal(old.body.error.code, "VALIDATION");
  assert.equal(old.body.error.message, "연결이 오래 끊겨 확정을 보내지 못했어요.");
  assert.equal((await post("2026-11-06")).status, 400);
  for (const d of ["2026-13-01", "2026-02-30", "내일", "2026-11-4", 20261104, {}]) assert.equal((await post(d)).status, 400, String(d));
  const y = await post("2026-11-04");
  assert.equal(y.status, 201);
  assert.equal(y.body.entry.date, "2026-11-04");
  assert.equal(y.body.board.confirmed, null); // 오늘 확정은 아님
  assert.equal(y.body.board.yesterday, "국밥");
  assert.equal((await post("2026-11-05")).status, 201);
  // 확정한 사람은 요청한 멤버 자신이다(본문의 memberId 같은 것은 무시)
  const r = await call("POST", url, { token: A.token, body: { name: "x", overwrite: true, memberId: "다른사람", date: "2026-11-05" } });
  assert.equal(r.body.entry.nickname, "하나");
  assert.equal((await call("POST", url, { token: A.token, body: { name: "x", overwrite: "true" } })).status, 400);
});

// ───────── ⑦ 토큰 원문이 DB·로그에 없다 ─────────
test("⑦ DB 에는 토큰 해시만 있다(원문 없음), 로그에도 토큰·본문·헤더가 없다", async () => {
  const A = await makeGroup("비밀그룹", "비밀닉");
  const B = await join(A.code, "참여닉");
  await call("POST", `/api/boards/${A.board.id}/history`, { token: A.token, body: { name: "비밀메뉴" } });
  await call("GET", `/api/boards/nope/stats`, { token: A.token });
  await call("GET", "/api/groups/nope/state", { token: B.token });
  const rows = srv.db.sqlite.prepare("SELECT id, token_hash FROM members").all();
  assert.equal(rows.length, 2);
  for (const tok of [A.token, B.token]) {
    assert.match(tok, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(rows.some(r => r.token_hash === hashToken(tok)));
    for (const t of ["groups", "members", "boards", "items", "skipped", "history"]) {
      assert.ok(!JSON.stringify(srv.db.sqlite.prepare(`SELECT * FROM ${t}`).all()).includes(tok), `${t} 에 토큰 원문`);
    }
    assert.ok(!logs.join("\n").includes(tok), "로그에 토큰 원문");
  }
  assert.ok(logs.length > 0);
  assert.ok(logs.every(l => /^[A-Z]+ \/\S* \d{3}( INTERNAL)?$/.test(l)), logs.join("|"));
  assert.ok(!logs.join("\n").includes("비밀"));
  assert.ok(!logs.join("\n").includes("?"), "쿼리 문자열은 기록하지 않음");
});

test("알 수 없는 오류는 500 INTERNAL(고정 문구), 내용·스택을 응답과 로그에 남기지 않는다", async () => {
  const A = await makeGroup();
  srv.db.boardsOf = () => { throw new Error("SECRET-INTERNAL-DETAIL"); };
  const r = await call("GET", `/api/groups/${A.gid}/state`, { token: A.token });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: { code: "INTERNAL", message: "잠시 후 다시 시도해 주세요." } });
  assert.ok(!logs.join("\n").includes("SECRET"));
  assert.ok(!logs.join("\n").includes(A.token));
});

test("없는 /api 경로는 JSON 404", async () => {
  const r = await call("GET", "/api/nope");
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "NOT_FOUND");
});

// ───────── 그룹·멤버 ─────────
test("그룹 만들기: 기본 '점심' 메뉴판, state 모양, 멤버 목록", async () => {
  const A = await makeGroup("회사", "하나");
  const B = await join(A.code, "둘");
  const st = (await call("GET", `/api/groups/${A.gid}/state`, { token: B.token })).body;
  assert.deepEqual(Object.keys(st).sort(), ["boards", "group", "me", "members", "today"]);
  assert.equal(st.today, "2026-11-05");
  assert.equal(st.boards.length, 1);
  assert.equal(st.boards[0].name, "점심");
  assert.equal(st.boards[0].items.length, 8);
  assert.equal(st.me.nickname, "둘");
  assert.equal(st.me.isOwner, false);
  assert.deepEqual(st.members.map(m => [m.nickname, m.isOwner]), [["하나", true], ["둘", false]]);
  const list = (await call("GET", `/api/groups/${A.gid}/members`, { token: A.token })).body;
  assert.deepEqual(list.map(m => m.nickname), ["하나", "둘"]);
  assert.ok(list[0].joinedAt);
  assert.equal(st.group.inviteCode, A.code);
});

test("그룹 나가기: 만든 사람은 다른 멤버가 있으면 불가, 나간 멤버는 401·목록에서 빠짐·member:left", async () => {
  const A = await makeGroup("회사", "하나");
  const B = await join(A.code, "둘");
  const own = await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: A.token });
  assert.equal(own.status, 400);
  assert.equal(own.body.error.code, "VALIDATION");
  assert.equal(own.body.error.message, "다른 멤버가 있으면 만든 사람은 나갈 수 없어요.");
  events.length = 0;
  assert.equal((await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: B.token })).status, 204);
  assert.deepEqual(events.map(e => e.event), ["member:left"]);
  assert.equal(events[0].payload.member.id, B.mid);
  assert.equal((await call("GET", `/api/groups/${A.gid}/state`, { token: B.token })).status, 401);
  assert.deepEqual((await call("GET", `/api/groups/${A.gid}/members`, { token: A.token })).body.map(m => m.nickname), ["하나"]);
  assert.equal((await call("POST", `/api/boards/${A.board.id}/history`, { token: B.token, body: { name: "x" } })).status, 401);
  // 이제 혼자 남은 만든 사람은 나갈 수 있다
  assert.equal((await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: A.token })).status, 204);
});

test("나간 멤버가 확정한 기록은 닉네임이 남는다", async () => {
  const A = await makeGroup("회사", "하나");
  const B = await join(A.code, "둘");
  await call("POST", `/api/boards/${A.board.id}/history`, { token: B.token, body: { name: "국밥" } });
  await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: B.token });
  const h = (await call("GET", `/api/boards/${A.board.id}/history`, { token: A.token })).body;
  assert.equal(h.entries[0].nickname, "둘");
  assert.equal((await boardOf(A)).confirmed.nickname, "둘");
});

// ───────── 1단계 메뉴판·기록 옮기기 ─────────
const importBoard = (over = {}) => ({
  id: "local1", name: "점심", resultLead: "오늘 점심은", template: "lunch", excludeYesterday: true, sortOrder: 0,
  items: [{ id: "a", name: "국밥", on: true }, { id: "b", name: "돈가스", on: false }],
  history: [{ date: "2026-11-04", name: "국밥", nickname: "나", confirmedAt: "2026-11-04T03:00:00.000Z" }, { date: "2026-11-03", name: "돈가스" }],
  ...over,
});

test("옮기기: 1단계 메뉴판(on 필드)·기록이 그대로 옮겨지고 확정한 사람은 만든 사람", async () => {
  const A = await makeGroup("회사", "하나", { importBoards: [importBoard(), importBoard({ name: "회식", template: "drinks", items: [], history: [] })] });
  const boards = A.state.boards;
  assert.deepEqual(boards.map(b => b.name), ["점심", "회식"]);
  assert.deepEqual(boards[0].items.map(i => [i.name, i.isOn]), [["국밥", true], ["돈가스", false]]);
  assert.equal(boards[0].yesterday, "국밥");
  assert.notEqual(boards[0].id, "local1"); // 서버가 새 id 를 만든다
  const h = (await call("GET", `/api/boards/${boards[0].id}/history`, { token: A.token })).body;
  assert.deepEqual(h.entries.map(e => [e.date, e.name, e.nickname]), [["2026-11-04", "국밥", "하나"], ["2026-11-03", "돈가스", "하나"]]);
  assert.equal(h.entries[0].confirmedAt, "2026-11-04T03:00:00.000Z");
});

test("옮기기: importBoards 가 없거나 빈 배열이면 '점심' 1개", async () => {
  for (const extra of [{}, { importBoards: [] }, { importBoards: null }]) {
    const A = await makeGroup("회사", "하나", extra);
    assert.deepEqual(A.state.boards.map(b => b.name), ["점심"]);
  }
});

test("옮기기: 하나라도 틀리면 400 이고 그룹도 메뉴판도 안 생긴다(전부 롤백)", async () => {
  const ok = importBoard();
  const cases = {
    "배열 아님": "x",
    "메뉴판 11개": Array.from({ length: 11 }, (_, i) => importBoard({ name: "b" + i })),
    "메뉴 17개": [ok, importBoard({ items: Array.from({ length: 17 }, (_, i) => ({ name: "m" + i })) })],
    "중복 메뉴": [importBoard({ items: [{ name: "a" }, { name: "a" }] })],
    "메뉴판 이름 13자": [importBoard({ name: "가".repeat(13) })],
    "메뉴판 이름 숫자": [importBoard({ name: 3 })],
    "결과 문구 21자": [importBoard({ resultLead: "가".repeat(21) })],
    "없는 템플릿": [importBoard({ template: "nope" })],
    "메뉴 이름 21자": [importBoard({ items: [{ name: "가".repeat(21) }] })],
    "메뉴 on 타입": [importBoard({ items: [{ name: "a", on: "yes" }] })],
    "기록 날짜 형식": [ok, importBoard({ history: [{ date: "2026-11-4", name: "a" }] })],
    "기록 날짜 없는 날": [importBoard({ history: [{ date: "2026-02-30", name: "a" }] })],
    "기록 날짜 겹침": [importBoard({ history: [{ date: "2026-11-04", name: "a" }, { date: "2026-11-04", name: "b" }] })],
    "기록 이름 없음": [importBoard({ history: [{ date: "2026-11-04" }] })],
    "기록 이름 21자": [importBoard({ history: [{ date: "2026-11-04", name: "가".repeat(21) }] })],
    "메뉴판이 객체 아님": [ok, 5],
  };
  for (const [label, importBoards] of Object.entries(cases)) {
    const r = await call("POST", "/api/groups", { body: { name: "g", nickname: "n", importBoards } });
    assert.equal(r.status, 400, label);
    assert.equal(r.body.error.code, "VALIDATION", label);
  }
  for (const t of ["groups", "members", "boards", "items", "history"]) assert.equal(srv.db.sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, 0, t);
});

// ───────── 메뉴판·메뉴 ─────────
test("메뉴 끄기·삭제·추가(되돌리기 위치)·템플릿 되돌리기와 rev, board:updated 이벤트", async () => {
  const A = await makeGroup();
  const bid = A.board.id;
  const first = A.board.items[0];
  events.length = 0;
  let b = (await call("PATCH", `/api/boards/${bid}/items/${first.id}`, { token: A.token, body: { isOn: false } })).body;
  assert.equal(b.items[0].isOn, false);
  assert.equal(b.rev, A.board.rev + 1);
  assert.equal((await call("PATCH", `/api/boards/${bid}/items/${first.id}`, { token: A.token, body: { isOn: "no" } })).status, 400);
  b = (await call("DELETE", `/api/boards/${bid}/items/${first.id}`, { token: A.token })).body;
  assert.equal(b.items.length, 7);
  const re = await call("POST", `/api/boards/${bid}/items`, { token: A.token, body: { name: first.name, sortOrder: first.sortOrder } });
  assert.equal(re.status, 201);
  assert.equal(re.body.items[0].name, first.name);
  assert.equal(re.body.rev, A.board.rev + 3);
  assert.deepEqual(events.map(e => e.event), ["board:updated", "board:updated", "board:updated"]);
  assert.equal(events[2].payload.board.rev, re.body.rev);
  await call("POST", `/api/boards/${bid}/items`, { token: A.token, body: { name: "새거" } });
  const reset = await call("POST", `/api/boards/${bid}/reset`, { token: A.token });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.items.length, 8);
  assert.ok(!reset.body.items.some(i => i.name === "새거"));
});

test("메뉴판 만들기·수정·순서·삭제와 이벤트", async () => {
  const A = await makeGroup();
  events.length = 0;
  const c = await call("POST", `/api/groups/${A.gid}/boards`, { token: A.token, body: { name: "술", template: "drinks", excludeYesterday: false } });
  assert.equal(c.status, 201);
  assert.equal(c.body.resultLead, "오늘 먹으러 갈 곳은");
  assert.equal(c.body.excludeYesterday, false);
  assert.equal(c.body.items.length, 8);
  assert.equal(events[0].event, "board:created");
  const e = await call("POST", `/api/groups/${A.gid}/boards`, { token: A.token, body: { name: "빈판" } });
  assert.equal(e.body.template, "empty");
  assert.equal(e.body.resultLead, "오늘의 선택은");
  assert.equal(e.body.items.length, 0);

  const p = await call("PATCH", `/api/boards/${c.body.id}`, { token: A.token, body: { name: "저녁", resultLead: "오늘 저녁은", excludeYesterday: true, 모르는: 1 } });
  assert.deepEqual([p.body.name, p.body.resultLead, p.body.excludeYesterday], ["저녁", "오늘 저녁은", true]);
  assert.equal((await call("PATCH", `/api/boards/${c.body.id}`, { token: A.token, body: { 모르는: 1 } })).status, 400);
  assert.equal((await call("PATCH", `/api/boards/${c.body.id}`, { token: A.token, body: { name: "" } })).status, 400);

  events.length = 0;
  const ids = [e.body.id, A.board.id, c.body.id];
  assert.equal((await call("PUT", `/api/groups/${A.gid}/boards/order`, { token: A.token, body: { boardIds: ids } })).status, 204);
  assert.deepEqual(events.map(x => [x.event, x.payload.boardIds]), [["boards:reordered", ids]]);
  assert.deepEqual((await call("GET", `/api/groups/${A.gid}/state`, { token: A.token })).body.boards.map(b => b.id), ids);
  for (const boardIds of [ids.slice(1), [...ids, "x"], [ids[0], ids[0], ids[1]], "x", [1, 2, 3]])
    assert.equal((await call("PUT", `/api/groups/${A.gid}/boards/order`, { token: A.token, body: { boardIds } })).status, 400);

  events.length = 0;
  assert.equal((await call("DELETE", `/api/boards/${e.body.id}`, { token: A.token })).status, 204);
  assert.deepEqual(events.map(x => [x.event, x.payload.boardId]), [["board:deleted", e.body.id]]);
  assert.equal((await call("GET", `/api/boards/${e.body.id}/history`, { token: A.token })).status, 404);
});

test("오늘 넘김: 추가는 멱등, 비우기, 다른 날 넘김은 보이지 않음", async () => {
  const A = await makeGroup();
  const url = `/api/boards/${A.board.id}/skipped`;
  const a = await call("POST", url, { token: A.token, body: { name: "국밥" } });
  const b = await call("POST", url, { token: A.token, body: { name: "국밥" } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.skipped, ["국밥"]);
  assert.equal(b.body.rev, a.body.rev);
  assert.equal((await call("POST", url, { token: A.token, body: {} })).status, 400);
  const cl = await call("DELETE", url, { token: A.token });
  assert.deepEqual(cl.body.skipped, []);
  assert.equal(cl.status, 200);
});

test("기록·통계: days 1~90, before, range 30|90|all", async () => {
  const A = await makeGroup();
  const bid = A.board.id;
  for (const [d, n] of [["2026-11-04", "국밥"]]) await call("POST", `/api/boards/${bid}/history`, { token: A.token, body: { name: n, date: d } });
  await call("POST", `/api/boards/${bid}/history`, { token: A.token, body: { name: "국밥" } });
  const h = await call("GET", `/api/boards/${bid}/history?days=1`, { token: A.token });
  assert.equal(h.status, 200);
  assert.deepEqual(h.body.entries.map(e => e.date), ["2026-11-05"]);
  assert.equal(h.body.hasMore, true);
  const h2 = (await call("GET", `/api/boards/${bid}/history?before=2026-11-05&days=30`, { token: A.token })).body;
  assert.deepEqual(h2.entries.map(e => e.date), ["2026-11-04"]);
  for (const q of ["days=0", "days=91", "days=abc", "days=1.5", "days=1&days=2", "before=2026-1-1", "before=2026-02-30"])
    assert.equal((await call("GET", `/api/boards/${bid}/history?${q}`, { token: A.token })).status, 400, q);
  for (const r of ["30", "90", "all"]) {
    const s = await call("GET", `/api/boards/${bid}/stats?range=${r}`, { token: A.token });
    assert.deepEqual(s.body, [{ name: "국밥", count: 2 }], r);
  }
  assert.deepEqual((await call("GET", `/api/boards/${bid}/stats`, { token: A.token })).body, [{ name: "국밥", count: 2 }]);
  assert.equal((await call("GET", `/api/boards/${bid}/stats?range=7`, { token: A.token })).status, 400);
});

test("health 는 로그인 없이 { ok, now, today }", async () => {
  const r = await call("GET", "/api/health");
  assert.deepEqual(r.body, { ok: true, now: "2026-11-05T03:00:00.000Z", today: "2026-11-05" });
});

// ───────── 진육 C 리뷰 권고 반영 ─────────
test("[C권고3] 409 문구의 조사: 받침 있음 으로 / 없음 로 / ㄹ 받침 로 / 한글 아님 (으)로", async () => {
  const A = await makeGroup("회사", "하나");
  const B = await join(A.code, "둘");
  const bid = A.board.id;
  const expected = { 국밥: "국밥으로", 피자: "피자로", 냉면집달: "냉면집달로", KFC: "KFC(으)로" };
  let day = 0;
  for (const [name, text] of Object.entries(expected)) {
    clock = new Date(Date.parse("2026-11-05T03:00:00.000Z") + day++ * 86400000).toISOString(); // 날마다 새 확정
    assert.equal((await call("POST", `/api/boards/${bid}/history`, { token: A.token, body: { name } })).status, 201);
    const lose = await call("POST", `/api/boards/${bid}/history`, { token: B.token, body: { name: "아무거나" } });
    assert.equal(lose.body.error.message, `하나님이 ${text} 확정했어요. 바꿀까요?`);
  }
});

test("[C권고2] 옮기기: 미래 날짜 기록 400, 메뉴판당 기록 3660개까지(넘으면 400, 전부 롤백)", async () => {
  const future = await call("POST", "/api/groups", { body: { name: "g", nickname: "n", importBoards: [importBoard({ history: [{ date: "2026-11-06", name: "국밥" }] })] } });
  assert.equal(future.status, 400);
  const today = await call("POST", "/api/groups", { body: { name: "g", nickname: "n", importBoards: [importBoard({ history: [{ date: "2026-11-05", name: "국밥" }] })] } });
  assert.equal(today.status, 201);
  const mkHist = n => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 10, 5) - i * 86400000).toISOString().slice(0, 10), name: "국밥" }));
  const over = await call("POST", "/api/groups", { body: { name: "g2", nickname: "n", importBoards: [importBoard({ history: mkHist(3661) })] } });
  assert.equal(over.status, 400);
  assert.equal(over.body.error.code, "VALIDATION");
  assert.equal(srv.db.sqlite.prepare("SELECT COUNT(*) c FROM groups WHERE name = 'g2'").get().c, 0);
  const ok = await call("POST", "/api/groups", { body: { name: "g3", nickname: "n", importBoards: [importBoard({ history: mkHist(3660) })] } });
  assert.equal(ok.status, 201);
  assert.equal(srv.db.sqlite.prepare("SELECT COUNT(*) c FROM history").get().c, 3661);
});

test("[C권고4] 넘김: 이름 20자·개수 16개 제한(422), 이미 있는 이름이면 200 이고 rev·이벤트 없음, 비우기도 바뀔 때만", async () => {
  const A = await makeGroup();
  const url = `/api/boards/${A.board.id}/skipped`;
  assert.equal((await call("POST", url, { token: A.token, body: { name: "가".repeat(21) } })).status, 400);
  events.length = 0;
  const first = await call("POST", url, { token: A.token, body: { name: "국밥" } });
  assert.equal(events.length, 1);
  const again = await call("POST", url, { token: A.token, body: { name: "국밥" } });
  assert.equal(again.status, 200);
  assert.equal(again.body.rev, first.body.rev);
  assert.equal(events.length, 1, "바뀌지 않았으면 이벤트 없음");
  for (let i = 1; i < 16; i++) assert.equal((await call("POST", url, { token: A.token, body: { name: "n" + i } })).status, 200);
  events.length = 0;
  const over = await call("POST", url, { token: A.token, body: { name: "열일곱째" } });
  assert.equal(over.status, 422);
  assert.equal(over.body.error.code, "LIMIT_REACHED");
  assert.equal(events.length, 0);
  assert.equal((await call("POST", url, { token: A.token, body: { name: "국밥" } })).status, 200); // 가득 차도 이미 있는 이름은 멱등
  assert.equal((await call("DELETE", url, { token: A.token })).status, 200);
  assert.equal(events.length, 1);
  const rev = (await boardOf(A)).rev;
  events.length = 0;
  const empty = await call("DELETE", url, { token: A.token }); // 이미 비어 있음
  assert.equal(empty.status, 200);
  assert.equal(empty.body.rev, rev);
  assert.equal(events.length, 0);
});

test("[C권고5] sortOrder 는 자리 번호: 끝보다 크면 맨 끝, 위치 지정, 1000 넘어도 받고, 번호가 커지지 않는다", async () => {
  const A = await makeGroup();
  const url = `/api/boards/${A.board.id}/items`;
  let r = await call("POST", url, { token: A.token, body: { name: "둘째자리", sortOrder: 1 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.items[1].name, "둘째자리");
  r = await call("POST", url, { token: A.token, body: { name: "맨끝", sortOrder: 5000 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.items.at(-1).name, "맨끝");
  assert.deepEqual(r.body.items.map(i => i.sortOrder), r.body.items.map((_, i) => i));
  // 넣고 지우기를 반복해도 번호는 0..개수-1
  let board = r.body;
  for (let i = 0; i < 12; i++) {
    board = (await call("DELETE", `${url}/${board.items.at(-1).id}`, { token: A.token })).body;
    board = (await call("POST", url, { token: A.token, body: { name: "반복" + i } })).body;
  }
  assert.equal(Math.max(...board.items.map(i => i.sortOrder)), board.items.length - 1);
  for (const bad of [-1, 1.5, "1", [], {}, true]) {
    assert.equal((await call("POST", url, { token: A.token, body: { name: "x", sortOrder: bad } })).status, 400, String(bad));
  }
});

test("[C권고6] 오류 문구에 영어 필드 이름이 없다", async () => {
  const A = await makeGroup();
  const bid = A.board.id;
  const msgs = [];
  for (const q of ["days=0", "days=abc", "before=zzz"]) msgs.push((await call("GET", `/api/boards/${bid}/history?${q}`, { token: A.token })).body.error.message);
  msgs.push((await call("GET", `/api/boards/${bid}/stats?range=7`, { token: A.token })).body.error.message);
  msgs.push((await call("PUT", `/api/groups/${A.gid}/boards/order`, { token: A.token, body: { boardIds: "x" } })).body.error.message);
  msgs.push((await call("PATCH", `/api/boards/${bid}`, { token: A.token, body: {} })).body.error.message);
  msgs.push((await call("POST", `/api/boards/${bid}/history`, { token: A.token, body: { name: "x", date: "2026-11-01" } })).body.error.message);
  assert.equal(msgs[3], "기록 범위가 올바르지 않아요.");
  for (const m of msgs) assert.ok(!/[A-Za-z]{3,}/.test(m), "영어 단어: " + m);
});


// ───────── D-2 (진육 C-2+D 리뷰 권고) ─────────
test("[D-2①] 로그: 대소문자·연속 슬래시를 바꿔 써도 초대 코드는 기록에 남지 않는다", async () => {
  const A = await makeGroup();
  await call("GET", `/API/Invites/${A.code}`);
  await call("GET", `/api//invites/${A.code}`);
  await call("GET", `/Api///INVITES//${A.code}/join`);
  await call("GET", `/api/invites/${A.code.toLowerCase()}`);
  const text = logs.join("\n");
  assert.ok(!text.toLowerCase().includes(A.code.toLowerCase()), text);
  assert.ok(logs.some(l => l.endsWith("/api/invites/*** 200")), text);
});

test("[D-2③] 그룹 만들기 제한은 본문을 읽기 전에: 막힌 주소는 깨진 JSON·큰 본문도 400/413 이 아니라 429", async () => {
  await srv.close(); rmSync(dir, { recursive: true, force: true });
  await start({ createLimit: { max: 1 } });
  const ip = "7.7.7.7";
  assert.equal((await call("POST", "/api/groups", { body: { name: "g", nickname: "n" }, ip })).status, 201);
  assert.equal((await call("POST", "/api/groups", { raw: "{깨진", ip })).status, 429);
  assert.equal((await call("POST", "/api/groups", { raw: JSON.stringify({ name: "x".repeat(2_000_000) }), ip })).status, 429);
  assert.equal((await call("POST", "/api/groups/", { body: { name: "g", nickname: "n" }, ip })).status, 429); // 끝 슬래시로 피할 수 없다
  assert.equal((await call("POST", "/API/groups", { body: { name: "g", nickname: "n" }, ip })).status, 429);
});

test("[D-2⑥] 그룹당 활성 멤버 30명: 31번째 참여는 422 LIMIT_REACHED, 한 명이 나가면 다시 들어올 수 있다", async () => {
  const A = await makeGroup();
  const members = [];
  for (let i = 1; i < 30; i++) members.push(await join(A.code, "m" + i));
  assert.equal((await call("GET", `/api/invites/${A.code}`)).body.memberCount, 30);
  const r = await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: "늦음" } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "LIMIT_REACHED");
  assert.equal(r.body.error.message, "이 그룹은 30명까지 들어올 수 있어요.");
  assert.equal(srv.db.memberCount(A.gid), 30);
  assert.equal((await call("DELETE", `/api/groups/${A.gid}/members/me`, { token: members[0].token })).status, 204);
  assert.equal((await call("POST", `/api/invites/${A.code}/join`, { body: { nickname: "늦음" } })).status, 201);
});

test("[D-2⑥] 참여 성공도 주소당 1시간에 30번: 31번째는 429(초대 틀린 시도 제한과 별개), 1시간 뒤 풀림", async () => {
  await srv.close(); rmSync(dir, { recursive: true, force: true });
  await start({ joinLimit: { max: 3 } });
  const ip = "8.8.8.8";
  // 그룹을 여러 개 만들어 30명 제한에 걸리지 않게
  const gs = [await makeGroup("a"), await makeGroup("b")];
  const j = (g, ipx = ip) => call("POST", `/api/invites/${g.code}/join`, { body: { nickname: "n" }, ip: ipx });
  assert.equal((await j(gs[0])).status, 201);
  assert.equal((await j(gs[1])).status, 201);
  assert.equal((await j(gs[0])).status, 201);
  const r = await j(gs[0]);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "RATE_LIMITED");
  assert.ok(r.body.error.retryAfterSec > 3500);
  assert.equal((await call("GET", `/api/invites/${gs[0].code}`, { ip })).status, 200); // 미리 보기는 막히지 않는다
  assert.equal((await j(gs[0], "8.8.8.9")).status, 201); // 다른 주소
  clock = "2026-11-05T04:00:01.000Z";
  assert.equal((await j(gs[0])).status, 201);
});

test("[D-2⑥] 실패한 참여(닉네임 오류)는 참여 성공 횟수로 세지 않는다", async () => {
  await srv.close(); rmSync(dir, { recursive: true, force: true });
  await start({ joinLimit: { max: 1 } });
  const g = await makeGroup();
  const ip = "9.9.9.9";
  assert.equal((await call("POST", `/api/invites/${g.code}/join`, { body: { nickname: "" }, ip })).status, 400);
  assert.equal((await call("POST", `/api/invites/${g.code}/join`, { body: { nickname: "n" }, ip })).status, 201);
  assert.equal((await call("POST", `/api/invites/${g.code}/join`, { body: { nickname: "n" }, ip })).status, 429);
});

test("[D-2] 409 existing 에 date 가 들어 있다(어제 기록인지 화면이 알 수 있게)", async () => {
  const A = await makeGroup();
  const yest = "2026-11-04";
  const first = await call("POST", `/api/boards/${A.board.id}/history`, { token: A.token, body: { name: A.board.items[0].name, date: yest } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await call("POST", `/api/boards/${A.board.id}/history`, { token: A.token, body: { name: A.board.items[1].name, date: yest } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.existing.date, yest);
});
