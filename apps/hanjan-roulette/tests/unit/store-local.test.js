import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalStore, getBrowserStorage } from "../../client/js/store-local.js";
import { addDays } from "../../client/js/kst.js";
import { TEMPLATES } from "../../client/js/templates.js";

class FakeStorage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
// 한국 시각 12:00 = 03:00Z
function make(init, date = "2026-11-05") {
  const clock = { t: new Date(`${date}T03:00:00Z`) };
  let n = 0;
  const storage = new FakeStorage(init);
  const store = createLocalStore(storage, { now: () => clock.t, newId: () => "id" + ++n });
  return { store, storage, clock, setDate: d => { clock.t = new Date(`${d}T03:00:00Z`); } };
}
const firstBoard = async s => (await s.getState()).boards[0];

test("처음 실행: 점심 템플릿 메뉴판 1개가 만들어지고 저장된다", async () => {
  const { store, storage } = make();
  const st = await store.getState();
  assert.equal(st.today, "2026-11-05");
  assert.equal(st.boards.length, 1);
  assert.equal(st.boards[0].name, "점심");
  assert.equal(st.boards[0].resultLead, "오늘 점심은");
  assert.deepEqual(st.boards[0].items.map(i => i.name), TEMPLATES.lunch.items);
  assert.ok(st.boards[0].items.every(i => i.on));
  assert.ok(storage.getItem("hanjan.v1.boards"));
  assert.equal((await store.getState()).boards[0].id, st.boards[0].id); // 두 번째엔 새로 안 만듦
});
test("boards가 빈 배열이어도 점심 1개로 시작", async () => {
  const { store } = make({ "hanjan.v1.boards": "[]" });
  assert.equal((await store.getState()).boards.length, 1);
});
test("0단계 키(lunchRoulette.v1.*)는 읽지 않는다", async () => {
  const { store } = make({ "lunchRoulette.v1.items": JSON.stringify([{ name: "옛것", on: true }]) });
  const b = await firstBoard(store);
  assert.ok(!b.items.some(i => i.name === "옛것"));
});

