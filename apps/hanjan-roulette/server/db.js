// SQLite(better-sqlite3, 동기) 저장소 — 설계 5장 테이블과 3.3 규칙.
// 쓰기는 모두 하나의 트랜잭션 안에서 하고, 메뉴판에 닿는 쓰기는 rev+1·updated_at 갱신을 같이 한다.
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { todayKST } from "../client/js/kst.js";
import { yesterdayName } from "../client/js/pool.js";
import { DATE_RE } from "../client/js/records.js";
import { TEMPLATES, MAX_ITEMS, MAX_BOARDS, MAX_MEMBERS } from "../client/js/templates.js";

export class DbError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}
const fail = (code, message) => { throw new DbError(code, message); };

const MSG = {
  itemLimit: "16개까지 넣을 수 있어요.",
  dupItem: "이미 있는 메뉴예요.",
  boardLimit: "메뉴판은 10개까지 만들 수 있어요.",
  memberLimit: "이 그룹은 30명까지 들어올 수 있어요.",
  lastBoard: "메뉴판은 1개 이상 있어야 해요.",
  ownerLeave: "다른 멤버가 있으면 만든 사람은 나갈 수 없어요.",
  noBoard: "메뉴판을 찾을 수 없어요.",
  noItem: "메뉴를 찾을 수 없어요.",
  noGroup: "그룹을 찾을 수 없어요.",
  badData: "보낸 내용이 올바르지 않아요.",
  skipLimit: "오늘 넘긴 메뉴가 너무 많아요.",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  owner_member_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL,
  left_at TEXT
);
CREATE INDEX IF NOT EXISTS members_group ON members(group_id);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  result_lead TEXT NOT NULL,
  template TEXT NOT NULL,
  exclude_yesterday INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS boards_group ON boards(group_id, sort_order);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_on INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  UNIQUE (board_id, name)
);
CREATE TABLE IF NOT EXISTS skipped (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (board_id, date, name)
);
CREATE TABLE IF NOT EXISTS history (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  confirmed_at TEXT NOT NULL,
  UNIQUE (board_id, date)
);
CREATE INDEX IF NOT EXISTS history_board_date ON history(board_id, date DESC);
`;

export const newId = () => randomBytes(9).toString("base64url"); // 12자

export function openDb(path, { now = () => new Date() } = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA);

  const nowIso = () => now().toISOString();
  const todayNow = () => todayKST(now());
  // 쓰기 트랜잭션: 시작부터 쓰기 잠금(BEGIN IMMEDIATE) → 검사와 쓰기 사이에 끼어들 틈이 없다.
  const tx = fn => sqlite.transaction(fn).immediate;

  const q = {
    group: sqlite.prepare("SELECT * FROM groups WHERE id = ?"),
    groupByInvite: sqlite.prepare("SELECT * FROM groups WHERE invite_code = ?"),
    board: sqlite.prepare("SELECT * FROM boards WHERE id = ?"),
    boardsOfGroup: sqlite.prepare("SELECT id FROM boards WHERE group_id = ? ORDER BY sort_order, id"),
    boardCount: sqlite.prepare("SELECT COUNT(*) c FROM boards WHERE group_id = ?"),
    items: sqlite.prepare("SELECT id, name, is_on, sort_order FROM items WHERE board_id = ? ORDER BY sort_order, id"),
    itemOf: sqlite.prepare("SELECT * FROM items WHERE id = ? AND board_id = ?"),
    itemCount: sqlite.prepare("SELECT COUNT(*) c FROM items WHERE board_id = ?"),
    itemByName: sqlite.prepare("SELECT 1 FROM items WHERE board_id = ? AND name = ?"),
    maxItemOrder: sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) m FROM items WHERE board_id = ?"),
    skippedNames: sqlite.prepare("SELECT name FROM skipped WHERE board_id = ? AND date = ? ORDER BY rowid"),
    historyOne: sqlite.prepare(
      `SELECT h.date, h.name, h.member_id, h.confirmed_at, m.nickname
         FROM history h JOIN members m ON m.id = h.member_id WHERE h.board_id = ? AND h.date = ?`),
    historyAll: sqlite.prepare(
      `SELECT h.date, h.name, m.nickname, h.confirmed_at
         FROM history h JOIN members m ON m.id = h.member_id WHERE h.board_id = ? ORDER BY h.date DESC`),
    historyLast2: sqlite.prepare("SELECT date, name FROM history WHERE board_id = ? AND date <= ? ORDER BY date DESC LIMIT 2"),
    touch: sqlite.prepare("UPDATE boards SET rev = rev + 1, updated_at = ? WHERE id = ?"),
    member: sqlite.prepare("SELECT * FROM members WHERE id = ?"),
    memberByHash: sqlite.prepare("SELECT * FROM members WHERE token_hash = ?"),
    activeMembers: sqlite.prepare("SELECT * FROM members WHERE group_id = ? AND left_at IS NULL ORDER BY joined_at, rowid"),
    activeCount: sqlite.prepare("SELECT COUNT(*) c FROM members WHERE group_id = ? AND left_at IS NULL"),
  };

  // 메뉴 자리 번호를 0부터 다시 매긴다(넣기·지우기를 반복해도 번호가 커지지 않게)
  const renumberItems = boardId => {
    const upd = sqlite.prepare("UPDATE items SET sort_order = ? WHERE id = ?");
    q.items.all(boardId).forEach((it, i) => { if (it.sort_order !== i) upd.run(i, it.id); });
  };
  const touch = boardId => q.touch.run(nowIso(), boardId);

  // ---- 직렬화 ----
  function boardView(boardId, today) {
    const b = q.board.get(boardId);
    if (!b) return null;
    const hist = q.historyLast2.all(boardId, today).reverse(); // 오래된 → 최신, 오늘(이전) + 그 전 하나면 충분
    const c = q.historyOne.get(boardId, today);
    return {
      id: b.id,
      name: b.name,
      resultLead: b.result_lead,
      template: b.template,
      excludeYesterday: !!b.exclude_yesterday,
      sortOrder: b.sort_order,
      rev: b.rev,
      items: q.items.all(boardId).map(i => ({ id: i.id, name: i.name, isOn: !!i.is_on, sortOrder: i.sort_order })),
      skipped: q.skippedNames.all(boardId, today).map(r => r.name),
      confirmed: c ? { name: c.name, nickname: c.nickname, confirmedAt: c.confirmed_at } : null,
      yesterday: yesterdayName(hist, today),
    };
  }
  const viewNow = boardId => boardView(boardId, todayNow());

  function boardsOf(groupId, today) {
    return q.boardsOfGroup.all(groupId).map(r => boardView(r.id, today));
  }

  const mustBoard = boardId => q.board.get(boardId) ?? fail("NOT_FOUND", MSG.noBoard);

  // ---- 메뉴판 만들기(내부) ----
  // spec: { name, resultLead, template, excludeYesterday, items:[{name,isOn}], history:[{date,name,confirmedAt?}] }
  function insertBoard(groupId, spec, memberId) {
    if (q.boardCount.get(groupId).c >= MAX_BOARDS) fail("LIMIT_REACHED", MSG.boardLimit);
    const items = spec.items ?? [];
    if (items.length > MAX_ITEMS) fail("LIMIT_REACHED", MSG.itemLimit);
    if (new Set(items.map(i => i.name)).size !== items.length) fail("DUPLICATE_NAME", MSG.dupItem);
    const hist = spec.history ?? [];
    if (new Set(hist.map(h => h.date)).size !== hist.length) fail("VALIDATION", MSG.badData);
    const id = newId();
    const at = nowIso();
    const order = sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM boards WHERE group_id = ?").get(groupId).n;
    sqlite.prepare(
      `INSERT INTO boards (id, group_id, name, result_lead, template, exclude_yesterday, sort_order, updated_at, rev)
       VALUES (?,?,?,?,?,?,?,?,1)`)
      .run(id, groupId, spec.name, spec.resultLead, spec.template, spec.excludeYesterday === false ? 0 : 1, order, at);
    const insItem = sqlite.prepare("INSERT INTO items (id, board_id, name, is_on, sort_order) VALUES (?,?,?,?,?)");
    items.forEach((it, i) => insItem.run(newId(), id, it.name, it.isOn === false ? 0 : 1, i));
    const insHist = sqlite.prepare("INSERT INTO history (board_id, date, name, member_id, confirmed_at) VALUES (?,?,?,?,?)");
    for (const h of hist) {
      if (typeof h.date !== "string" || !DATE_RE.test(h.date)) fail("VALIDATION", MSG.badData);
      insHist.run(id, h.date, h.name, memberId, h.confirmedAt ?? at);
    }
    return id;
  }

  const templateSpec = (templateId, overrides = {}) => {
    const t = TEMPLATES[templateId] ?? fail("VALIDATION", MSG.badData);
    return {
      name: t.name, resultLead: t.resultLead, template: t.id, excludeYesterday: true,
      items: t.items.map(name => ({ name, isOn: true })), history: [],
      // undefined 인 값은 템플릿 기본값을 덮어쓰지 않는다
      ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
    };
  };

  // ---- 공개 함수 ----
  const api = {
    sqlite,
    close() { sqlite.close(); },
    boardView,
    boardsOf,

    // ---- 그룹·멤버 ----
    createGroup: tx(({ name, nickname, tokenHash, inviteCode, boards }) => {
      const at = nowIso();
      const groupId = newId();
      const memberId = newId();
      sqlite.prepare("INSERT INTO groups (id, name, invite_code, owner_member_id, created_at) VALUES (?,?,?,NULL,?)")
        .run(groupId, name, inviteCode, at);
      sqlite.prepare("INSERT INTO members (id, group_id, nickname, token_hash, joined_at) VALUES (?,?,?,?,?)")
        .run(memberId, groupId, nickname, tokenHash, at);
      sqlite.prepare("UPDATE groups SET owner_member_id = ? WHERE id = ?").run(memberId, groupId);
      const specs = boards?.length ? boards : [templateSpec("lunch")];
      for (const spec of specs) insertBoard(groupId, spec, memberId);
      return {
        group: { id: groupId, name, inviteCode, ownerMemberId: memberId, createdAt: at },
        member: { id: memberId, nickname, joinedAt: at },
      };
    }),

    getGroup(groupId) {
      const g = q.group.get(groupId);
      return g ? { id: g.id, name: g.name, inviteCode: g.invite_code, ownerMemberId: g.owner_member_id, createdAt: g.created_at } : null;
    },
    getGroupByInvite(code) {
      const g = q.groupByInvite.get(code);
      return g ? { id: g.id, name: g.name, inviteCode: g.invite_code, ownerMemberId: g.owner_member_id, createdAt: g.created_at } : null;
    },
    groupIdOfBoard(boardId) {
      return q.board.get(boardId)?.group_id ?? null;
    },
    memberCount(groupId) {
      return q.activeCount.get(groupId).c;
    },
    addMember: tx(({ groupId, nickname, tokenHash }) => {
      if (!q.group.get(groupId)) fail("NOT_FOUND", MSG.noGroup);
      if (q.activeCount.get(groupId).c >= MAX_MEMBERS) fail("LIMIT_REACHED", MSG.memberLimit);
      const id = newId();
      const at = nowIso();
      sqlite.prepare("INSERT INTO members (id, group_id, nickname, token_hash, joined_at) VALUES (?,?,?,?,?)")
        .run(id, groupId, nickname, tokenHash, at);
      return { id, nickname, joinedAt: at };
    }),
    // 나간 멤버도 돌려준다(leftAt 이 있으면 호출한 쪽이 401 처리).
    findMemberByTokenHash(tokenHash) {
      const m = q.memberByHash.get(tokenHash);
      return m ? { id: m.id, groupId: m.group_id, nickname: m.nickname, joinedAt: m.joined_at, leftAt: m.left_at } : null;
    },
    getMember(memberId) {
      const m = q.member.get(memberId);
      return m ? { id: m.id, groupId: m.group_id, nickname: m.nickname, joinedAt: m.joined_at, leftAt: m.left_at } : null;
    },
    listMembers(groupId) {
      const owner = q.group.get(groupId)?.owner_member_id;
      return q.activeMembers.all(groupId).map(m => ({ id: m.id, nickname: m.nickname, isOwner: m.id === owner, joinedAt: m.joined_at }));
    },
    leaveMember: tx(({ groupId, memberId }) => {
      const m = q.member.get(memberId);
      if (!m || m.group_id !== groupId || m.left_at) fail("NOT_FOUND", MSG.noGroup);
      const g = q.group.get(groupId);
      if (g.owner_member_id === memberId && q.activeCount.get(groupId).c > 1) fail("VALIDATION", MSG.ownerLeave);
      sqlite.prepare("UPDATE members SET left_at = ? WHERE id = ?").run(nowIso(), memberId);
      return { ok: true };
    }),

    // ---- 메뉴판 ----
    createBoard: tx(({ groupId, name, resultLead, template, excludeYesterday = true }) => {
      if (!q.group.get(groupId)) fail("NOT_FOUND", MSG.noGroup);
      const id = insertBoard(groupId, templateSpec(template, { name, resultLead, excludeYesterday }), null);
      return viewNow(id);
    }),
    updateBoard: tx((boardId, patch) => {
      const b = mustBoard(boardId);
      const name = patch.name ?? b.name;
      const lead = patch.resultLead ?? b.result_lead;
      const ex = patch.excludeYesterday === undefined ? b.exclude_yesterday : (patch.excludeYesterday ? 1 : 0);
      sqlite.prepare("UPDATE boards SET name = ?, result_lead = ?, exclude_yesterday = ? WHERE id = ?").run(name, lead, ex, boardId);
      touch(boardId);
      return viewNow(boardId);
    }),
    deleteBoard: tx(boardId => {
      const b = mustBoard(boardId);
      if (q.boardCount.get(b.group_id).c <= 1) fail("VALIDATION", MSG.lastBoard);
      sqlite.prepare("DELETE FROM boards WHERE id = ?").run(boardId); // items·skipped·history 는 CASCADE
      return { groupId: b.group_id };
    }),
    reorderBoards: tx((groupId, boardIds) => {
      const current = q.boardsOfGroup.all(groupId).map(r => r.id);
      const ok = Array.isArray(boardIds) && boardIds.length === current.length
        && new Set(boardIds).size === boardIds.length && boardIds.every(id => current.includes(id));
      if (!ok) fail("VALIDATION", MSG.badData);
      const upd = sqlite.prepare("UPDATE boards SET sort_order = ? WHERE id = ?");
      boardIds.forEach((id, i) => { upd.run(i, id); touch(id); });
      return boardsOf(groupId, todayNow());
    }),
    resetBoard: tx(boardId => {
      const b = mustBoard(boardId);
      const t = TEMPLATES[b.template] ?? TEMPLATES.empty;
      sqlite.prepare("DELETE FROM items WHERE board_id = ?").run(boardId);
      const ins = sqlite.prepare("INSERT INTO items (id, board_id, name, is_on, sort_order) VALUES (?,?,?,1,?)");
      t.items.forEach((name, i) => ins.run(newId(), boardId, name, i));
      touch(boardId);
      return viewNow(boardId);
    }),

    // ---- 메뉴 ----
    addItem: tx(({ boardId, name, sortOrder }) => {
      mustBoard(boardId);
      if (q.itemByName.get(boardId, name)) fail("DUPLICATE_NAME", MSG.dupItem);
      if (q.itemCount.get(boardId).c >= MAX_ITEMS) fail("LIMIT_REACHED", MSG.itemLimit);
      let order;
      if (sortOrder === undefined || sortOrder === null) {
        order = q.maxItemOrder.get(boardId).m + 1;
      } else {
        // 메뉴 목록 안의 자리 번호(0부터). 끝보다 크면 맨 끝.
        if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) fail("VALIDATION", MSG.badData);
        order = Math.min(sortOrder, q.itemCount.get(boardId).c);
        sqlite.prepare("UPDATE items SET sort_order = sort_order + 1 WHERE board_id = ? AND sort_order >= ?").run(boardId, order);
      }
      sqlite.prepare("INSERT INTO items (id, board_id, name, is_on, sort_order) VALUES (?,?,?,1,?)").run(newId(), boardId, name, order);
      renumberItems(boardId);
      touch(boardId);
      return viewNow(boardId);
    }),
    setItemOn: tx(({ boardId, itemId, isOn }) => {
      mustBoard(boardId);
      if (!q.itemOf.get(itemId, boardId)) fail("NOT_FOUND", MSG.noItem);
      sqlite.prepare("UPDATE items SET is_on = ? WHERE id = ?").run(isOn ? 1 : 0, itemId);
      touch(boardId);
      return viewNow(boardId);
    }),
    deleteItem: tx(({ boardId, itemId }) => {
      mustBoard(boardId);
      if (!q.itemOf.get(itemId, boardId)) fail("NOT_FOUND", MSG.noItem);
      sqlite.prepare("DELETE FROM items WHERE id = ?").run(itemId);
      renumberItems(boardId);
      touch(boardId);
      return viewNow(boardId);
    }),

    // ---- 오늘 넘김 ----
    addSkipped: tx(({ boardId, name }) => {
      mustBoard(boardId);
      const today = todayNow();
      sqlite.prepare("DELETE FROM skipped WHERE board_id = ? AND date < ?").run(boardId, today); // 지난 날 찌꺼기 정리
      const have = sqlite.prepare("SELECT COUNT(*) c, SUM(name = ?) same FROM skipped WHERE board_id = ? AND date = ?").get(name, boardId, today);
      if (!have.same && have.c >= MAX_ITEMS) fail("LIMIT_REACHED", MSG.skipLimit);
      const r = sqlite.prepare("INSERT OR IGNORE INTO skipped (board_id, date, name) VALUES (?,?,?)").run(boardId, today, name);
      if (r.changes > 0) touch(boardId);
      return boardView(boardId, today);
    }),
    clearSkipped: tx(boardId => {
      mustBoard(boardId);
      const today = todayNow();
      const r = sqlite.prepare("DELETE FROM skipped WHERE board_id = ? AND date = ?").run(boardId, today);
      if (r.changes > 0) touch(boardId);
      return boardView(boardId, today);
    }),

    // ---- 확정 ----
    // 확정(기록 쓰기) + 오늘이면 그 메뉴판의 오늘 넘김 비우기 + rev 증가 = 한 트랜잭션.
    confirm: tx(({ boardId, date, name, memberId, overwrite, confirmedAt }) => {
      mustBoard(boardId);
      const today = todayNow();
      const old = q.historyOne.get(boardId, date);
      if (old && !overwrite) {
        return { ok: false, existing: { name: old.name, nickname: old.nickname, confirmedAt: old.confirmed_at, date } };
      }
      if (old) {
        sqlite.prepare("UPDATE history SET name = ?, member_id = ?, confirmed_at = ? WHERE board_id = ? AND date = ?")
          .run(name, memberId, confirmedAt, boardId, date);
      } else {
        sqlite.prepare("INSERT INTO history (board_id, date, name, member_id, confirmed_at) VALUES (?,?,?,?,?)")
          .run(boardId, date, name, memberId, confirmedAt);
      }
      if (date === today) sqlite.prepare("DELETE FROM skipped WHERE board_id = ? AND date = ?").run(boardId, today);
      touch(boardId);
      const me = q.member.get(memberId);
      return {
        ok: true,
        replaced: old ? { name: old.name, memberId: old.member_id, nickname: old.nickname, confirmedAt: old.confirmed_at } : null,
        entry: { date, name, nickname: me.nickname, confirmedAt },
        board: boardView(boardId, today),
      };
    }),

    // 기록 전체(최신순, 닉네임 붙임). 자르기·통계는 records.js 의 sliceHistory·countByName 으로.
    historyEntries(boardId) {
      return q.historyAll.all(boardId).map(h => ({ date: h.date, name: h.name, nickname: h.nickname, confirmedAt: h.confirmed_at }));
    },
  };
  return api;
}
