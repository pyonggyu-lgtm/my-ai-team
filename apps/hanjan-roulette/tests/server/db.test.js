// server/db.js 시험 — 임시 파일 DB(os.tmpdir) 사용, 시계는 주입.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../server/db.js";

let dir, db, clock;
const now = () => new Date(clock);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hanjan-db-"));
  clock = "2026-11-05T03:00:00.000Z"; // KST 12:00, 2026-11-05
  db = openDb(join(dir, "test.db"), { now });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const TODAY = "2026-11-05";
let seq = 0;
const hash = () => "h".repeat(10) + String(++seq).padStart(54, "0"); // 시험용 가짜 해시

function mkGroup(extra = {}) {
  return db.createGroup({ name: "회사", nickname: "하나", tokenHash: hash(), inviteCode: "ABC234", ...extra });
}
const rev = bid => db.sqlite.prepare("SELECT rev FROM boards WHERE id = ?").get(bid).rev;
const throwsCode = (fn, code) =>
  assert.throws(fn, e => { assert.equal(e.code, code); assert.ok(e.message.length > 0); return true; });

test("테이블·WAL·외래 키·열 확인", () => {
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of ["groups", "members", "boards", "items", "skipped", "history"]) assert.ok(tables.includes(t), t);
  assert.equal(db.sqlite.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(db.sqlite.pragma("foreign_keys", { simple: true }), 1);
  const cols = t => db.sqlite.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  assert.ok(cols("members").includes("left_at"));
  assert.ok(cols("boards").includes("rev"));
  assert.ok(cols("boards").includes("updated_at"));
});

test("같은 파일을 다시 열어도 테이블 만들기가 안전하다", () => {
  const p = join(dir, "again.db");
  openDb(p).close();
  openDb(p).close();
});

test("id는 12자 base64url", () => {
  const { group, member } = mkGroup();
  assert.match(group.id, /^[A-Za-z0-9_-]{12}$/);
  assert.match(member.id, /^[A-Za-z0-9_-]{12}$/);
});

test("그룹 만들기: 만든 사람이 첫 멤버·owner, 기본 '점심' 메뉴판 1개, DB엔 해시만", () => {
  const h = hash();
  const { group, member } = db.createGroup({ name: "회사", nickname: "하나", tokenHash: h, inviteCode: "ABC234" });
  assert.equal(group.ownerMemberId, member.id);
  assert.equal(group.inviteCode, "ABC234");
  const boards = db.boardsOf(group.id, TODAY);
  assert.equal(boards.length, 1);
  assert.equal(boards[0].name, "점심");
  assert.equal(boards[0].resultLead, "오늘 점심은");
  assert.equal(boards[0].template, "lunch");
  assert.equal(boards[0].items.length, 8);
  assert.ok(boards[0].items.every(i => i.isOn === true));
  assert.equal(db.sqlite.prepare("SELECT token_hash FROM members WHERE id = ?").get(member.id).token_hash, h);
  assert.equal(db.findMemberByTokenHash(h).id, member.id);
  assert.equal(db.findMemberByTokenHash("없는해시"), null);
});

test("초대 코드 중복은 거부(UNIQUE)", () => {
  mkGroup();
  assert.throws(() => mkGroup(), /UNIQUE/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) c FROM groups").get().c, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) c FROM boards").get().c, 1);
});