test("깨진 JSON·모양이 틀린 값은 기본값으로 시작", async () => {
  const bad = {
    "hanjan.v1.boards": "{not json", "hanjan.v1.history": "[]",
    "hanjan.v1.skipped": "null", "hanjan.v1.device": "7",
  };
  const { store } = make(bad);
  const st = await store.getState();
  assert.equal(st.boards.length, 1);
  assert.deepEqual(st.history, { [st.boards[0].id]: [] });
  assert.deepEqual(st.skipped, { [st.boards[0].id]: [] });
  assert.deepEqual(await store.getDevice(), { sound: false, lastBoardId: null, nickname: "" });
});
test("boards가 배열이 아니면(객체) 기본값", async () => {
  const { store } = make({ "hanjan.v1.boards": '{"a":1}' });
  assert.equal((await store.getState()).boards[0].name, "점심");
});
test("모양이 틀린 메뉴판/메뉴 항목은 걸러낸다", async () => {
  const boards = [null, 5, { id: "b1", name: "내판", items: [{ id: "i1", name: "가", on: true }, { name: "id없음" }, 3] }];
  const { store } = make({ "hanjan.v1.boards": JSON.stringify(boards) });
  const st = await store.getState();
  assert.equal(st.boards.length, 1);
  assert.deepEqual(st.boards[0].items.map(i => i.name), ["가"]);
});
test("localStorage 접근이 모두 막혀도(getItem·setItem 예외) 죽지 않고 메모리에서 계속 동작", async () => {
  const boom = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  const store = createLocalStore(boom);
  const st = await store.getState();
  assert.equal(st.boards.length, 1);
  const id = st.boards[0].id;
  assert.equal((await store.getState()).boards[0].id, id); // 매번 새 메뉴판이 생기지 않음
  const r = await store.createBoard({ name: "새" });
  assert.deepEqual([r.ok, r.persisted], [true, false]);
  assert.equal((await store.getState()).boards.length, 2);
});
test("저장소가 막혀도 추가·확정·넘김·기록·설정이 메모리에 남는다", async () => {
  const boom = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  const store = createLocalStore(boom, { now: () => new Date("2026-11-05T03:00:00Z") });
  const b = (await store.getState()).boards[0];
  const added = await store.addItem(b.id, "새메뉴");
  assert.deepEqual([added.ok, added.persisted], [true, false]);
  await store.setItemOn(b.id, b.items[0].id, false);
  await store.addSkip(b.id, "국밥");
  let st = await store.getState();
  assert.equal(st.boards[0].items.at(-1).name, "새메뉴");
  assert.equal(st.boards[0].items[0].on, false);
  assert.deepEqual(st.skipped[b.id], ["국밥"]);
  const c = await store.confirm(b.id, "돈가스");
  assert.deepEqual([c.ok, c.persisted], [true, false]);
  st = await store.getState();
  assert.equal(st.history[b.id][0].name, "돈가스");
  assert.deepEqual(st.skipped[b.id], []);
  assert.deepEqual(await store.stats(b.id, 30), [{ name: "돈가스", count: 1 }]);
  await store.setDevice({ sound: true });
  assert.equal((await store.getDevice()).sound, true);
  assert.equal((await store.removeItem(b.id, b.items[1].id)).ok, true);
  assert.equal((await store.resetBoard(b.id)).ok, true);
  assert.equal((await store.deleteBoard(b.id)).code, "LAST_BOARD");
});
test("setItem만 실패(용량 초과 등)해도 변경이 유지되고, 이후 저장이 성공하면 persisted:true", async () => {
  const storage = new FakeStorage();
  let full = true;
  const orig = storage.setItem.bind(storage);
  storage.setItem = (k, v) => { if (full) throw new Error("quota"); orig(k, v); };
  const store = createLocalStore(storage);
  const b = (await store.getState()).boards[0];
  const r = await store.addItem(b.id, "새메뉴");
  assert.equal(r.persisted, false);
  assert.equal((await store.getState()).boards[0].items.at(-1).name, "새메뉴"); // 저장소엔 없지만 메모리 기준
  full = false;
  const r2 = await store.addItem(b.id, "또");
  assert.equal(r2.persisted, true);
  const names = (await store.getState()).boards[0].items.map(i => i.name);
  assert.ok(names.includes("새메뉴") && names.includes("또"));
  const again = createLocalStore(storage); // 새 탭에서도 둘 다 보임
  assert.deepEqual((await again.getState()).boards[0].items.map(i => i.name), names);
});
test("저장에 성공하면 persisted:true", async () => {
  const { store } = make();
  const b = await firstBoard(store);
  assert.equal((await store.addItem(b.id, "새메뉴")).persisted, true);
});
test("다른 탭이 저장한 값은 다음 읽기에 반영된다(메모리가 저장소를 덮어쓰지 않음)", async () => {
  const storage = new FakeStorage();
  const t1 = createLocalStore(storage), t2 = createLocalStore(storage);
  const b = (await t1.getState()).boards[0];
  await t2.addItem(b.id, "탭2에서추가");
  assert.ok((await t1.getState()).boards[0].items.some(i => i.name === "탭2에서추가"));
});
test("storage가 없어도(undefined) 죽지 않는다", async () => {
  const store = createLocalStore(undefined);
  assert.equal((await store.getState()).boards.length, 1);
});

