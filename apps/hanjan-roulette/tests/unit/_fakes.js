// 단위 시험용 가짜들 — 가짜 storage·소켓·서버(fetch). 파일 이름이 _ 로 시작해 시험으로 돌지 않는다.

export function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    _map: m,
  };
}

// socket.io-client 흉내. fire(event, payload) 로 서버 이벤트를 흉내 낸다.
export function fakeIo() {
  const sockets = [];
  const io = (url, opts) => {
    const handlers = new Map();
    const s = {
      url, opts, connected: false, calls: [],
      on(ev, fn) { (handlers.get(ev) ?? handlers.set(ev, []).get(ev)).push(fn); return s; },
      connect() { s.calls.push("connect"); },
      disconnect() { s.calls.push("disconnect"); s.connected = false; },
      close() { s.calls.push("close"); s.connected = false; },
      fire(ev, ...args) { for (const fn of handlers.get(ev) ?? []) fn(...args); },
      serverConnect() { s.connected = true; s.fire("connect"); },
      serverDrop(reason = "transport close") { s.connected = false; s.fire("disconnect", reason); },
    };
    sockets.push(s);
    return s;
  };
  io.sockets = sockets;
  io.last = () => sockets[sockets.length - 1];
  return io;
}

export function fakeTarget({ onLine = true, visibility = "visible" } = {}) {
  const handlers = new Map();
  return {
    navigator: { onLine },
    document: { visibilityState: visibility },
    addEventListener(n, fn) { (handlers.get(n) ?? handlers.set(n, []).get(n)).push(fn); },
    removeEventListener(n, fn) { handlers.set(n, (handlers.get(n) ?? []).filter(f => f !== fn)); },
    fire(n, e = {}) { for (const fn of [...(handlers.get(n) ?? [])]) fn(e); },
    count: n => (handlers.get(n) ?? []).length,
  };
}

const tick = () => new Promise(r => setImmediate(r));
export const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