test("그룹 만들기에 1단계 메뉴판·기록 옮기기", () => {
  const { group, member } = mkGroup({
    boards: [
      { name: "점심", resultLead: "오늘 점심은", template: "lunch", excludeYesterday: true,
        items: [{ name: "국밥", isOn: true }, { name: "돈가스", isOn: false }],
        history: [{ date: "2026-11-04", name: "국밥" }, { date: "2026-11-03", name: "돈가스" }] },
      { name: "회식", resultLead: "오늘은", template: "drinks", excludeYesterday: false, items: [], history: [] },
    ],
  });
  const boards = db.boardsOf(group.id, TODAY);
  assert.deepEqual(boards.map(b => b.name), ["점심", "회식"]);
  assert.deepEqual(boards[0].items.map(i => [i.name, i.isOn]), [["국밥", true], ["돈가스", false]]);
  assert.equal(boards[0].excludeYesterday, true);
  assert.equal(boards[1].excludeYesterday, false);
  assert.equal(boards[0].yesterday, "국밥");
  const hist = db.historyEntries(boards[0].id);
  assert.deepEqual(hist.map(h => [h.date, h.name, h.nickname]), [["2026-11-04", "국밥", "하나"], ["2026-11-03", "돈가스", "하나"]]);
  assert.equal(db.sqlite.prepare("SELECT member_id FROM history WHERE board_id = ? LIMIT 1").get(boards[0].id).member_id, member.id);
});

test("옮기기는 전부 아니면 전혀: 하나라도 틀리면 그룹도 안 생김", () => {
  const tooMany = Array.from({ length: 17 }, (_, i) => ({ name: "m" + i, isOn: true }));
  throwsCode(() => mkGroup({ boards: [
    { name: "a", resultLead: "x", template: "empty", excludeYesterday: true, items: [], history: [] },
    { name: "b", resultLead: "x", template: "empty", excludeYesterday: true, items: tooMany, history: [] },
  ] }), "LIMIT_REACHED");
  throwsCode(() => mkGroup({ boards: [
    { name: "a", resultLead: "x", template: "empty", excludeYesterday: true,
      items: [{ name: "같은", isOn: true }, { name: "같은", isOn: true }], history: [] },
  ] }), "DUPLICATE_NAME");
  throwsCode(() => mkGroup({ boards: [
    { name: "a", resultLead: "x", template: "empty", excludeYesterday: true, items: [],
      history: [{ date: "2026-11-04", name: "가" }, { date: "2026-11-04", name: "나" }] },
  ] }), "VALIDATION");
  throwsCode(() => mkGroup({ boards: Array.from({ length: 11 }, (_, i) =>
    ({ name: "b" + i, resultLead: "x", template: "empty", excludeYesterday: true, items: [], history: [] })) }), "LIMIT_REACHED");
  for (const t of ["groups", "members", "boards", "items", "history"])
    assert.equal(db.sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, 0, t);
});

test("멤버 참여·목록·초대 코드 조회", () => {
  const { group } = mkGroup();
  const m2 = db.addMember({ groupId: group.id, nickname: "둘", tokenHash: hash() });
  assert.equal(db.getGroupByInvite("ABC234").id, group.id);
  assert.equal(db.getGroupByInvite("ZZZ999"), null);
  assert.equal(db.memberCount(group.id), 2);
  const list = db.listMembers(group.id);
  assert.deepEqual(list.map(m => [m.nickname, m.isOwner]), [["하나", true], ["둘", false]]);
  assert.equal(list[1].id, m2.id);
  assert.ok(list[0].joinedAt);
});

test("나간 멤버: 목록에서 빠지고 행·닉네임은 남음, 기록의 닉네임 유지", () => {
  const { group, member } = mkGroup();
  const m2 = db.addMember({ groupId: group.id, nickname: "둘", tokenHash: "tok2" });
  const [board] = db.boardsOf(group.id, TODAY);
  db.confirm({ boardId: board.id, date: TODAY, name: "국밥", memberId: m2.id, overwrite: false, confirmedAt: clock });
  const r = db.leaveMember({ groupId: group.id, memberId: m2.id });
  assert.equal(r.ok, true);
  assert.deepEqual(db.listMembers(group.id).map(m => m.nickname), ["하나"]);
  assert.equal(db.memberCount(group.id), 1);
  const found = db.findMemberByTokenHash("tok2");
  assert.ok(found.leftAt);
  assert.deepEqual(db.historyEntries(board.id).map(h => h.nickname), ["둘"]);
  assert.equal(db.boardView(board.id, TODAY).confirmed.nickname, "둘");
  assert.ok(member.id);
});