test("메뉴판 10개까지, 11번째 거부", async () => {
  const { store } = make();
  for (let i = 0; i < 9; i++) assert.equal((await store.createBoard({ name: "판" + i })).ok, true);
  const r = await store.createBoard({ name: "열하나" });
  assert.deepEqual(r, { ok: false, code: "BOARD_LIMIT", message: "메뉴판은 10개까지 만들 수 있어요." });
  assert.equal((await store.getState()).boards.length, 10);
});
test("createBoard: 템플릿별 기본 이름·문구·메뉴", async () => {
  const { store } = make();
  const d = (await store.createBoard({ template: "drinks" })).board;
  assert.equal(d.name, "술 한잔");
  assert.equal(d.resultLead, "오늘 먹으러 갈 곳은");
  assert.equal(d.items.length, 8);
  const e = (await store.createBoard({ template: "empty" })).board;
  assert.equal(e.name, "새 메뉴판");
  assert.equal(e.resultLead, "오늘의 선택은");
  assert.deepEqual(e.items, []);
  const c = (await store.createBoard({ name: " 회식 ", resultLead: "가자", template: "drinks", excludeYesterday: false })).board;
  assert.equal(c.name, "회식"); assert.equal(c.resultLead, "가자"); assert.equal(c.excludeYesterday, false);
  assert.equal(c.template, "drinks");
});
test("createBoard: 이름 13자 거부, 12자 허용 / 결과 문구 21자 거부", async () => {
  const { store } = make();
  assert.equal((await store.createBoard({ name: "가".repeat(13) })).ok, false);
  assert.equal((await store.createBoard({ name: "가".repeat(12) })).ok, true);
  assert.equal((await store.createBoard({ resultLead: "가".repeat(21) })).ok, false);
});
test("id는 주입한 newId를 쓴다(기본은 crypto.randomUUID)", async () => {
  const store = createLocalStore(new FakeStorage());
  const b = await firstBoard(store);
  assert.match(b.id, /^[0-9a-f-]{36}$/);
});

test("마지막 1개 메뉴판은 삭제 불가", async () => {
  const { store } = make();
  const b = await firstBoard(store);
  assert.deepEqual(await store.deleteBoard(b.id), { ok: false, code: "LAST_BOARD", message: "메뉴판은 1개 이상 있어야 해요." });
});
test("deleteBoard: 기록·넘김·마지막 메뉴판 기억도 함께 지움", async () => {
  const { store } = make();
  const a = await firstBoard(store);
  const b = (await store.createBoard({ name: "B" })).board;
  await store.confirm(b.id, "x"); await store.addSkip(b.id, "y");
  await store.setDevice({ lastBoardId: b.id });
  assert.equal((await store.deleteBoard(b.id)).ok, true);
  const st = await store.getState();
  assert.deepEqual(st.boards.map(x => x.id), [a.id]);
  assert.equal(st.history[b.id], undefined);
  assert.equal(st.skipped[b.id], undefined);
  assert.equal((await store.getDevice()).lastBoardId, null);
  assert.deepEqual(await store.listHistory(b.id), { entries: [], hasMore: false, oldest: null });
});
test("updateBoard / reorderBoards", async () => {
  const { store } = make();
  const a = await firstBoard(store);
  const b = (await store.createBoard({ name: "B" })).board;
  const c = (await store.createBoard({ name: "C" })).board;
  assert.equal((await store.updateBoard(a.id, { name: "새이름", resultLead: "문구", excludeYesterday: false })).ok, true);
  const got = (await firstBoard(store));
  assert.equal(got.name, "새이름"); assert.equal(got.resultLead, "문구"); assert.equal(got.excludeYesterday, false);
  assert.equal((await store.updateBoard(a.id, { name: "" })).ok, false);
  assert.equal((await store.updateBoard("없음", { name: "x" })).code, "NOT_FOUND");
  await store.reorderBoards([c.id, a.id, b.id]);
  assert.deepEqual((await store.getState()).boards.map(x => x.id), [c.id, a.id, b.id]);
});

