// localStorage 저장소 — localStorage를 만지는 유일한 파일. 모든 함수가 Promise를 돌려준다.
// 2단계의 store-remote.js가 같은 약속(인터페이스)을 지켜 갈아 끼운다.
import { todayKST } from "./kst.js";
import { sliceHistory, countByName, validEntry } from "./records.js";
import {
  TEMPLATES, MAX_ITEMS, MAX_ITEM_NAME, MAX_BOARDS, MAX_BOARD_NAME, MAX_RESULT_LEAD,
} from "./templates.js";

const PREFIX = "hanjan.v1.";
const DEFAULT_DEVICE = { sound: false, lastBoardId: null, nickname: "" };

const fail = (code, message) => ({ ok: false, code, message });
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const str = v => typeof v === "string";

// crypto.randomUUID 는 http://(localhost 아님)에서는 없다 → 같은 crypto 의 getRandomValues 로 UUID v4 를 만든다. Math.random 은 쓰지 않는다.
function defaultNewId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// storage: 인자로 받아 Node 시험에서 가짜를 넣는다. opts: 시험용 시계·id·이벤트 대상.
// globalThis.localStorage 를 읽는 것만으로 SecurityError 가 날 수 있다(사이트 데이터 차단). 그러면 메모리 전용 저장소를 쓴다.
export function getBrowserStorage(g = globalThis) {
  try {
    const s = g.localStorage;
    if (s && typeof s.getItem === "function" && typeof s.setItem === "function") return s;
  } catch { /* 아래 메모리 저장소 */ }
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

export function createLocalStore(storage = getBrowserStorage(), opts = {}) {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? defaultNewId;
  const target = opts.target ?? globalThis;
  const today = () => todayKST(now());

  // ---- 읽기/쓰기 ----
  // 메모리(mem)가 기준이다. 저장은 시도만 하고, 막혀 있어도(사파리 개인정보 모드 등) 변경은 메모리에 남는다.
  // 읽을 때는 저장소에 값이 있으면 그것을 따른다(다른 탭의 변경 반영). 단 저장에 실패한 키는 성공할 때까지 메모리를 쓴다.
  const mem = {};
  const dirty = new Set();
  function read(key) {
    if (dirty.has(key)) return mem[key];
    let raw;
    try { raw = storage.getItem(PREFIX + key); } catch { return mem[key]; } // 저장소가 막힘 → 메모리
    if (raw == null) return mem[key];
    try { const v = JSON.parse(raw); mem[key] = v; return v; } catch { return undefined; } // 깨진 JSON → 기본값
  }
  // → 실제로 저장됐는지(persisted). 실패해도 메모리에는 반영된다.
  function write(key, value) {
    mem[key] = value;
    try { storage.setItem(PREFIX + key, JSON.stringify(value)); dirty.delete(key); return true; }
    catch { dirty.add(key); return false; }
  }
  // 변경 함수의 성공 응답. persisted:false 면 이 기기에 저장은 안 됐지만 화면에는 반영된 상태.
  const okr = (persisted, extra = {}) => ({ ok: true, ...extra, persisted });

  function cleanItems(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(i => isObj(i) && str(i.id) && str(i.name)).map(i => ({ id: i.id, name: i.name, on: i.on !== false }));
  }
  function loadBoards() {
    const raw = read("boards");
    let boards = Array.isArray(raw) ? raw
      .filter(b => isObj(b) && str(b.id) && str(b.name))
      .map((b, idx) => ({
        id: b.id,
        name: b.name,
        resultLead: str(b.resultLead) ? b.resultLead : TEMPLATES.empty.resultLead,
        template: str(b.template) && TEMPLATES[b.template] ? b.template : "empty",
        excludeYesterday: b.excludeYesterday !== false,
        sortOrder: Number.isFinite(b.sortOrder) ? b.sortOrder : idx,
        items: cleanItems(b.items),
      })) : [];
    if (boards.length === 0) {
      boards = [makeBoard("lunch", {}, 0)];
      write("boards", boards);
    }
    return boards.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const saveBoards = boards => write("boards", boards);

  function loadHistory() {
    const raw = read("history");
    const out = {};
    if (!isObj(raw)) return out;
    for (const [bid, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      out[bid] = list.filter(validEntry)
        .map(e => ({ date: e.date, name: e.name, nickname: str(e.nickname) ? e.nickname : "", confirmedAt: str(e.confirmedAt) ? e.confirmedAt : "" }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
    return out;
  }
  function loadSkipped() {
    const raw = read("skipped");
    const out = {};
    if (!isObj(raw)) return out;
    for (const [bid, v] of Object.entries(raw)) {
      if (isObj(v) && str(v.date) && Array.isArray(v.names)) out[bid] = { date: v.date, names: v.names.filter(str) };
    }
    return out;
  }
  function loadDevice() {
    const raw = read("device");
    const d = { ...DEFAULT_DEVICE };
    if (isObj(raw)) {
      if (typeof raw.sound === "boolean") d.sound = raw.sound;
      if (raw.lastBoardId === null || str(raw.lastBoardId)) d.lastBoardId = raw.lastBoardId ?? null;
      if (str(raw.nickname)) d.nickname = raw.nickname;
    }
    return d;
  }

  function makeBoard(templateId, { name, resultLead, excludeYesterday } = {}, sortOrder) {
    const t = TEMPLATES[templateId] ?? TEMPLATES.empty;
    return {
      id: newId(),
      name: name ?? t.name,
      resultLead: resultLead ?? t.resultLead,
      template: t.id,
      excludeYesterday: excludeYesterday !== false,
      sortOrder,
      items: t.items.map(n => ({ id: newId(), name: n, on: true })),
    };
  }

  function checkBoardFields({ name, resultLead }) {
    if (name !== undefined) {
      if (!name) return fail("EMPTY_NAME", "메뉴판 이름을 입력해 주세요.");
      if (name.length > MAX_BOARD_NAME) return fail("NAME_TOO_LONG", `메뉴판 이름은 ${MAX_BOARD_NAME}자까지 쓸 수 있어요.`);
    }
    if (resultLead !== undefined) {
      if (!resultLead) return fail("EMPTY_LEAD", "결과 문구를 입력해 주세요.");
      if (resultLead.length > MAX_RESULT_LEAD) return fail("LEAD_TOO_LONG", `결과 문구는 ${MAX_RESULT_LEAD}자까지 쓸 수 있어요.`);
    }
    return null;
  }
  const trimOrUndef = v => (v === undefined || v === null ? undefined : String(v).trim());
  const NOT_FOUND = () => fail("NOT_FOUND", "찾을 수 없어요.");

  const api = {
    async getState() {
      const t = today();
      const boards = loadBoards();
      const sk = loadSkipped();
      const skipped = {};
      for (const b of boards) skipped[b.id] = sk[b.id] && sk[b.id].date === t ? sk[b.id].names : [];
      const h = loadHistory();
      const history = {};
      for (const b of boards) history[b.id] = h[b.id] ?? [];
      return { today: t, boards, skipped, history };
    },

    async getDevice() { return loadDevice(); },
    async setDevice(patch) {
      const d = { ...loadDevice(), ...(isObj(patch) ? patch : {}) };
      const clean = {
        sound: typeof d.sound === "boolean" ? d.sound : DEFAULT_DEVICE.sound,
        lastBoardId: d.lastBoardId === null || str(d.lastBoardId) ? d.lastBoardId : null,
        nickname: str(d.nickname) ? d.nickname : "",
      };
      write("device", clean);
      return clean;
    },

    // ---- 메뉴판 ----
    async createBoard({ name, resultLead, template = "empty", excludeYesterday = true } = {}) {
      const boards = loadBoards();
      if (boards.length >= MAX_BOARDS) return fail("BOARD_LIMIT", `메뉴판은 ${MAX_BOARDS}개까지 만들 수 있어요.`);
      const t = TEMPLATES[template] ?? TEMPLATES.empty;
      const n = trimOrUndef(name) || t.name;
      const lead = trimOrUndef(resultLead) || t.resultLead;
      const bad = checkBoardFields({ name: n, resultLead: lead });
      if (bad) return bad;
      const board = makeBoard(t.id, { name: n, resultLead: lead, excludeYesterday }, Math.max(-1, ...boards.map(b => b.sortOrder)) + 1);
      boards.push(board);
      return okr(saveBoards(boards), { board });
    },
    async updateBoard(id, patch = {}) {
      const boards = loadBoards();
      const b = boards.find(x => x.id === id);
      if (!b) return NOT_FOUND();
      const next = { name: trimOrUndef(patch.name), resultLead: trimOrUndef(patch.resultLead) };
      const bad = checkBoardFields(next);
      if (bad) return bad;
      if (next.name !== undefined) b.name = next.name;
      if (next.resultLead !== undefined) b.resultLead = next.resultLead;
      if (typeof patch.excludeYesterday === "boolean") b.excludeYesterday = patch.excludeYesterday;
      return okr(saveBoards(boards), { board: b });
    },
    async deleteBoard(id) {
      const boards = loadBoards();
      if (!boards.some(b => b.id === id)) return NOT_FOUND();
      if (boards.length <= 1) return fail("LAST_BOARD", "메뉴판은 1개 이상 있어야 해요.");
      const rest = boards.filter(b => b.id !== id);
      const h = loadHistory(); delete h[id];
      const sk = loadSkipped(); delete sk[id];
      const dev = loadDevice();
      const ps = [saveBoards(rest), write("history", h), write("skipped", sk)];
      if (dev.lastBoardId === id) ps.push(write("device", { ...dev, lastBoardId: null }));
      return okr(ps.every(Boolean));
    },
    async reorderBoards(ids) {
      const boards = loadBoards();
      if (!Array.isArray(ids)) return fail("VALIDATION", "순서가 올바르지 않아요.");
      const rank = new Map(ids.map((id, i) => [id, i]));
      // 목록에 없는 메뉴판은 기존 순서대로 뒤에 붙인다
      boards.forEach((b, i) => { b._o = rank.has(b.id) ? rank.get(b.id) : ids.length + i; });
      boards.sort((a, b) => a._o - b._o);
      boards.forEach((b, i) => { b.sortOrder = i; delete b._o; });
      return okr(saveBoards(boards));
    },

    // ---- 메뉴 ----
    async addItem(boardId, name, index) {
      const boards = loadBoards();
      const b = boards.find(x => x.id === boardId);
      if (!b) return NOT_FOUND();
      const n = String(name ?? "").trim();
      if (!n) return fail("EMPTY", "");
      if (n.length > MAX_ITEM_NAME) return fail("NAME_TOO_LONG", `메뉴 이름은 ${MAX_ITEM_NAME}자까지 쓸 수 있어요.`);
      if (b.items.length >= MAX_ITEMS) return fail("ITEM_LIMIT", `${MAX_ITEMS}개까지 넣을 수 있어요.`);
      if (b.items.some(i => i.name === n)) return fail("DUPLICATE", "이미 있는 메뉴예요.");
      const item = { id: newId(), name: n, on: true };
      const at = Number.isInteger(index) ? Math.max(0, Math.min(index, b.items.length)) : b.items.length;
      b.items.splice(at, 0, item);
      return okr(saveBoards(boards), { item });
    },
    async setItemOn(boardId, itemId, on) {
      const boards = loadBoards();
      const item = boards.find(x => x.id === boardId)?.items.find(i => i.id === itemId);
      if (!item) return NOT_FOUND();
      item.on = !!on;
      return okr(saveBoards(boards));
    },
    async removeItem(boardId, itemId) {
      const boards = loadBoards();
      const b = boards.find(x => x.id === boardId);
      const idx = b ? b.items.findIndex(i => i.id === itemId) : -1;
      if (idx < 0) return NOT_FOUND();
      const [item] = b.items.splice(idx, 1);
      return okr(saveBoards(boards), { item, index: idx });
    },
    async resetBoard(boardId) {
      const boards = loadBoards();
      const b = boards.find(x => x.id === boardId);
      if (!b) return NOT_FOUND();
      b.items = TEMPLATES[b.template].items.map(n => ({ id: newId(), name: n, on: true }));
      return okr(saveBoards(boards), { board: b });
    },

    // ---- 넘김·확정 ----
    async addSkip(boardId, name) {
      if (!loadBoards().some(b => b.id === boardId)) return NOT_FOUND();
      const t = today();
      const sk = loadSkipped();
      const cur = sk[boardId] && sk[boardId].date === t ? sk[boardId] : { date: t, names: [] };
      if (!cur.names.includes(name)) cur.names.push(name);
      sk[boardId] = cur;
      return okr(write("skipped", sk));
    },
    async clearSkip(boardId) {
      if (!loadBoards().some(b => b.id === boardId)) return NOT_FOUND();
      const sk = loadSkipped();
      sk[boardId] = { date: today(), names: [] };
      return okr(write("skipped", sk));
    },
    // 1단계는 충돌이 없으므로 overwrite와 상관없이 항상 ok (같은 날짜면 덮어씀)
    async confirm(boardId, name, _opts = {}) {
      if (!loadBoards().some(b => b.id === boardId)) return NOT_FOUND();
      const t = today();
      const h = loadHistory();
      const list = (h[boardId] ?? []).filter(e => e.date !== t);
      list.push({ date: t, name, nickname: loadDevice().nickname, confirmedAt: now().toISOString() });
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      h[boardId] = list;
      const sk = loadSkipped();
      sk[boardId] = { date: t, names: [] };
      const p1 = write("history", h), p2 = write("skipped", sk);
      return okr(p1 && p2);
    },

    // ---- 기록·통계 ----
    async listHistory(boardId, { before, days = 30 } = {}) {
      return sliceHistory(loadHistory()[boardId] ?? [], today(), { before, days });
    },
    async stats(boardId, range) {
      return countByName(loadHistory()[boardId] ?? [], today(), range);
    },

    // 다른 탭의 storage 이벤트. 해제 함수를 돌려준다.
    subscribe(listener) {
      if (typeof target?.addEventListener !== "function") return () => {};
      const h = e => {
        if (e.storageArea && e.storageArea !== storage) return;
        if (e.key === null) dirty.clear();                                  // 저장소 전체 비움
        else if (typeof e.key === "string" && e.key.startsWith(PREFIX)) dirty.delete(e.key.slice(PREFIX.length)); // 그 키만: 다른 탭이 저장했다면 그쪽이 최신
        else return;
        listener(e);
      };
      target.addEventListener("storage", h);
      return () => target.removeEventListener("storage", h);
    },
  };
  return api;
}