test("만든 사람은 다른 멤버가 남아 있으면 나갈 수 없다", () => {
  const { group, member } = mkGroup();
  db.addMember({ groupId: group.id, nickname: "둘", tokenHash: hash() });
  throwsCode(() => db.leaveMember({ groupId: group.id, memberId: member.id }), "VALIDATION");
  assert.equal(db.findMemberByTokenHash(db.sqlite.prepare("SELECT token_hash h FROM members WHERE id=?").get(member.id).h).leftAt, null);
});

test("만든 사람 혼자면 나갈 수 있다", () => {
  const { group, member } = mkGroup();
  assert.equal(db.leaveMember({ groupId: group.id, memberId: member.id }).ok, true);
});

test("history (board_id, date) 유일", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  const ins = () => db.sqlite.prepare("INSERT INTO history (board_id,date,name,member_id,confirmed_at) VALUES (?,?,?,?,?)")
    .run(b.id, TODAY, "국밥", member.id, clock);
  ins();
  assert.throws(ins, /UNIQUE/);
});

test("확정: 새로 → ok, 이미 있고 overwrite=false → existing, overwrite=true → 덮어쓰기(replaced)", () => {
  const { group, member } = mkGroup();
  const m2 = db.addMember({ groupId: group.id, nickname: "둘", tokenHash: hash() });
  const [b] = db.boardsOf(group.id, TODAY);
  const c1 = db.confirm({ boardId: b.id, date: TODAY, name: "국밥", memberId: member.id, overwrite: false, confirmedAt: "2026-11-05T03:00:01.000Z" });
  assert.equal(c1.ok, true);
  assert.equal(c1.replaced, null);
  assert.equal(c1.board.confirmed.name, "국밥");
  assert.equal(c1.entry.date, TODAY);

  const c2 = db.confirm({ boardId: b.id, date: TODAY, name: "돈가스", memberId: m2.id, overwrite: false, confirmedAt: "2026-11-05T03:00:02.000Z" });
  assert.equal(c2.ok, false);
  assert.deepEqual(c2.existing, { name: "국밥", nickname: "하나", confirmedAt: "2026-11-05T03:00:01.000Z", date: TODAY });
  assert.equal(db.boardView(b.id, TODAY).confirmed.name, "국밥");

  const r0 = rev(b.id);
  const c3 = db.confirm({ boardId: b.id, date: TODAY, name: "돈가스", memberId: m2.id, overwrite: true, confirmedAt: "2026-11-05T03:00:03.000Z" });
  assert.equal(c3.ok, true);
  assert.equal(c3.replaced.name, "국밥");
  assert.equal(c3.replaced.nickname, "하나");
  assert.deepEqual(db.boardView(b.id, TODAY).confirmed, { name: "돈가스", nickname: "둘", confirmedAt: "2026-11-05T03:00:03.000Z" });
  assert.equal(db.historyEntries(b.id).length, 1);
  assert.equal(rev(b.id), r0 + 1);
});

test("거부된 확정(409)은 rev를 올리지 않는다", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  db.confirm({ boardId: b.id, date: TODAY, name: "국밥", memberId: member.id, overwrite: false, confirmedAt: clock });
  const r0 = rev(b.id);
  assert.equal(db.confirm({ boardId: b.id, date: TODAY, name: "돈가스", memberId: member.id, overwrite: false, confirmedAt: clock }).ok, false);
  assert.equal(rev(b.id), r0);
});

