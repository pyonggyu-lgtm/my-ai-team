// server/auth.js 시험 — DB 없이 가짜 조회 함수를 주입해서 확인한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  newToken, hashToken, INVITE_ALPHABET, newInviteCode, normalizeInviteCode,
  createRateLimiter, rateLimitMiddleware, requireMember, ipKey, isValidInviteCode,
} from "../../server/auth.js";

test("토큰: 32바이트 base64url, 매번 다름", () => {
  const a = newToken(), b = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test("해시: SHA-256 hex 64자 고정, 원문과 다름, 같은 입력 같은 결과", () => {
  const t = newToken();
  const h = hashToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, t);
  assert.ok(!h.includes(t));
  assert.equal(hashToken(t), h);
  assert.equal(hashToken("a"), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  assert.equal(hashToken("a".repeat(1000)).length, 64);
});

test("초대 코드: 31종 글자, 6자리, 0·O·1·I·L 없음", () => {
  assert.equal(INVITE_ALPHABET, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  assert.equal(INVITE_ALPHABET.length, 31);
  for (const c of "0O1IL") assert.ok(!INVITE_ALPHABET.includes(c));
  for (let i = 0; i < 500; i++) assert.match(newInviteCode(() => false), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
});

test("초대 코드: 겹치면 다시 뽑는다", () => {
  let calls = 0;
  const code = newInviteCode(() => ++calls < 3);
  assert.equal(calls, 3);
  assert.equal(code.length, 6);
});

test("초대 코드: 계속 겹치면 무한 반복하지 않고 오류", () => {
  assert.throws(() => newInviteCode(() => true), /초대 코드/);
});

test("초대 코드 입력 정리: 대문자 + 앞뒤·가운데 공백·하이픈 제거", () => {
  assert.equal(normalizeInviteCode("  abc234 \n"), "ABC234");
  assert.equal(normalizeInviteCode("ABC 234"), "ABC234");
  assert.equal(normalizeInviteCode("abc-234"), "ABC234");
  assert.equal(normalizeInviteCode(" a b-c 2\t3-4 "), "ABC234");
  assert.equal(normalizeInviteCode("ＡＢＣ２３４"), "ABC234"); // 전각
  assert.equal(normalizeInviteCode("ＡＢＣ　２３４"), "ABC234"); // 전각 공백
  for (const dash of ["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212", "\uFF0D"])
    assert.equal(normalizeInviteCode("ABC" + dash + "234"), "ABC234", "U+" + dash.charCodeAt(0).toString(16));
  assert.ok(isValidInviteCode(normalizeInviteCode("ＡＢＣ２３４")));
  assert.ok(isValidInviteCode(normalizeInviteCode("ABC—234")));
  assert.equal(normalizeInviteCode(123), "");
  assert.equal(normalizeInviteCode(undefined), "");
  assert.ok(isValidInviteCode(normalizeInviteCode("abc-234")));
  for (const bad of ["", "ABC23", "ABC2345", "ABC23O", "ABC231", "abc234", "ABC-34", "ABC23가"]) assert.ok(!isValidInviteCode(bad), bad);
});

test("주소 묶기: IPv4 는 그대로, IPv6 는 /64, ::ffff: 매핑은 IPv4", () => {
  assert.equal(ipKey("1.2.3.4"), "1.2.3.4");
  assert.equal(ipKey("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(ipKey("::ffff:0102:0304"), "1.2.3.4");
  assert.equal(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), ipKey("2001:0db8:0001:0002::1"));
  assert.equal(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "v6:2001:db8:1:2");
  assert.notEqual(ipKey("2001:db8:1:2::1"), ipKey("2001:db8:1:3::1"));
  assert.equal(ipKey("2001:DB8::1"), ipKey("2001:db8:0:0::2"));
  assert.equal(ipKey("::1"), "v6:0:0:0:0");
  assert.equal(ipKey("fe80::1%eth0"), ipKey("fe80::2"));
  assert.equal(ipKey(undefined), "unknown");
  assert.equal(ipKey("이상한값"), "unknown");
});

const mkLimiter = (opts = {}) => {
  const clk = { t: 1_000_000 };
  const rl = createRateLimiter({ max: 10, windowMs: 600_000, now: () => new Date(clk.t), ...opts });
  return { rl, clk };
};
const fails = (rl, ip, n) => { for (let i = 0; i < n; i++) rl.recordFailure(ip); };

test("시도 제한: 틀린 시도 10번까지는 통과, 11번째부터 막힘, 10분 뒤 다시 허용, 다른 주소는 별개", () => {
  const { rl, clk } = mkLimiter();
  for (let i = 0; i < 10; i++) { assert.equal(rl.isBlocked("1.1.1.1").blocked, false, "시도 " + (i + 1)); rl.recordFailure("1.1.1.1"); }
  const r = rl.isBlocked("1.1.1.1");
  assert.equal(r.blocked, true);
  assert.equal(r.retryAfterSec, 600);
  assert.equal(rl.isBlocked("2.2.2.2").blocked, false);
  clk.t += 300_000;
  assert.equal(rl.isBlocked("1.1.1.1").retryAfterSec, 300);
  clk.t += 300_000; // 정확히 10분 뒤
  assert.equal(rl.isBlocked("1.1.1.1").blocked, false);
});

test("시도 제한: 맞는 코드(= 실패를 기록하지 않는 요청)는 아무리 많아도 세지 않는다", () => {
  const { rl } = mkLimiter();
  for (let i = 0; i < 500; i++) assert.equal(rl.isBlocked("3.3.3.3").blocked, false);
  assert.equal(rl.size(), 0);
  fails(rl, "3.3.3.3", 9);
  for (let i = 0; i < 50; i++) assert.equal(rl.isBlocked("3.3.3.3").blocked, false);
});

test("시도 제한: 이미 10번 틀린 주소는 맞는 코드라도 창 끝까지 막힌다", () => {
  const { rl, clk } = mkLimiter();
  fails(rl, "4.4.4.4", 10);
  for (let i = 0; i < 20; i++) assert.equal(rl.isBlocked("4.4.4.4").blocked, true);
  clk.t += 599_000;
  assert.equal(rl.isBlocked("4.4.4.4").blocked, true);
  clk.t += 1_000;
  assert.equal(rl.isBlocked("4.4.4.4").blocked, false);
});

test("[진육 재현] 같은 /64 의 주소 1000개로 틀려도 하나로 센다", () => {
  const { rl } = mkLimiter();
  let blockedAt = -1;
  for (let i = 0; i < 1000; i++) {
    const ip = `2001:db8:abcd:1234:${(i + 1).toString(16)}::${i.toString(16)}`;
    if (rl.isBlocked(ip).blocked) { blockedAt = i; break; }
    rl.recordFailure(ip);
  }
  assert.equal(blockedAt, 10);
  assert.equal(rl.size(), 1);
  assert.equal(rl.isBlocked("2001:db8:abcd:1234::ffff").blocked, true);
  assert.equal(rl.isBlocked("2001:db8:abcd:1235::1").blocked, false); // 다른 /64
  // 매핑 주소는 IPv4 와 같은 항목
  fails(rl, "::ffff:9.9.9.9", 10);
  assert.equal(rl.isBlocked("9.9.9.9").blocked, true);
});

test("[진육 재현] 주소 100개로 밀어내기: 꽉 차도 차단 중인 항목은 지워지지 않는다", () => {
  const { rl } = mkLimiter({ maxEntries: 50 });
  fails(rl, "6.6.6.6", 10); // 차단 중
  for (let i = 0; i < 100; i++) fails(rl, `10.0.0.${i}`, 1); // 한 번씩만 틀리는 주소 100개
  assert.ok(rl.size() <= 50);
  assert.equal(rl.isBlocked("6.6.6.6").blocked, true, "밀려나서 차단이 풀리면 안 됨");
});

test("시도 제한: 꽉 찼고 전부 차단 중이면 새 주소는 막힌다(닫힌 쪽으로)", () => {
  const { rl, clk } = mkLimiter({ maxEntries: 5 });
  for (let i = 0; i < 5; i++) fails(rl, `10.1.0.${i}`, 10);
  assert.equal(rl.size(), 5);
  const r = rl.isBlocked("10.9.9.9");
  assert.equal(r.blocked, true);
  assert.ok(r.retryAfterSec > 0);
  rl.recordFailure("10.9.9.9"); // 자리가 없으니 기록하지 않음
  assert.equal(rl.size(), 5);
  assert.equal(rl.isBlocked("10.1.0.0").blocked, true);
  clk.t += 600_000; // 기한이 지나면 정리되어 다시 열린다
  assert.equal(rl.isBlocked("10.9.9.9").blocked, false);
});

test("시도 제한: 꽉 차면 기한 지난 것 → 차단 안 된 오래된 것 순으로 지우고, 차단 중인 것은 남긴다", () => {
  const { rl, clk } = mkLimiter({ maxEntries: 3 });
  fails(rl, "1.0.0.1", 1); // 차단 안 됨, 가장 오래됨
  fails(rl, "1.0.0.2", 10); // 차단 중
  fails(rl, "1.0.0.3", 1);
  rl.recordFailure("1.0.0.4"); // 1.0.0.1 이 지워지고 들어감
  assert.equal(rl.size(), 3);
  assert.equal(rl.isBlocked("1.0.0.2").blocked, true);
  fails(rl, "1.0.0.4", 9);
  assert.equal(rl.isBlocked("1.0.0.4").blocked, true);
  assert.equal(rl.size(), 3);
  // 기한이 지난 항목이 있으면 그것부터 지운다(차단 안 된 새 항목은 남음)
  clk.t += 300_000;
  fails(rl, "1.0.0.5", 1); // 꽉 참: 만료된 것은 아직 없음 → 차단 안 된 1.0.0.3 이 밀려남
  assert.equal(rl.isBlocked("1.0.0.2").blocked, true);
  assert.equal(rl.isBlocked("1.0.0.4").blocked, true);
  clk.t += 300_000; // 처음 것들 기한 지남
  fails(rl, "1.0.0.6", 1);
  assert.equal(rl.isBlocked("1.0.0.2").blocked, false); // 만료돼서 풀림
  assert.ok(rl.size() <= 3);
});

test("전체 실패 상한: 주소를 바꿔 가며 300번 틀리면 새 주소도 막힌다, 창이 지나면 풀린다", () => {
  const { rl, clk } = mkLimiter({ globalMax: 300 });
  for (let i = 0; i < 300; i++) {
    const ip = `10.${i >> 8}.${i & 255}.1`;
    assert.equal(rl.isBlocked(ip).blocked, false, "시도 " + (i + 1));
    rl.recordFailure(ip); // 주소마다 1번씩만 틀림 → 주소별 한도에는 안 걸림
  }
  const r = rl.isBlocked("99.99.99.99");
  assert.equal(r.blocked, true);
  assert.equal(r.retryAfterSec, 600);
  assert.equal(rl.isBlocked("10.0.0.1").blocked, true);
  clk.t += 599_000;
  assert.equal(rl.isBlocked("99.99.99.99").blocked, true);
  clk.t += 1_000;
  assert.equal(rl.isBlocked("99.99.99.99").blocked, false);
  rl.recordFailure("99.99.99.99");
  assert.equal(rl.isBlocked("99.99.99.98").blocked, false, "새 창은 0부터 다시 센다");
});

test("전체 실패 상한은 맞는 코드(기록 안 함)로는 늘지 않고, 값을 바꿀 수 있다", () => {
  const { rl } = mkLimiter({ globalMax: 3 });
  for (let i = 0; i < 100; i++) assert.equal(rl.isBlocked("1.1.1.1").blocked, false);
  fails(rl, "1.1.1.1", 1); fails(rl, "2.2.2.2", 1);
  assert.equal(rl.isBlocked("3.3.3.3").blocked, false);
  fails(rl, "3.3.3.3", 1);
  assert.equal(rl.isBlocked("4.4.4.4").blocked, true);
});

test("isBlocked 는 읽기만 한다(항목 추가·삭제 없음)", () => {
  const { rl, clk } = mkLimiter({ maxEntries: 3 });
  for (let i = 0; i < 50; i++) rl.isBlocked(`7.7.7.${i}`);
  assert.equal(rl.size(), 0);
  fails(rl, "1.0.0.1", 1); fails(rl, "1.0.0.2", 10); fails(rl, "1.0.0.3", 1);
  assert.equal(rl.size(), 3);
  rl.isBlocked("1.0.0.9"); // 새 주소 확인이 기존 항목을 밀어내면 안 된다
  assert.equal(rl.size(), 3);
  assert.equal(rl.isBlocked("1.0.0.2").blocked, true);
  clk.t += 700_000; // 전부 기한 지남
  assert.equal(rl.isBlocked("1.0.0.2").blocked, false);
  assert.equal(rl.size(), 3, "만료돼도 읽기에서는 지우지 않는다");
  rl.recordFailure("1.0.0.7"); // 정리는 쓰기에서
  assert.equal(rl.size(), 1);
});

test("시도 제한: 오래된 항목은 정리돼 메모리가 무한히 늘지 않는다", () => {
  const { rl, clk } = mkLimiter();
  for (let i = 0; i < 1000; i++) rl.recordFailure(`10.2.${i >> 8}.${i & 255}`);
  assert.equal(rl.size(), 1000);
  clk.t += 700_000;
  rl.recordFailure("10.3.0.1");
  assert.ok(rl.size() <= 1, "size=" + rl.size());
});

async function limitApp(rl) {
  const app = express();
  app.set("trust proxy", "loopback");
  // 코드 "BAD" 만 틀린 시도로 센다
  app.get("/x/:code", rateLimitMiddleware(rl), (req, res) => {
    if (req.params.code === "BAD") { req.recordInviteFailure(); return res.status(404).json({ error: { code: "NOT_FOUND" } }); }
    res.json({ ok: true });
  });
  return serve(app);
}

test("시도 제한 미들웨어: 틀린 시도만 세고, 막히면 429 + retryAfterSec(맞는 코드도), X-Forwarded-For 기준", async () => {
  const { rl } = mkLimiter({ max: 2 });
  const s = await limitApp(rl);
  try {
    const get = (code, ip) => fetch(s.base + "/x/" + code, { headers: { "X-Forwarded-For": ip } });
    for (let i = 0; i < 5; i++) assert.equal((await get("GOOD", "9.9.9.9")).status, 200); // 맞는 코드는 안 센다
    assert.equal((await get("BAD", "9.9.9.9")).status, 404);
    assert.equal((await get("BAD", "9.9.9.9")).status, 404);
    const r = await get("GOOD", "9.9.9.9");
    assert.equal(r.status, 429);
    const body = await r.json();
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.ok(body.error.message.length > 0);
    assert.equal(body.error.retryAfterSec, 600);
    assert.equal(r.headers.get("retry-after"), "600");
    assert.equal((await get("GOOD", "8.8.8.8")).status, 200);
  } finally { await s.close(); }
});

async function serve(app) {
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

// ---- requireMember ----
const TOK_A = "tokenA", TOK_B = "tokenB", TOK_GONE = "tokenGone";
const members = new Map([
  [hashToken(TOK_A), { id: "mA", groupId: "g1", nickname: "A", leftAt: null }],
  [hashToken(TOK_B), { id: "mB", groupId: "g2", nickname: "B", leftAt: null }],
  [hashToken(TOK_GONE), { id: "mG", groupId: "g1", nickname: "G", leftAt: "2026-01-01" }],
]);
const lookups = {
  findMemberByTokenHash: h => members.get(h) ?? null,
  getGroup: id => (["g1", "g2"].includes(id) ? { id } : null),
  groupIdOfBoard: id => ({ b1: "g1", b2: "g2" })[id] ?? null,
};

async function authApp() {
  const app = express();
  const rm = requireMember(lookups);
  app.get("/api/groups/:gid/x", rm, (req, res) => res.json({ me: req.member.id }));
  app.get("/api/boards/:bid/x", rm, (req, res) => res.json({ me: req.member.id }));
  app.get("/api/me", rm, (req, res) => res.json({ me: req.member.id }));
  return serve(app);
}
const call = (s, path, token, raw) => fetch(s.base + path, { headers: token === undefined ? {} : { Authorization: raw ?? "Bearer " + token } });
const errCode = async r => (await r.json()).error.code;

test("requireMember: 토큰 없음·형식 틀림·모르는 토큰·나간 멤버는 401", async () => {
  const s = await authApp();
  try {
    for (const r of [
      await call(s, "/api/groups/g1/x"),
      await call(s, "/api/groups/g1/x", "", "Bearer "),
      await call(s, "/api/groups/g1/x", "x", "Basic abc"),
      await call(s, "/api/groups/g1/x", "x", "tokenA"),
      await call(s, "/api/groups/g1/x", "unknownToken"),
      await call(s, "/api/groups/g1/x", TOK_GONE),
      await call(s, "/api/boards/b1/x", TOK_GONE),
    ]) {
      assert.equal(r.status, 401);
      const b = await r.json();
      assert.equal(b.error.code, "UNAUTHORIZED");
      assert.ok(b.error.message);
    }
  } finally { await s.close(); }
});

test("requireMember: 소속 그룹이면 통과하고 req.member 설정", async () => {
  const s = await authApp();
  try {
    assert.deepEqual(await (await call(s, "/api/groups/g1/x", TOK_A)).json(), { me: "mA" });
    assert.deepEqual(await (await call(s, "/api/boards/b1/x", TOK_A)).json(), { me: "mA" });
    assert.equal((await call(s, "/api/me", TOK_A)).status, 200);
    assert.equal((await call(s, "/api/groups/g1/x", TOK_A, "bearer " + TOK_A)).status, 200);
  } finally { await s.close(); }
});

test("requireMember: 남의 그룹·메뉴판은 403, 없는 id는 404", async () => {
  const s = await authApp();
  try {
    let r = await call(s, "/api/groups/g2/x", TOK_A);
    assert.equal(r.status, 403); assert.equal(await errCode(r), "FORBIDDEN");
    r = await call(s, "/api/boards/b2/x", TOK_A);
    assert.equal(r.status, 403); assert.equal(await errCode(r), "FORBIDDEN");
    r = await call(s, "/api/groups/nope/x", TOK_A);
    assert.equal(r.status, 404); assert.equal(await errCode(r), "NOT_FOUND");
    r = await call(s, "/api/boards/nope/x", TOK_A);
    assert.equal(r.status, 404); assert.equal(await errCode(r), "NOT_FOUND");
  } finally { await s.close(); }
});

test("requireMember: 토큰 확인(401)이 언제나 먼저 — 없는 id여도 토큰 없으면 401", async () => {
  const s = await authApp();
  try {
    assert.equal((await call(s, "/api/groups/nope/x")).status, 401);
    assert.equal((await call(s, "/api/boards/nope/x", "wrongToken")).status, 401);
    assert.equal((await call(s, "/api/groups/g2/x", TOK_GONE)).status, 401);
  } finally { await s.close(); }
});

test("requireMember: 조회 함수에 토큰 원문이 아닌 해시만 전달", async () => {
  const seen = [];
  const app = express();
  app.get("/x", requireMember({ ...lookups, findMemberByTokenHash: h => { seen.push(h); return null; } }), (q, r) => r.end());
  const s = await serve(app);
  try {
    await fetch(s.base + "/x", { headers: { Authorization: "Bearer " + TOK_A } });
    assert.deepEqual(seen, [hashToken(TOK_A)]);
    assert.ok(!seen.includes(TOK_A));
  } finally { await s.close(); }
});
