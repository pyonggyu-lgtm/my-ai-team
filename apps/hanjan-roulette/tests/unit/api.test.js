import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../../client/js/api.js";

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function setup(handler, extra = {}) {
  const calls = [], sleeps = [];
  const api = createApi({
    fetchFn: async (url, init) => { calls.push({ url, init }); return handler(calls.length, url, init); },
    getToken: () => "tok", sleep: async ms => { sleeps.push(ms); },
    timers: { setTimeout: () => 1, clearTimeout: () => {} }, ...extra,
  });
  return { api, calls, sleeps };
}

test("Authorization 헤더, JSON 본문, 쿼리(undefined 는 뺌), 캐시 안 씀", async () => {
  const { api, calls } = setup(() => res(200, { a: 1 }));
  const r = await api.history("b/1", { before: "2026-11-05", days: undefined });
  assert.deepEqual(r, { ok: true, status: 200, data: { a: 1 } });
  assert.equal(calls[0].url, "/api/boards/b%2F1/history?before=2026-11-05");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.cache, "no-store");
  await api.addItem("b1", { name: "x" });
  assert.equal(calls[1].init.body, '{"name":"x"}');
  assert.equal(calls[1].init.headers["Content-Type"], "application/json");
});

test("인증 없는 호출(health·그룹 만들기·초대)은 토큰을 보내지 않는다", async () => {
  const { api, calls } = setup(() => res(200, {}));
  await api.health(); await api.createGroup({ name: "g" }); await api.invitePreview("ABC234"); await api.join("ABC234", { nickname: "n" });
  assert.ok(calls.every(c => c.init.headers.Authorization === undefined));
});

test("네트워크 오류인 GET 은 1·2·4초 간격으로 3번 다시 해 본다(총 4번), 그래도 안 되면 NETWORK", async () => {
  const { api, calls, sleeps } = setup(() => { throw new TypeError("fail"); });
  const r = await api.state("g1");
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
  assert.equal(r.ok, false);
  assert.equal(r.network, true);
  assert.equal(r.code, "NETWORK");
  assert.ok(r.message.length > 0);
});

test("재시도 중 성공하면 거기서 끝", async () => {
  const { api, calls, sleeps } = setup(n => { if (n < 3) throw new TypeError("fail"); return res(200, { ok: 1 }); });
  const r = await api.state("g1");
  assert.equal(r.ok, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test("쓰기(POST·PATCH·PUT·DELETE)는 네트워크 오류여도 다시 보내지 않는다", async () => {
  for (const call of [a => a.confirm("b1", { name: "x" }), a => a.addItem("b1", { name: "x" }), a => a.setItemOn("b1", "i", true),
    a => a.reorderBoards("g1", []), a => a.deleteBoard("b1"), a => a.clearSkipped("b1")]) {
    const { api, calls, sleeps } = setup(() => { throw new TypeError("fail"); });
    const r = await call(api);
    assert.equal(r.network, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  }
});

test("서버 오류 응답(4xx)은 재시도하지 않고 code·message·error 를 돌려준다", async () => {
  const { api, calls } = setup(() => res(409, { error: { code: "ALREADY_CONFIRMED", message: "하나님이 국밥으로 확정했어요. 바꿀까요?", existing: { name: "국밥" } } }));
  const r = await api.state("g1");
  assert.equal(calls.length, 1);
  assert.deepEqual([r.ok, r.status, r.code, r.network], [false, 409, "ALREADY_CONFIRMED", undefined]);
  assert.equal(r.error.existing.name, "국밥");
});

test("본문이 JSON 이 아닌 오류(예: 502 HTML)도 던지지 않고 기본 문구", async () => {
  const { api } = setup(() => ({ status: 502, ok: false, json: async () => { throw new SyntaxError("x"); } }));
  const r = await api.createGroup({});
  assert.equal(r.ok, false);
  assert.equal(r.code, "HTTP_502");
  assert.equal(r.message, "잠시 후 다시 시도해 주세요.");
});

test("204 는 data null", async () => {
  const { api } = setup(() => res(204, null));
  assert.deepEqual(await api.leave("g1"), { ok: true, status: 204, data: null });
});

test("401·403 이면 onUnauthorized 를 부른다(인증 없는 호출은 안 부름)", async () => {
  const seen = [];
  const { api } = setup(n => res(n === 1 ? 401 : n === 2 ? 403 : 401, { error: { code: "X", message: "m" } }), { onUnauthorized: r => seen.push(r.status) });
  await api.state("g1"); await api.members("g1"); await api.join("ABC234", { nickname: "n" });
  assert.deepEqual(seen, [401, 403]);
});

test("모든 결과를 onResult 로 알린다(연결 상태 판단용)", async () => {
  const seen = [];
  const { api } = setup(n => { if (n === 1) throw new TypeError("x"); return res(404, { error: { code: "NOT_FOUND", message: "m" } }); },
    { onResult: r => seen.push(r.network ? "net" : r.status), retryDelays: [] });
  await api.state("g1"); await api.state("g1");
  assert.deepEqual(seen, ["net", 404]);
});

test("8초 시간 초과는 요청을 끊고 네트워크 오류로 본다", async () => {
  const fired = [];
  let abort;
  const api = createApi({
    fetchFn: (url, init) => new Promise((_, reject) => { abort = () => reject(new DOMException("aborted", "AbortError")); init.signal.addEventListener("abort", abort); }),
    timers: { setTimeout: (fn, ms) => { fired.push(ms); queueMicrotask(fn); return 1; }, clearTimeout: () => {} },
    retryDelays: [],
  });
  const r = await api.confirm("b1", { name: "x" });
  assert.deepEqual(fired, [8000]);
  assert.equal(r.network, true);
});