test("오늘 확정하면 그 메뉴판의 오늘 넘김이 비워진다(다른 메뉴판·다른 날짜는 그대로)", () => {
  const { group, member } = mkGroup();
  const [b1] = db.boardsOf(group.id, TODAY);
  const b2 = db.createBoard({ groupId: group.id, name: "둘째", resultLead: "x", template: "lunch", excludeYesterday: true });
  db.addSkipped({ boardId: b1.id, name: "국밥" });
  db.addSkipped({ boardId: b2.id, name: "국밥" });
  assert.deepEqual(db.boardView(b1.id, TODAY).skipped, ["국밥"]);
  db.sqlite.prepare("INSERT INTO skipped (board_id,date,name) VALUES (?,?,?)").run(b1.id, "2026-11-04", "옛날");

  db.confirm({ boardId: b1.id, date: TODAY, name: "돈가스", memberId: member.id, overwrite: false, confirmedAt: clock });
  assert.deepEqual(db.boardView(b1.id, TODAY).skipped, []);
  assert.deepEqual(db.boardView(b2.id, TODAY).skipped, ["국밥"]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) c FROM skipped WHERE board_id=? AND date=?").get(b1.id, "2026-11-04").c, 1);
});

test("어제 날짜로 확정하면 오늘 넘김은 건드리지 않는다", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  db.addSkipped({ boardId: b.id, name: "국밥" });
  db.confirm({ boardId: b.id, date: "2026-11-04", name: "돈가스", memberId: member.id, overwrite: false, confirmedAt: clock });
  assert.deepEqual(db.boardView(b.id, TODAY).skipped, ["국밥"]);
  assert.equal(db.boardView(b.id, TODAY).yesterday, "돈가스");
  assert.equal(db.boardView(b.id, TODAY).confirmed, null);
});

test("확정 + 넘김 비우기는 한 트랜잭션: 중간에 실패하면 둘 다 원래대로", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  db.addSkipped({ boardId: b.id, name: "국밥" });
  const r0 = rev(b.id);
  // 마지막 단계(boards 갱신)에서 강제로 실패시킨다
  db.sqlite.exec("CREATE TRIGGER boom BEFORE UPDATE ON boards BEGIN SELECT RAISE(ABORT, 'boom'); END");
  assert.throws(() => db.confirm({ boardId: b.id, date: TODAY, name: "돈가스", memberId: member.id, overwrite: false, confirmedAt: clock }), /boom/);
  db.sqlite.exec("DROP TRIGGER boom");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) c FROM history").get().c, 0);
  assert.deepEqual(db.boardView(b.id, TODAY).skipped, ["국밥"]);
  assert.equal(rev(b.id), r0);
});

test("덮어쓰기 중간 실패도 원래 기록이 그대로", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  db.confirm({ boardId: b.id, date: TODAY, name: "국밥", memberId: member.id, overwrite: false, confirmedAt: clock });
  db.sqlite.exec("CREATE TRIGGER boom BEFORE UPDATE ON boards BEGIN SELECT RAISE(ABORT, 'boom'); END");
  assert.throws(() => db.confirm({ boardId: b.id, date: TODAY, name: "돈가스", memberId: member.id, overwrite: true, confirmedAt: clock }), /boom/);
  db.sqlite.exec("DROP TRIGGER boom");
  assert.equal(db.boardView(b.id, TODAY).confirmed.name, "국밥");
});

test("없는 메뉴판 확정은 NOT_FOUND, 이름이 메뉴판에 없어도 확정은 받는다", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  throwsCode(() => db.confirm({ boardId: "nope", date: TODAY, name: "x", memberId: member.id, overwrite: false, confirmedAt: clock }), "NOT_FOUND");
  assert.equal(db.confirm({ boardId: b.id, date: TODAY, name: "지워진메뉴", memberId: member.id, overwrite: false, confirmedAt: clock }).ok, true);
});