test("메뉴: 16개 제한·중복·21자·빈 이름 문구", async () => {
  const { store } = make();
  const b = await firstBoard(store);
  for (let i = 0; i < 8; i++) assert.equal((await store.addItem(b.id, "메뉴" + i)).ok, true);
  assert.deepEqual(await store.addItem(b.id, "넘침"), { ok: false, code: "ITEM_LIMIT", message: "16개까지 넣을 수 있어요." });
  assert.deepEqual(await store.addItem(b.id, "김치찌개"), { ok: false, code: "ITEM_LIMIT", message: "16개까지 넣을 수 있어요." }); // 원본 검사 순서: 개수 → 중복
  await store.removeItem(b.id, (await firstBoard(store)).items.at(-1).id);
  assert.deepEqual(await store.addItem(b.id, " 김치찌개 "), { ok: false, code: "DUPLICATE", message: "이미 있는 메뉴예요." });
  assert.equal((await store.addItem(b.id, "가".repeat(21))).ok, false);
  assert.equal((await store.addItem(b.id, "가".repeat(20))).ok, true);
  assert.equal((await store.addItem(b.id, "   ")).ok, false);
});
test("삭제 후 되돌리기: addItem(index)로 원래 자리에, 그사이 같은 이름이 생기면 중복 오류", async () => {
  const { store } = make();
  const b = await firstBoard(store);
  const target = b.items[2];
  const r = await store.removeItem(b.id, target.id);
  assert.equal(r.index, 2);
  assert.equal((await store.addItem(b.id, target.name, r.index)).ok, true);
  assert.deepEqual((await firstBoard(store)).items.map(i => i.name), b.items.map(i => i.name));
  const r2 = await store.removeItem(b.id, (await firstBoard(store)).items[2].id);
  await store.addItem(b.id, target.name);
  assert.equal((await store.addItem(b.id, target.name, r2.index)).code, "DUPLICATE");
});
test("setItemOn, resetBoard(템플릿 복원 / 빈 템플릿은 비움)", async () => {
  const { store } = make();
  const b = await firstBoard(store);
  await store.setItemOn(b.id, b.items[0].id, false);
  assert.equal((await firstBoard(store)).items[0].on, false);
  await store.addItem(b.id, "추가"); await store.removeItem(b.id, b.items[1].id);
  await store.resetBoard(b.id);
  const after = await firstBoard(store);
  assert.deepEqual(after.items.map(i => i.name), TEMPLATES.lunch.items);
  assert.ok(after.items.every(i => i.on));
  const e = (await store.createBoard({ template: "empty" })).board;
  await store.addItem(e.id, "하나");
  await store.resetBoard(e.id);
  assert.deepEqual((await store.getState()).boards.find(x => x.id === e.id).items, []);
});

test("메뉴판 A의 넘김·확정이 B에 영향 없음", async () => {
  const { store } = make();
  const a = await firstBoard(store);
  const b = (await store.createBoard({ template: "drinks" })).board;
  await store.addSkip(a.id, "김치찌개");
  await store.addSkip(a.id, "김치찌개"); // 중복은 한 번만
  await store.confirm(a.id, "돈가스");
  await store.addSkip(a.id, "국밥");
  const st = await store.getState();
  assert.deepEqual(st.skipped[a.id], ["국밥"]);
  assert.deepEqual(st.skipped[b.id], []);
  assert.deepEqual(st.history[b.id], []);
  assert.equal(st.history[a.id].length, 1);
});
test("확정하면 그 메뉴판의 넘김만 비움", async () => {
  const { store } = make();
  const a = await firstBoard(store);
  const b = (await store.createBoard({ template: "drinks" })).board;
  await store.addSkip(a.id, "김치찌개"); await store.addSkip(b.id, "고깃집");
  assert.deepEqual(await store.confirm(a.id, "돈가스", { overwrite: false }), { ok: true, persisted: true });
  const st = await store.getState();
  assert.deepEqual(st.skipped[a.id], []);
  assert.deepEqual(st.skipped[b.id], ["고깃집"]);
});
test("하루 1건: 같은 날 다시 확정하면 덮어씀(항상 ok)", async () => {
  const { store } = make();
  const a = await firstBoard(store);
  await store.confirm(a.id, "돈가스");
  assert.deepEqual(await store.confirm(a.id, "국밥", { overwrite: false }), { ok: true, persisted: true });
  const h = (await store.getState()).history[a.id];
  assert.equal(h.length, 1); assert.equal(h[0].name, "국밥"); assert.equal(h[0].date, "2026-11-05");
});
test("history는 날짜 오름차순으로 유지, 제한 없이 보관", async () => {
  const { store, setDate } = make();
  const a = await firstBoard(store);
  for (const d of ["2026-11-05", "2026-11-03", "2026-11-04"]) { setDate(d); await store.confirm(a.id, d); }
  for (let i = 0; i < 120; i++) { setDate(addDays("2026-06-01", i)); await store.confirm(a.id, "m"); }
  const h = (await store.getState()).history[a.id];
  assert.equal(h.length, 123);
  assert.deepEqual(h.map(x => x.date), [...h.map(x => x.date)].sort());
});
test("확정 기록에 device.nickname이 들어가고, 시각이 ISO로 저장됨", async () => {
  const { store } = make();
  const a = await firstBoard(store);
  await store.setDevice({ nickname: "민수" });
  await store.confirm(a.id, "국밥");
  const e = (await store.getState()).history[a.id][0];
  assert.equal(e.nickname, "민수");
  assert.equal(e.confirmedAt, "2026-11-05T03:00:00.000Z");
});
test("넘김은 날짜가 바뀌면 무시된다", async () => {
  const { store, setDate } = make();
  const a = await firstBoard(store);
  await store.addSkip(a.id, "국밥");
  setDate("2026-11-06");
  assert.deepEqual((await store.getState()).skipped[a.id], []);
  await store.addSkip(a.id, "비빔밥"); // 어제 것은 버리고 새로 시작
  assert.deepEqual((await store.getState()).skipped[a.id], ["비빔밥"]);
});
test("clearSkip", async () => {
  const { store } = make();
  const a = await firstBoard(store);
  await store.addSkip(a.id, "국밥"); await store.clearSkip(a.id);
  assert.deepEqual((await store.getState()).skipped[a.id], []);
});
test("한국 자정 경계: 23:59:59 / 00:00:00 확정은 서로 다른 날짜", async () => {
  const { store, clock } = make();
  const a = await firstBoard(store);
  clock.t = new Date("2026-11-05T14:59:59Z"); await store.confirm(a.id, "가");
  clock.t = new Date("2026-11-05T15:00:00Z"); await store.confirm(a.id, "나");
  assert.deepEqual((await store.getState()).history[a.id].map(e => e.date), ["2026-11-05", "2026-11-06"]);
});