// 서버 흉내: 메뉴판 하나(b1) 가 있는 그룹 g1. 필요한 만큼만 구현.
export function fakeServer({ today = "2026-11-05" } = {}) {
  const S = {
    today, down: false, calls: [], failNext: [], rev: 1,
    me: { id: "m1", nickname: "하나", isOwner: true },
    members: [{ id: "m1", nickname: "하나", isOwner: true, joinedAt: "2026-11-01T00:00:00.000Z" }],
    board: {
      id: "b1", name: "점심", resultLead: "오늘 점심은", template: "lunch", excludeYesterday: true, sortOrder: 0, rev: 1,
      items: ["국밥", "돈가스", "짜장면"].map((n, i) => ({ id: "i" + i, name: n, isOn: true, sortOrder: i })),
      skipped: [], confirmed: null, yesterday: null,
    },
    history: new Map(), // date → { date,name,nickname,confirmedAt }
    nextItem: 10,
  };
  S.view = () => JSON.parse(JSON.stringify(S.board));
  S.bump = () => { S.board.rev++; return S.view(); };
  S.setConfirmed = (name, nickname = "둘", date = S.today) => {
    S.history.set(date, { date, name, nickname, confirmedAt: "2026-11-05T01:00:00.000Z" });
    if (date === S.today) { S.board.confirmed = { name, nickname, confirmedAt: "2026-11-05T01:00:00.000Z" }; S.board.skipped = []; }
    return S.bump();
  };

  const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const err = (status, code, message, extra = {}) => json(status, { error: { code, message, ...extra } });

  S.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const u = new URL(url, "http://x");
    const body = init.body ? JSON.parse(init.body) : undefined;
    S.calls.push({ method, path: u.pathname, search: u.search, body, auth: init.headers?.Authorization });
    if (S.down) throw new TypeError("network down");
    // failNext: 조건에 맞는(응답을 돌려주거나 던지는) 첫 항목을 한 번 쓰고 뺀다. 맞지 않으면(null) 그대로 둔다.
    for (let i = 0; i < S.failNext.length; i++) {
      let r;
      try { r = await S.failNext[i]({ method, path: u.pathname, body }); } catch (e) { S.failNext.splice(i, 1); throw e; }
      if (r) { S.failNext.splice(i, 1); return r; }
    }
    const p = u.pathname;
    if (init.headers?.Authorization !== "Bearer tok1" && p !== "/api/health") return err(401, "UNAUTHORIZED", "다시 참여해 주세요.");
    if (method === "GET" && p === "/api/groups/g1/state") {
      return json(200, { today: S.today, group: { id: "g1", name: "회사", inviteCode: "ABC234" }, me: S.me, members: S.members, boards: [S.view()] });
    }
    if (method === "GET" && p === "/api/groups/g1/members") return json(200, S.members);
    if (method === "DELETE" && p === "/api/groups/g1/members/me") return json(204, null);
    if (method === "GET" && p === "/api/health") return json(200, { ok: true, today: S.today });
    if (method === "POST" && p === "/api/boards/b1/history") {
      if (body.date && body.date !== S.today && body.date < S.today && body.date !== "2026-11-04") {
        return err(400, "VALIDATION", "연결이 오래 끊겨 확정을 보내지 못했어요.");
      }
      const date = body.date ?? S.today;
      const old = S.history.get(date);
      if (old && !body.overwrite) return err(409, "ALREADY_CONFIRMED", `${old.nickname}님이 ${old.name}으로 확정했어요. 바꿀까요?`, { existing: { name: old.name, nickname: old.nickname, confirmedAt: old.confirmedAt } });
      const entry = { date, name: body.name, nickname: S.me.nickname, confirmedAt: "2026-11-05T03:00:00.000Z" };
      S.history.set(date, entry);
      if (date === S.today) { S.board.confirmed = { name: entry.name, nickname: entry.nickname, confirmedAt: entry.confirmedAt }; S.board.skipped = []; }
      return json(201, { entry, board: S.bump() });
    }
    if (method === "POST" && p === "/api/boards/b1/skipped") {
      if (!S.board.skipped.includes(body.name)) { S.board.skipped.push(body.name); return json(200, S.bump()); }
      return json(200, S.view());
    }
    if (method === "DELETE" && p === "/api/boards/b1/skipped") {
      if (S.board.skipped.length) { S.board.skipped = []; return json(200, S.bump()); }
      return json(200, S.view());
    }
    if (method === "POST" && p === "/api/boards/b1/items") {
      if (S.board.items.some(i => i.name === body.name)) return err(409, "DUPLICATE_NAME", "이미 있는 메뉴예요.");
      const at = Number.isInteger(body.sortOrder) ? Math.min(body.sortOrder, S.board.items.length) : S.board.items.length;
      S.board.items.splice(at, 0, { id: "i" + S.nextItem++, name: body.name, isOn: true, sortOrder: at });
      S.board.items.forEach((it, i) => { it.sortOrder = i; });
      return json(201, S.bump());
    }
    let m;
    if ((m = /^\/api\/boards\/b1\/items\/(\w+)$/.exec(p))) {
      const i = S.board.items.findIndex(x => x.id === m[1]);
      if (i < 0) return err(404, "NOT_FOUND", "메뉴를 찾을 수 없어요.");
      if (method === "PATCH") S.board.items[i].isOn = body.isOn;
      else S.board.items.splice(i, 1);
      return json(200, S.bump());
    }
    if (method === "PUT" && p === "/api/groups/g1/boards/order") return json(204, null);
    if (method === "GET" && p === "/api/boards/b1/history") return json(200, { entries: [...S.history.values()], hasMore: false, oldest: null });
    if (method === "GET" && p === "/api/boards/b1/stats") return json(200, [{ name: "국밥", count: 2 }]);
    return err(404, "NOT_FOUND", "찾을 수 없어요.");
  };
  return S;
}

// 손으로 돌리는 타이머: setTimeout 은 목록에 쌓기만 하고, fireNext() 로 가장 이른 것을 실행한다.
export function fakeTimers() {
  let id = 0;
  const list = [];
  return {
    setTimeout(fn, ms) { list.push({ id: ++id, fn, ms }); return id; },
    clearTimeout(i) { const k = list.findIndex(t => t.id === i); if (k >= 0) list.splice(k, 1); },
    pending: () => list.map(t => t.ms),
    async fireNext(ms) { const k = ms == null ? 0 : list.findIndex(t => t.ms === ms); if (k < 0) return false; const [t] = list.splice(k, 1); await t.fn(); return true; },
  };
}