test("쓰기마다 rev가 정확히 1 오르고 updated_at이 갱신된다", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  const steps = [
    ["updateBoard", () => db.updateBoard(b.id, { name: "새이름" })],
    ["addItem", () => db.addItem({ boardId: b.id, name: "새메뉴" })],
    ["setItemOn", () => db.setItemOn({ boardId: b.id, itemId: db.boardView(b.id, TODAY).items[0].id, isOn: false })],
    ["deleteItem", () => db.deleteItem({ boardId: b.id, itemId: db.boardView(b.id, TODAY).items[1].id })],
    ["addSkipped", () => db.addSkipped({ boardId: b.id, name: "국밥" })],
    ["clearSkipped", () => db.clearSkipped(b.id)],
    ["resetBoard", () => db.resetBoard(b.id)],
    ["confirm", () => db.confirm({ boardId: b.id, date: TODAY, name: "국밥", memberId: member.id, overwrite: false, confirmedAt: clock })],
  ];
  let prev = rev(b.id);
  for (const [label, fn] of steps) {
    clock = new Date(Date.parse(clock) + 1000).toISOString();
    fn();
    const cur = rev(b.id);
    assert.equal(cur, prev + 1, label);
    assert.equal(db.sqlite.prepare("SELECT updated_at u FROM boards WHERE id=?").get(b.id).u, clock, label);
    prev = cur;
  }
});

test("넘김 추가는 같은 이름이 또 와도 오류 없이 멱등(rev는 처음에만)", () => {
  const { group } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  const v1 = db.addSkipped({ boardId: b.id, name: "국밥" });
  const v2 = db.addSkipped({ boardId: b.id, name: "국밥" });
  assert.deepEqual(v2.skipped, ["국밥"]);
  assert.equal(v2.rev, v1.rev);
});

test("메뉴판 직렬화 모양과 정렬", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  db.confirm({ boardId: b.id, date: "2026-11-04", name: "국밥", memberId: member.id, overwrite: false, confirmedAt: "2026-11-04T03:00:00.000Z" });
  db.confirm({ boardId: b.id, date: TODAY, name: "돈가스", memberId: member.id, overwrite: false, confirmedAt: "2026-11-05T03:00:00.000Z" });
  db.addSkipped({ boardId: b.id, name: "짜장면" });
  const v = db.boardView(b.id, TODAY);
  assert.deepEqual(Object.keys(v).sort(),
    ["confirmed", "excludeYesterday", "id", "items", "name", "resultLead", "rev", "skipped", "sortOrder", "template", "yesterday"].sort());
  assert.deepEqual(Object.keys(v.items[0]).sort(), ["id", "isOn", "name", "sortOrder"]);
  assert.deepEqual(v.items.map(i => i.sortOrder), [...v.items.map(i => i.sortOrder)].sort((a, c) => a - c));
  assert.equal(v.items[0].name, "김치찌개");
  assert.equal(v.yesterday, "국밥");
  assert.deepEqual(v.confirmed, { name: "돈가스", nickname: "하나", confirmedAt: "2026-11-05T03:00:00.000Z" });
  assert.deepEqual(v.skipped, ["짜장면"]);
  assert.equal(typeof v.excludeYesterday, "boolean");
  // 내일 기준이면 오늘 확정이 '어제'가 되고 오늘 확정·넘김은 없다
  const tm = db.boardView(b.id, "2026-11-06");
  assert.equal(tm.yesterday, "돈가스");
  assert.equal(tm.confirmed, null);
  assert.deepEqual(tm.skipped, []);
});

test("없는 메뉴판 boardView는 null", () => {
  assert.equal(db.boardView("nope", TODAY), null);
});

test("메뉴 제한: 16개·중복 이름, 거부되면 rev 그대로", () => {
  const { group } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY); // 8개
  for (let i = 0; i < 8; i++) db.addItem({ boardId: b.id, name: "추가" + i });
  assert.equal(db.boardView(b.id, TODAY).items.length, 16);
  const r0 = rev(b.id);
  throwsCode(() => db.addItem({ boardId: b.id, name: "열일곱째" }), "LIMIT_REACHED");
  throwsCode(() => db.addItem({ boardId: b.id, name: "국밥" }), "DUPLICATE_NAME");
  assert.equal(db.boardView(b.id, TODAY).items.length, 16);
  assert.equal(rev(b.id), r0);
  assert.throws(() => db.addItem({ boardId: b.id, name: "열일곱째" }), e => e.message === "16개까지 넣을 수 있어요.");
  assert.throws(() => db.addItem({ boardId: b.id, name: "국밥" }), e => e.message === "이미 있는 메뉴예요.");
});