test("listHistory / stats 위임", async () => {
  const { store, setDate } = make();
  const a = await firstBoard(store);
  for (let i = 0; i < 40; i++) { setDate(addDays("2026-10-01", i)); await store.confirm(a.id, i % 2 ? "국밥" : "돈가스"); }
  setDate("2026-11-09"); // 기록은 10-01 ~ 11-09(40일), 오늘 = 11-09
  const p1 = await store.listHistory(a.id);
  assert.equal(p1.entries.length, 30); assert.equal(p1.hasMore, true);
  assert.equal(p1.entries[0].date, "2026-11-09");
  const p2 = await store.listHistory(a.id, { before: p1.entries.at(-1).date });
  assert.equal(p1.entries.length + p2.entries.length, 40);
  const s = await store.stats(a.id, "all");
  assert.deepEqual(s, [{ name: "국밥", count: 20 }, { name: "돈가스", count: 20 }]);
  assert.deepEqual(await store.stats("없는판", 30), []);
});

test("device: 기본값·부분 갱신·잘못된 값 보정", async () => {
  const { store } = make();
  assert.deepEqual(await store.getDevice(), { sound: false, lastBoardId: null, nickname: "" });
  await store.setDevice({ sound: true });
  await store.setDevice({ lastBoardId: "b1" });
  assert.deepEqual(await store.getDevice(), { sound: true, lastBoardId: "b1", nickname: "" });
  await store.setDevice({ sound: "yes", nickname: 5 });
  assert.deepEqual(await store.getDevice(), { sound: false, lastBoardId: "b1", nickname: "" });
});
test("없는 메뉴판 id는 NOT_FOUND", async () => {
  const { store } = make();
  for (const r of [await store.addItem("x", "a"), await store.confirm("x", "a"), await store.addSkip("x", "a"),
    await store.resetBoard("x"), await store.deleteBoard("x")]) assert.equal(r.code, "NOT_FOUND");
});
test("subscribe: 접두어가 맞는 storage 이벤트만 전달, 해제 가능", async () => {
  const target = new EventTarget();
  const storage = new FakeStorage();
  const store = createLocalStore(storage, { target });
  const got = [];
  const off = store.subscribe(e => got.push(e.key));
  const fire = (key, area = storage) => { const ev = new Event("storage"); ev.key = key; ev.storageArea = area; target.dispatchEvent(ev); };
  fire("hanjan.v1.boards"); fire("other.key"); fire("hanjan.v1.history", new FakeStorage()); fire(null);
  off(); fire("hanjan.v1.boards");
  assert.deepEqual(got, ["hanjan.v1.boards", null]);
  assert.equal(typeof createLocalStore(storage, { target: {} }).subscribe(() => {}), "function");
});

