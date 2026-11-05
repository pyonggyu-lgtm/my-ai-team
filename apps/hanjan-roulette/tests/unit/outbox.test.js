import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutbox, OUTBOX_KEY } from "../../client/js/outbox.js";
import { fakeStorage, settle } from "./_fakes.js";

let n = 0;
const mk = (storage = fakeStorage()) => createOutbox({ storage, newId: () => "id" + ++n });
const confirm = (name, date = "2026-11-05", extra = {}) => ({ type: "confirm", boardId: "b1", name, date, ...extra });

test("쌓은 순서대로 하나씩 보내고, 다 보내면 비워진다", async () => {
  const ob = mk();
  ob.push({ type: "skipAdd", boardId: "b1", name: "국밥", date: "2026-11-05" });
  ob.push(confirm("돈가스"));
  ob.push({ type: "skipClear", boardId: "b1", date: "2026-11-05" });
  const sent = [];
  const r = await ob.flush(async it => { sent.push(it.type + ":" + (it.name ?? "")); return { status: "done" }; });
  assert.deepEqual(sent, ["skipAdd:국밥", "confirm:돈가스", "skipClear:"]);
  assert.equal(r.sent, 3);
  assert.equal(r.stopped, null);
  assert.equal(ob.size(), 0);
});

test("네트워크가 끊기면 그 항목에서 멈추고 남긴다(순서 유지), 다시 돌리면 이어서", async () => {
  const ob = mk();
  ob.push(confirm("가"));
  ob.push(confirm("나", "2026-11-04"));
  let calls = 0;
  const r1 = await ob.flush(async () => (++calls === 1 ? { status: "done" } : { status: "network" }));
  assert.equal(r1.stopped, "network");
  assert.deepEqual(ob.list().map(i => i.name), ["나"]);
  const seen = [];
  await ob.flush(async it => { seen.push(it.name); return { status: "done" }; });
  assert.deepEqual(seen, ["나"]);
  assert.equal(ob.size(), 0);
});

test("충돌(409)이면 멈추고 그 항목을 맨 앞에 남긴다 — 뒤 항목은 보내지 않는다", async () => {
  const ob = mk();
  ob.push(confirm("가"));
  ob.push({ type: "skipAdd", boardId: "b1", name: "나", date: "2026-11-05" });
  const sent = [];
  const r = await ob.flush(async it => { sent.push(it.type); return { status: "conflict", existing: { name: "다", nickname: "둘" } }; });
  assert.deepEqual(sent, ["confirm"]);
  assert.equal(r.stopped, "conflict");
  assert.deepEqual(r.conflict.existing, { name: "다", nickname: "둘" });
  assert.equal(r.conflict.item.name, "가");
  assert.equal(ob.size(), 2);
});

test("충돌 뒤 '바꾸기'는 맨 앞을 덮어쓰기로 바꿔 다시 보내고, '그대로 두기'는 그 항목을 버린다", async () => {
  const ob = mk();
  ob.push(confirm("가"));
  ob.push(confirm("나", "2026-11-04"));
  await ob.flush(async () => ({ status: "conflict", existing: {} }));
  ob.overwriteHead();
  const sent = [];
  await ob.flush(async it => { sent.push([it.name, it.overwrite]); return { status: "done" }; });
  assert.deepEqual(sent, [["가", true], ["나", false]]);

  ob.push(confirm("다"));
  ob.push(confirm("라", "2026-11-04"));
  await ob.flush(async () => ({ status: "conflict", existing: {} }));
  ob.removeHead();
  const sent2 = [];
  await ob.flush(async it => { sent2.push(it.name); return { status: "done" }; });
  assert.deepEqual(sent2, ["라"]);
});

test("버려야 하는 항목(오래된 날짜 400)은 알리고 다음 항목을 계속 보낸다", async () => {
  const ob = mk();
  ob.push(confirm("오래됨", "2026-10-01"));
  ob.push(confirm("최근"));
  const r = await ob.flush(async it => (it.name === "오래됨" ? { status: "dropped", reason: "VALIDATION" } : { status: "done" }));
  assert.equal(r.sent, 1);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].item.name, "오래됨");
  assert.equal(r.dropped[0].reason, "VALIDATION");
  assert.equal(ob.size(), 0);
});