test("메뉴판 제한: 11번째 거부, 마지막 메뉴판은 삭제 불가", () => {
  const { group } = mkGroup();
  for (let i = 0; i < 9; i++) db.createBoard({ groupId: group.id, name: "b" + i, resultLead: "x", template: "empty", excludeYesterday: true });
  assert.equal(db.boardsOf(group.id, TODAY).length, 10);
  assert.throws(() => db.createBoard({ groupId: group.id, name: "열한째", resultLead: "x", template: "empty", excludeYesterday: true }),
    e => e.code === "LIMIT_REACHED" && e.message === "메뉴판은 10개까지 만들 수 있어요.");
  assert.equal(db.boardsOf(group.id, TODAY).length, 10);

  const { group: g2 } = db.createGroup({ name: "둘째그룹", nickname: "나", tokenHash: hash(), inviteCode: "XYZ789" });
  const [only] = db.boardsOf(g2.id, TODAY);
  assert.throws(() => db.deleteBoard(only.id), e => e.code === "VALIDATION" && e.message === "메뉴판은 1개 이상 있어야 해요.");
  assert.ok(db.boardView(only.id, TODAY));
});

test("다른 그룹의 메뉴판 제한은 서로 영향 없음", () => {
  const { group } = mkGroup();
  for (let i = 0; i < 9; i++) db.createBoard({ groupId: group.id, name: "b" + i, resultLead: "x", template: "empty", excludeYesterday: true });
  const { group: g2 } = db.createGroup({ name: "다른", nickname: "나", tokenHash: hash(), inviteCode: "XYZ789" });
  db.createBoard({ groupId: g2.id, name: "ok", resultLead: "x", template: "empty", excludeYesterday: true });
});

test("메뉴판 삭제 시 items·skipped·history 함께 삭제(CASCADE)", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  const b2 = db.createBoard({ groupId: group.id, name: "둘째", resultLead: "x", template: "lunch", excludeYesterday: true });
  db.addSkipped({ boardId: b.id, name: "국밥" });
  db.confirm({ boardId: b.id, date: "2026-11-04", name: "국밥", memberId: member.id, overwrite: false, confirmedAt: clock });
  db.deleteBoard(b.id);
  const count = t => db.sqlite.prepare(`SELECT COUNT(*) c FROM ${t} WHERE board_id = ?`).get(b.id).c;
  assert.equal(count("items"), 0);
  assert.equal(count("skipped"), 0);
  assert.equal(count("history"), 0);
  assert.equal(db.boardView(b.id, TODAY), null);
  assert.ok(db.boardView(b2.id, TODAY).items.length > 0);
});

test("메뉴 되돌리기용 sortOrder 지정 삽입, 기본은 맨 뒤", () => {
  const { group } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  const first = b.items[0];
  db.deleteItem({ boardId: b.id, itemId: first.id });
  const v = db.addItem({ boardId: b.id, name: first.name, sortOrder: first.sortOrder });
  assert.equal(v.items[0].name, first.name);
  assert.equal(v.items.length, 8);
  const v2 = db.addItem({ boardId: b.id, name: "맨뒤" });
  assert.equal(v2.items.at(-1).name, "맨뒤");
  const orders = v2.items.map(i => i.sortOrder);
  assert.equal(new Set(orders).size, orders.length);
});