test("globalThis.localStorage 를 읽기만 해도 throw 하면(사이트 데이터 차단) 메모리 전용으로 동작", async () => {
  const g = {};
  Object.defineProperty(g, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
  assert.throws(() => g.localStorage);
  const s = getBrowserStorage(g);
  s.setItem("a", "1");
  assert.equal(s.getItem("a"), "1");
  assert.equal(s.getItem("없음"), null);
  const store = createLocalStore(s);
  const b = (await store.getState()).boards[0];
  assert.equal((await store.addItem(b.id, "새메뉴")).ok, true);
  assert.equal((await store.getState()).boards[0].items.at(-1).name, "새메뉴");
});
test("getBrowserStorage: 정상 localStorage 는 그대로, null/불완전하면 메모리 저장소", () => {
  const ok = new FakeStorage();
  assert.equal(getBrowserStorage({ localStorage: ok }), ok);
  for (const g of [{}, { localStorage: null }, { localStorage: {} }]) {
    const s = getBrowserStorage(g);
    s.setItem("k", "v"); assert.equal(s.getItem("k"), "v");
  }
});
test("기본 인자(전역 localStorage 접근이 throw)여도 createLocalStore() 가 죽지 않는다", async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
  try {
    const store = createLocalStore();
    assert.equal((await store.getState()).boards.length, 1);
  } finally {
    if (had) Object.defineProperty(globalThis, "localStorage", had); else delete globalThis.localStorage;
  }
});
test("subscribe: storage 이벤트는 해당 key 의 dirty 만 푼다(다른 키 메모리 값 유지)", async () => {
  const target = new EventTarget();
  const storage = new FakeStorage();
  let full = true;
  const orig = storage.setItem.bind(storage);
  storage.setItem = (k, v) => { if (full) throw new Error("quota"); orig(k, v); };
  const store = createLocalStore(storage, { target, now: () => new Date("2026-11-05T03:00:00Z") });
  store.subscribe(() => {});
  const b = (await store.getState()).boards[0];
  await store.addItem(b.id, "메모리메뉴");            // boards: dirty
  await store.confirm(b.id, "국밥");                  // history, skipped: dirty
  full = false;
  const fire = (key, area = storage) => { const ev = new Event("storage"); ev.key = key; ev.storageArea = area; target.dispatchEvent(ev); };
  fire("hanjan.v1.history", new FakeStorage());       // 다른 저장소 → 무시
  fire("other.key");                                  // 접두어 아님 → 무시
  storage.setItem("hanjan.v1.history", JSON.stringify({ [b.id]: [{ date: "2026-11-04", name: "다른탭", nickname: "", confirmedAt: "" }] }));
  fire("hanjan.v1.history");                          // history 만 저장소 값으로
  const st = await store.getState();
  assert.deepEqual(st.history[b.id].map(e => e.name), ["다른탭"]);
  assert.ok(st.boards[0].items.some(i => i.name === "메모리메뉴")); // boards 는 아직 메모리 값
});

test("깨진 기록(date 형식이 틀리거나 name 이 문자열이 아님)은 읽을 때 버린다", async () => {
  const { store } = make();
  const b = await firstBoard(store);
  const good = { date: "2026-11-01", name: "국밥", nickname: "", confirmedAt: "" };
  const raw = { [b.id]: [good, { date: "", name: "x" }, { date: "2026-1-5", name: "x" }, { date: "2026-11-02", name: 7 },
    { date: 20261103, name: "x" }, null, { name: "날짜없음" }, { date: "2026-11-01 ", name: "공백" }] };
  const { store: s2 } = make({ "hanjan.v1.boards": JSON.stringify([{ ...b }]), "hanjan.v1.history": JSON.stringify(raw) });
  const st = await s2.getState();
  assert.deepEqual(st.history[b.id].map(e => e.name), ["국밥"]);
  assert.deepEqual(await s2.listHistory(b.id), { entries: [good], hasMore: false, oldest: "2026-11-01" });
  assert.deepEqual(await s2.stats(b.id, "all"), [{ name: "국밥", count: 1 }]);
});