test("동시에 두 번 돌리면 한 번만 보낸다(같은 결과를 기다림)", async () => {
  const ob = mk();
  ob.push(confirm("가"));
  let calls = 0;
  const send = async () => { calls++; await settle(2); return { status: "done" }; };
  const [a, b] = await Promise.all([ob.flush(send), ob.flush(send)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
});

test("비어 있어도 flush 가 멈춰 있지 않는다(다음 flush 가 정상 동작)", async () => {
  const ob = mk();
  await ob.flush(async () => ({ status: "done" }));
  ob.push(confirm("가"));
  const seen = [];
  await ob.flush(async it => { seen.push(it.name); return { status: "done" }; });
  assert.deepEqual(seen, ["가"]);
});

test("저장했다가 다시 열면 그대로(순서 포함), storage 에는 hanjan.v1.outbox 키", () => {
  const st = fakeStorage();
  const a = mk(st);
  a.push(confirm("가"));
  a.push({ type: "skipAdd", boardId: "b1", name: "나", date: "2026-11-05" });
  assert.ok(st._map.has("hanjan.v1.outbox"));
  assert.equal(OUTBOX_KEY, "hanjan.v1.outbox");
  const b = mk(st);
  assert.deepEqual(b.list().map(i => i.name), ["가", "나"]);
});

test("깨진 저장값·모양이 틀린 항목은 걸러낸다", () => {
  for (const raw of ["{깨짐", "null", '"x"', "[]", JSON.stringify([
    { id: "1", type: "confirm", boardId: "b", name: "가", date: "2026-11-05" },
    { id: "2", type: "confirm", boardId: "b", name: "날짜없음" },
    { id: "3", type: "confirm", boardId: "b", name: "날짜형식", date: "11/05" },
    { id: "4", type: "해킹", boardId: "b", name: "x" },
    { id: "5", type: "skipAdd", boardId: "b" },
    { type: "skipAdd", boardId: "b", name: "id없음" },
    null, 5,
  ])]) {
    const ob = mk(fakeStorage({ [OUTBOX_KEY]: raw }));
    assert.ok(ob.size() <= 1, raw.slice(0, 20));
  }
  const ok = mk(fakeStorage({ [OUTBOX_KEY]: JSON.stringify([{ id: "1", type: "confirm", boardId: "b", name: "가", date: "2026-11-05", 이상한: 1 }]) }));
  assert.deepEqual(ok.list(), [{ id: "1", type: "confirm", boardId: "b", name: "가", date: "2026-11-05", overwrite: false }]);
});

test("저장이 막혀 있어도(setItem 오류) 메모리에는 쌓인다", async () => {
  const st = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const ob = createOutbox({ storage: st, newId: () => "x" + ++n });
  ob.push(confirm("가"));
  assert.equal(ob.size(), 1);
});

test("3가지 말고는 못 넣는다, 확정은 날짜가 꼭 있어야 한다", () => {
  const ob = mk();
  assert.throws(() => ob.push({ type: "addItem", boardId: "b", name: "x" }));
  assert.throws(() => ob.push({ type: "confirm", boardId: "b", name: "x" }));
  assert.throws(() => ob.push({ type: "skipAdd", boardId: "b" }));
});

test("너무 쌓이면 가장 오래된 넘김부터 버리고 확정은 지킨다", () => {
  const ob = mk();
  ob.push(confirm("지킬확정"));
  for (let i = 0; i < 250; i++) ob.push({ type: "skipAdd", boardId: "b1", name: "s" + i, date: "2026-11-05" });
  assert.equal(ob.size(), 200);
  assert.equal(ob.list()[0].name, "지킬확정");
  assert.equal(ob.list().at(-1).name, "s249");
});

test("clear 는 모두 비운다(저장도)", () => {
  const st = fakeStorage();
  const ob = mk(st);
  ob.push(confirm("가"));
  ob.clear();
  assert.equal(ob.size(), 0);
  assert.equal(mk(st).size(), 0);
});

test("[E-2 권고1] 보내는 사이 대기열이 바뀌었으면(비움·새 항목) 보낸 항목이 맨 앞일 때만 지운다", async () => {
  const ob = mk();
  ob.push(confirm("가"));
  let first = true;
  await ob.flush(async it => {
    if (first) { first = false; ob.clear(); ob.push(confirm("새항목", "2026-11-04")); return { status: "done" }; }
    return { status: "network" }; // 두 번째 항목은 여기서 멈춰 남아 있는지 본다
  });
  assert.deepEqual(ob.list().map(i => i.name), ["새항목"], "다른 항목을 잘못 지우면 안 됨");
  // 버리는 경우도 마찬가지
  const ob2 = mk();
  ob2.push(confirm("가"));
  let first2 = true;
  await ob2.flush(async () => {
    if (first2) { first2 = false; ob2.clear(); ob2.push(confirm("새항목", "2026-11-04")); return { status: "dropped", reason: "VALIDATION" }; }
    return { status: "network" };
  });
  assert.deepEqual(ob2.list().map(i => i.name), ["새항목"]);
});

test("[E-2 권고2] isFlushing: 보내는 동안 true, 끝나면 false", async () => {
  const ob = mk();
  ob.push(confirm("가"));
  assert.equal(ob.isFlushing(), false);
  let release;
  const gate = new Promise(r => { release = r; });
  const p = ob.flush(async () => { await gate; return { status: "done" }; });
  await settle(2);
  assert.equal(ob.isFlushing(), true, "응답을 기다리는 중");
  release();
  await p;
  assert.equal(ob.isFlushing(), false);
});