test("다른 메뉴판의 메뉴 id로는 바꿀 수 없다", () => {
  const { group } = mkGroup();
  const [b1] = db.boardsOf(group.id, TODAY);
  const b2 = db.createBoard({ groupId: group.id, name: "둘째", resultLead: "x", template: "lunch", excludeYesterday: true });
  throwsCode(() => db.setItemOn({ boardId: b2.id, itemId: b1.items[0].id, isOn: false }), "NOT_FOUND");
  throwsCode(() => db.deleteItem({ boardId: b2.id, itemId: b1.items[0].id }), "NOT_FOUND");
  assert.equal(db.boardView(b1.id, TODAY).items[0].isOn, true);
});

test("템플릿으로 되돌리기: 메뉴가 템플릿대로, 기록은 유지", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  db.addItem({ boardId: b.id, name: "새거" });
  db.confirm({ boardId: b.id, date: TODAY, name: "국밥", memberId: member.id, overwrite: false, confirmedAt: clock });
  const v = db.resetBoard(b.id);
  assert.equal(v.items.length, 8);
  assert.ok(!v.items.some(i => i.name === "새거"));
  assert.equal(db.historyEntries(b.id).length, 1);
});

test("메뉴판 순서 바꾸기·수정", () => {
  const { group } = mkGroup();
  const [a] = db.boardsOf(group.id, TODAY);
  const b = db.createBoard({ groupId: group.id, name: "B", resultLead: "x", template: "empty", excludeYesterday: true });
  const c = db.createBoard({ groupId: group.id, name: "C", resultLead: "x", template: "empty", excludeYesterday: true });
  assert.deepEqual(db.boardsOf(group.id, TODAY).map(x => x.name), ["점심", "B", "C"]);
  const ra = rev(a.id);
  db.reorderBoards(group.id, [c.id, a.id, b.id]);
  assert.deepEqual(db.boardsOf(group.id, TODAY).map(x => x.name), ["C", "점심", "B"]);
  assert.equal(rev(a.id), ra + 1);
  // 목록이 그룹의 메뉴판과 정확히 같지 않으면 거부
  throwsCode(() => db.reorderBoards(group.id, [c.id, a.id]), "VALIDATION");
  throwsCode(() => db.reorderBoards(group.id, [c.id, a.id, b.id, "x"]), "VALIDATION");
  throwsCode(() => db.reorderBoards(group.id, [c.id, c.id, a.id]), "VALIDATION");
  const v = db.updateBoard(a.id, { name: "저녁", resultLead: "오늘 저녁은", excludeYesterday: false });
  assert.deepEqual([v.name, v.resultLead, v.excludeYesterday], ["저녁", "오늘 저녁은", false]);
});

test("메뉴 id로 메뉴판·그룹을 거슬러 올라갈 수 있다(권한 확인용)", () => {
  const { group } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  assert.equal(db.groupIdOfBoard(b.id), group.id);
  assert.equal(db.groupIdOfBoard("nope"), null);
  assert.equal(db.getGroup(group.id).name, "회사");
  assert.equal(db.getGroup("nope"), null);
});

test("기록 목록은 닉네임을 붙여 최신순", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  for (const [d, n] of [["2026-11-01", "가"], ["2026-11-03", "나"], ["2026-11-02", "다"]])
    db.confirm({ boardId: b.id, date: d, name: n, memberId: member.id, overwrite: false, confirmedAt: d + "T03:00:00.000Z" });
  const h = db.historyEntries(b.id);
  assert.deepEqual(h.map(x => x.date), ["2026-11-03", "2026-11-02", "2026-11-01"]);
  assert.deepEqual(Object.keys(h[0]).sort(), ["confirmedAt", "date", "name", "nickname"]);
});

test("확정 시각 날짜는 주입한 now()로 오늘이 정해진다(KST 자정 경계)", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  db.addSkipped({ boardId: b.id, name: "국밥" }); // 2026-11-05 KST
  clock = "2026-11-05T15:00:00.000Z"; // KST 11-06 00:00:00
  // 11-05는 이제 '어제' → 넘김을 비우지 않는다
  db.confirm({ boardId: b.id, date: "2026-11-05", name: "돈가스", memberId: member.id, overwrite: false, confirmedAt: clock });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) c FROM skipped WHERE board_id=? AND date='2026-11-05'").get(b.id).c, 1);
  assert.deepEqual(db.boardView(b.id, "2026-11-06").skipped, []);
  assert.equal(db.boardView(b.id, "2026-11-06").yesterday, "돈가스");
});

test("[진육 권고1] undefined 값은 템플릿 기본값을 덮어쓰지 않는다", () => {
  const { group } = mkGroup();
  const v = db.createBoard({ groupId: group.id, name: undefined, resultLead: undefined, template: "drinks", excludeYesterday: undefined });
  assert.equal(v.name, "술 한잔");
  assert.equal(v.resultLead, "오늘 먹으러 갈 곳은");
  assert.equal(v.excludeYesterday, true);
  assert.equal(v.items.length, 8);
});

test("[진육 권고2] 어제 메뉴는 오늘 이전 기록에서만(미래 날짜 기록은 무시)", () => {
  const { group, member } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  for (const [d, n] of [["2026-11-04", "국밥"], ["2026-11-07", "미래"]])
    db.confirm({ boardId: b.id, date: d, name: n, memberId: member.id, overwrite: false, confirmedAt: clock });
  assert.equal(db.boardView(b.id, TODAY).yesterday, "국밥");
});

test("[C권고4] 넘김은 오늘 16개까지, 이미 있는 이름은 가득 차도 멱등", () => {
  const { group } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  for (let i = 0; i < 16; i++) db.addSkipped({ boardId: b.id, name: "n" + i });
  const r0 = rev(b.id);
  throwsCode(() => db.addSkipped({ boardId: b.id, name: "열일곱째" }), "LIMIT_REACHED");
  assert.equal(rev(b.id), r0);
  assert.equal(db.addSkipped({ boardId: b.id, name: "n3" }).rev, r0);
});

test("[C권고5] 메뉴 자리 번호는 넣기·지우기 때 0부터 다시 매겨진다", () => {
  const { group } = mkGroup();
  const [b] = db.boardsOf(group.id, TODAY);
  const orders = () => db.boardView(b.id, TODAY).items.map(i => i.sortOrder);
  for (let i = 0; i < 20; i++) {
    const v = db.boardView(b.id, TODAY);
    db.deleteItem({ boardId: b.id, itemId: v.items[i % 3].id });
    db.addItem({ boardId: b.id, name: "새" + i });
    assert.deepEqual(orders(), Array.from({ length: 8 }, (_, k) => k));
  }
  const v = db.addItem({ boardId: b.id, name: "중간" , sortOrder: 99 }); // 8개 → 16개 제한 안, 끝보다 크면 맨 끝
  assert.equal(v.items.at(-1).name, "중간");
  const v2 = db.addItem({ boardId: b.id, name: "둘째", sortOrder: 1 });
  assert.equal(v2.items[1].name, "둘째");
  assert.deepEqual(v2.items.map(i => i.sortOrder), v2.items.map((_, k) => k));
});

test("[D-2⑥] addMember: 활성 멤버 30명이 넘으면 LIMIT_REACHED, 나간 멤버는 세지 않는다", () => {
  const { group } = mkGroup();
  const ids = [];
  for (let i = 1; i < 30; i++) ids.push(db.addMember({ groupId: group.id, nickname: "m" + i, tokenHash: hash() }).id);
  assert.equal(db.memberCount(group.id), 30);
  assert.throws(() => db.addMember({ groupId: group.id, nickname: "x", tokenHash: hash() }), e => e.code === "LIMIT_REACHED" && e.message === "이 그룹은 30명까지 들어올 수 있어요.");
  db.leaveMember({ groupId: group.id, memberId: ids[0] });
  db.addMember({ groupId: group.id, nickname: "x", tokenHash: hash() });
  assert.equal(db.memberCount(group.id), 30);
});
