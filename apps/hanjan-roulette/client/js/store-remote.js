// 그룹 저장소(서버 기준) — store-local.js 와 같은 함수 이름·반환 모양. 달라지는 점:
//  · confirm(boardId, name, { overwrite, date }) → { ok:true } | { ok:false, code:"ALREADY_CONFIRMED", existing }
//  · 연결이 없으면 메뉴·메뉴판 편집은 { ok:false, code:"OFFLINE", message:"연결되면 바꿀 수 있어요." }
//  · 확정·넘김은 연결이 없어도 되고 대기열(outbox)에 쌓였다가 연결되면 순서대로 간다 → { ok:true, queued:true }
//  · 추가: getGroup, listMembers, leaveGroup, onConnection (+ 시작·참여 도우미)
// localStorage 는 store-local.js 의 getBrowserStorage() 로만 얻는다.
import { getBrowserStorage } from "./store-local.js";
import { todayKST, addDays } from "./kst.js";
import { createApi } from "./api.js";
import { createOutbox } from "./outbox.js";
import { MAX_ITEMS, MAX_ITEM_NAME, MAX_BOARDS, MAX_BOARD_NAME, MAX_RESULT_LEAD, TEMPLATES } from "./templates.js";

const PREFIX = "hanjan.v1.";
const DEVICE_KEY = PREFIX + "device";
const CACHE_KEY = PREFIX + "remote.cache";
const OFFLINE_MESSAGE = "연결되면 바꿀 수 있어요.";
const SEEN_EVENTS = 300;

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const str = v => typeof v === "string";
const fail = (code, message) => ({ ok: false, code, message });
const OFFLINE = () => fail("OFFLINE", OFFLINE_MESSAGE);
const NOT_FOUND = () => fail("NOT_FOUND", "찾을 수 없어요.");

const MIN_RETRY_MS = 30_000, MAX_RETRY_MS = 300_000; // 막혔을 때 다시 해 보는 간격: 30초부터 두 배씩, 최대 5분

export function createRemoteStore({
  storage = getBrowserStorage(),
  fetchFn,
  io,                          // socket.io-client 의 io 함수(시험에서는 가짜). 없으면 start() 때 서버가 주는 파일을 불러온다.
  loadIo: loadIoOption,        // 시험용: io 함수를 불러오는 함수(실패하면 null 을 돌려줌)
  now = () => new Date(),
  target = globalThis,         // visibilitychange·pageshow·online·offline 을 듣는 곳(addEventListener, document, navigator)
  baseUrl = "",
  timers, sleep, timeoutMs, retryDelays,
} = {}) {
  const today = () => todayKST(now());
  const T = timers ?? { setTimeout: globalThis.setTimeout?.bind(globalThis), clearTimeout: globalThis.clearTimeout?.bind(globalThis) };

  // ───────── 저장소(기기 정보·마지막 상태) ─────────
  const readJson = key => { try { const raw = storage.getItem(key); return raw == null ? undefined : JSON.parse(raw); } catch { return undefined; } };
  const writeJson = (key, v) => { try { storage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };
  // 기기 정보는 다른 필드(sound·lastBoardId·nickname 등 store-local 이 쓰는 것)를 지우지 않고 읽고 고친다.
  const readDevice = () => (isObj(readJson(DEVICE_KEY)) ? readJson(DEVICE_KEY) : {});
  const patchDevice = patch => {
    const next = { ...readDevice(), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    writeJson(DEVICE_KEY, next);
    return next;
  };

  const session = { token: null, groupId: null, memberId: null };
  const loadSession = () => {
    const d = readDevice();
    session.token = str(d.token) && d.token ? d.token : null;
    session.groupId = str(d.groupId) && d.groupId ? d.groupId : null;
    session.memberId = str(d.memberId) && d.memberId ? d.memberId : null;
  };
  loadSession();

  // 서버가 준 모양 그대로(메뉴판은 items[].isOn) 들고 있다가 getState 에서 1단계 모양으로 바꾼다.
  let cache = { day: null, group: null, me: null, members: [], boards: [], history: {}, stats: {} };
  (function loadCache() {
    const c = readJson(CACHE_KEY);
    if (isObj(c) && c.groupId === session.groupId && session.groupId && Array.isArray(c.boards)) {
      cache = {
        day: str(c.day) ? c.day : null, group: isObj(c.group) ? c.group : null, me: isObj(c.me) ? c.me : null,
        members: Array.isArray(c.members) ? c.members : [], boards: c.boards.filter(b => isObj(b) && str(b.id)),
        history: isObj(c.history) ? c.history : {}, stats: isObj(c.stats) ? c.stats : {},
      };
    }
  })();
  const saveCache = () => writeJson(CACHE_KEY, { v: 1, groupId: session.groupId, ...cache });

  const outbox = createOutbox({ storage });

  // ───────── 알림(subscribe)·연결 상태(onConnection) ─────────
  const listeners = new Set();
  const emit = event => { for (const l of [...listeners]) { try { l(event); } catch { /* 듣는 쪽 오류가 저장소를 막지 않게 */ } } };
  const connListeners = new Set();
  let socketUp = false;
  let requestOk = null; // null=아직 모름, true/false=마지막 요청 결과
  let lastOnline = false;
  const browserOffline = () => target?.navigator?.onLine === false; // false 만 믿는다(true 는 믿을 수 없음)
  // 연결 = 소켓이 붙어 있고 마지막 요청이 성공했고 브라우저가 오프라인이라고 하지 않을 때
  const online = () => !!session.token && socketUp && requestOk !== false && !browserOffline();
  // 소켓 파일을 못 불러온 동안(socketMissing)에는 실시간만 빠지고 REST 는 그대로 쓴다 → 보내기·편집은 가능, 연결 띠는 계속 보여 준다
  let socketMissing = false;
  const canWork = () => !!session.token && (socketUp || socketMissing) && requestOk !== false && !browserOffline();
  let lastCanWork = false;
  const syncConnection = () => {
    const o = online(), w = canWork();
    if (o !== lastOnline) {
      lastOnline = o;
      for (const l of [...connListeners]) { try { l(o); } catch { /* 무시 */ } }
    }
    if (w && !lastCanWork) { lastCanWork = w; flushOutbox(); } else lastCanWork = w;
  };

  // ───────── 서버 호출 ─────────
  const api = createApi({
    fetchFn: fetchFn ?? globalThis.fetch?.bind(globalThis), baseUrl, timers, sleep, timeoutMs, retryDelays,
    getToken: () => session.token,
    onResult: r => { requestOk = !r.network; syncConnection(); },
    // 401 = 토큰이 없거나 틀림·나간 멤버 → 로그아웃. 403 = 그룹이 다름 → 바로 로그아웃하지 않고 GET /state 로 다시 확인
    // (GET /state 자체가 403 이면 그때 로그아웃, 설계 4.3).
    onUnauthorized: r => {
      if (r.status === 401) signOut("UNAUTHORIZED");
      else if (r.method === "GET" && /\/state$/.test(r.path ?? "")) signOut("FORBIDDEN");
      else { skipFlushOnce = true; refresh(); } // 바로 다시 보내면 같은 403 을 되풀이할 수 있다 → 이어 보내기는 재시도 간격에 맡긴다
    },
  });

  function signOut(reason) {
    const had = !!session.token;
    session.token = session.groupId = session.memberId = null;
    patchDevice({ token: undefined, groupId: undefined, memberId: undefined });
    cache = { day: null, group: null, me: null, members: [], boards: [], history: {}, stats: {} };
    try { storage.setItem(CACHE_KEY, "null"); } catch { /* 무시 */ }
    outbox.clear();
    awaitingDecision = false; conflictItemId = null;
    clearFlushTimer(); clearIoTimer(); socketMissing = false;
    detach();
    socketUp = false;
    syncConnection();
    if (had) emit({ type: "signedOut", reason });
  }

  // ───────── 상태 반영(rev 규칙) ─────────
  const sortBoards = () => cache.boards.sort((a, b) => a.sortOrder - b.sortOrder);
  // 받은 메뉴판의 rev 가 가진 것보다 클 때만 갈아 끼운다. → 바뀌었는지
  function applyBoard(view) {
    if (!isObj(view) || !str(view.id) || !Number.isFinite(view.rev)) return false;
    const i = cache.boards.findIndex(b => b.id === view.id);
    if (i < 0) cache.boards.push(view);
    else if (view.rev > cache.boards[i].rev) cache.boards[i] = view;
    else return false;
    sortBoards();
    saveCache();
    return true;
  }
  const changed = () => emit({ type: "changed" });

  let refreshing = null;
  let skipFlushOnce = false;
  // GET /state — 동시에 하나만. 접속·재접속·돌아왔을 때·자정마다 부른다.
  // force: 이미 가는 중인 요청이 있어도 합치지 않고 그것이 끝난 뒤 새로 받는다(소켓 connect 직후 — 그 사이 놓친 것을 확실히)
  function refresh({ force = false } = {}) {
    if (!session.token || !session.groupId) return Promise.resolve({ ok: false, code: "SIGNED_OUT" });
    if (refreshing) return force ? refreshing.then(() => refresh()) : refreshing;
    refreshing = (async () => {
      const r = await api.state(session.groupId);
      if (!r.ok) {
        if (r.status === 404) signOut("NOT_FOUND");
        return r;
      }
      const d = r.data;
      const before = JSON.stringify([cache.boards, cache.members, cache.group, cache.me, cache.day]);
      const cached = new Map(cache.boards.map(b => [b.id, b]));
      // 서버 목록이 기준(없어진 메뉴판은 지움). 같은 날이면 가진 쪽 rev 가 같거나 클 때 그대로 둔다.
      // 날짜가 바뀌었으면 rev 와 상관없이 서버 값을 쓴다(자정에는 rev 가 오르지 않지만 오늘 확정·넘김·어제 메뉴가 달라진다).
      const sameDay = cache.day === d.today;
      cache.boards = d.boards.map(b => (sameDay && cached.has(b.id) && cached.get(b.id).rev >= b.rev ? cached.get(b.id) : b));
      cache.day = d.today;
      cache.group = d.group;
      cache.me = d.me;
      cache.members = d.members;
      sortBoards();
      saveCache();
      if (JSON.stringify([cache.boards, cache.members, cache.group, cache.me, cache.day]) !== before) changed();
      emit({ type: "synced" }); // 서버가 이 로그인을 확인해 줬다(처음 한 번이 필요한 쪽을 위해)
      if (skipFlushOnce) skipFlushOnce = false; else flushOutbox(); // 5xx 로 멈춰 있던 항목도 다음 refresh 때 다시 보낸다
      return r;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  // 소켓 없이 자정을 넘겼으면(오늘 ≠ 마지막으로 받은 날) 서버 상태를 다시 받는다. 같은 조합은 30초에 한 번만
  // (기기 시계가 서버와 달라 계속 어긋나도 요청이 쏟아지지 않게).
  let dayCheck = { key: "", at: 0 };
  function refreshIfNewDay() {
    if (!session.token || !cache.day || !canWork()) return;
    const t = today();
    if (t === cache.day) return;
    const key = `${t}|${cache.day}`, at = now().getTime();
    if (dayCheck.key === key && at - dayCheck.at < 30_000) return;
    dayCheck = { key, at };
    refresh().catch(() => {});
  }

  // ───────── 대기열 보내기 ─────────
  const myNickname = () => cache.me?.nickname ?? readDevice().nickname ?? "";
  // item → { status, ... }   확정은 직접 보낸 것이든 대기열이든 언제나 "누른 날"(item.date)을 함께 보낸다.
  const directIds = new Set();      // 사용자가 방금 눌러 결과를 기다리는 항목(저장되지 않음 — 앱을 껐다 켜면 일반 대기열 항목)
  const itemResults = new Map();    // 바로 보낸 항목의 결과(누른 쪽이 가져간다)
  let conflictItemId = null;
  async function sendItem(item) {
    const direct = directIds.has(item.id);
    let r;
    if (item.type === "confirm") {
      r = await api.confirm(item.boardId, { name: item.name, overwrite: !!item.overwrite, date: item.date }); // 23:59:59 에 누른 것이 서버에 닿을 때 다음 날이어도 누른 날로 기록된다
    } else {
      // 넘김은 서버가 "오늘" 기준으로 기록한다 → 누른 날이 지났으면 의미가 없으니 버린다
      if (!direct && item.date && item.date !== today()) return { status: "dropped", reason: "STALE", silent: true };
      r = item.type === "skipAdd" ? await api.addSkipped(item.boardId, item.name) : await api.clearSkipped(item.boardId);
    }
    if (r.ok) {
      applyBoard(item.type === "confirm" ? r.data.board : r.data);
      changed();
      if (direct) itemResults.set(item.id, { status: "done", data: r.data });
      return { status: "done", data: r.data };
    }
    if (r.network) return { status: "network" };
    if (r.status === 401 || r.status === 403) return { status: "fatal" }; // 항목은 남긴다(로그아웃이면 대기열째 비워짐)
    // 5xx·시간 초과·너무 잦은 요청은 서버/통신 문제 → 버리지 않고 멈춘다. 다음 연결·다음 refresh 때 다시 보낸다.
    if (r.status >= 500 || r.status === 408 || r.status === 429) return { status: "network" };
    if (r.code === "ALREADY_CONFIRMED") {
      const ex = r.error.existing ?? {};
      // 내가 이미 보낸 같은 확정(보낸 뒤 저장 전에 끊긴 경우)이면 충돌이 아니라 완료
      if (ex.name === item.name && ex.nickname === myNickname()) {
        if (direct) itemResults.set(item.id, { status: "done", data: null });
        return { status: "done", data: null };
      }
      // 바로 보낸 확정의 409 는 반환값으로만 알린다 — 대기열을 잠그지 않는다(항목은 대기열에서 빼고 다음 항목을 계속)
      if (direct) { itemResults.set(item.id, { status: "conflict", existing: ex, message: r.message }); return { status: "dropped", reason: "DIRECT", silent: true }; }
      // 대기열에서 나간 항목: 알림은 여기서 한 번만(여러 곳에서 flush 를 불러도 같은 충돌을 되풀이해 알리지 않게) — 답이 올 때까지 다시 보내지 않는다
      awaitingDecision = true;
      conflictItemId = item.id;
      emit({ type: "conflict", boardId: item.boardId, existing: ex, pending: { name: item.name, date: item.date } });
      return { status: "conflict", existing: ex, message: r.message };
    }
    // 400(오래된 날짜 등)·404(지워진 메뉴판)·422: 그 항목은 버리고 알린다(알림은 여기서 한 번만)
    if (direct) { itemResults.set(item.id, { status: "dropped", reason: r.code, message: r.message }); return { status: "dropped", reason: "DIRECT", silent: true }; }
    emit({ type: "dropped", reason: r.code, item });
    return { status: "dropped", reason: r.code, message: r.message };
  }

  // 충돌 확인창의 답을 기다리는 동안은 다시 보내지 않는다(같은 충돌을 되풀이해 알리지 않게)
  let awaitingDecision = false;
  let flushTimer = null, flushDelay = 0;
  const clearFlushTimer = () => { if (flushTimer) T.clearTimeout(flushTimer); flushTimer = null; flushDelay = 0; };
  // 연결은 유지되는데 서버 쪽 문제(5xx·시간 초과·403)로 멈추면 30초 뒤부터(최대 5분 간격) 다시 보내 본다
  function scheduleFlushRetry() {
    if (flushTimer || !session.token) return;
    flushDelay = flushDelay ? Math.min(flushDelay * 2, MAX_RETRY_MS) : MIN_RETRY_MS;
    flushTimer = T.setTimeout(() => { flushTimer = null; flushOutbox(); }, flushDelay);
  }
  async function flushOutbox() {
    if (outbox.size() === 0 || !canWork() || awaitingDecision) return null;
    const res = await outbox.flush(sendItem);
    if (res.sent || res.dropped.length) changed();
    if (res.stopped === "network" || res.stopped === "fatal") scheduleFlushRetry();
    else if (!res.stopped) clearFlushTimer();
    return res;
  }

  // ───────── 소켓·브라우저 이벤트 ─────────
  let socket = null;
  let detachers = [];
  const seen = new Set();
  const firstTime = id => {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > SEEN_EVENTS) seen.delete(seen.values().next().value);
    return true;
  };

  function onServerEvent(event, p) {
    if (!isObj(p) || !firstTime(p.eventId)) return;
    const mine = p.by?.memberId === session.memberId;
    switch (event) {
      case "board:updated":
      case "board:created":
        if (applyBoard(p.board)) changed();
        break;
      case "board:deleted":
        cache.boards = cache.boards.filter(b => b.id !== p.boardId);
        delete cache.history[p.boardId];
        saveCache();
        emit({ type: "boardDeleted", boardId: p.boardId, byMe: mine });
        changed();
        break;
      case "boards:reordered": {
        const rank = new Map((p.boardIds ?? []).map((id, i) => [id, i]));
        cache.boards.forEach((b, i) => { b.sortOrder = rank.has(b.id) ? rank.get(b.id) : (p.boardIds?.length ?? 0) + i; });
        sortBoards();
        cache.boards.forEach((b, i) => { b.sortOrder = i; });
        saveCache();
        changed();
        break;
      }
      case "history:confirmed":
        if (!mine) emit({ type: "confirmedByOther", boardId: p.boardId, entry: p.entry, replaced: p.replaced, by: p.by });
        break;
      case "member:joined":
        if (p.member && !cache.members.some(m => m.id === p.member.id)) { cache.members.push(p.member); saveCache(); changed(); }
        break;
      case "member:left":
        if (p.member?.id === session.memberId) { signOut("LEFT"); break; }
        cache.members = cache.members.filter(m => m.id !== p.member?.id);
        saveCache();
        changed();
        break;
      case "day:changed":
        refresh();
        break;
    }
  }

  const SERVER_EVENTS = ["board:updated", "board:created", "board:deleted", "boards:reordered", "history:confirmed", "member:joined", "member:left", "day:changed"];

  // 돌아왔을 때·온라인 신호: GET /state 를 다시 받고, 실패하면 소켓을 다시 붙인다
  async function wake() {
    if (!session.token) return;
    if (!socket && socketMissing) { clearIoTimer(); attach(); } // 돌아왔을 때 소켓 파일을 다시 불러 본다
    const r = await refresh();
    if (!socket) return;
    if (!r.ok && r.network) { socket.disconnect(); socket.connect(); }
    else if (!socket.connected && session.token) socket.connect();
    if (r.ok) flushOutbox();
  }

  // 소켓 파일(서버가 직접 주는 /socket.io/socket.io.esm.min.js)을 못 불러오면 REST 만으로 계속 쓰고 다시 불러 본다
  let ioTimer = null, ioDelay = 0;
  const clearIoTimer = () => { if (ioTimer) T.clearTimeout(ioTimer); ioTimer = null; ioDelay = 0; };
  function scheduleIoRetry() {
    if (ioTimer || !session.token) return;
    ioDelay = ioDelay ? Math.min(ioDelay * 2, MAX_RETRY_MS) : MIN_RETRY_MS;
    ioTimer = T.setTimeout(() => { ioTimer = null; attach(); }, ioDelay);
  }
  const loadIo = async () => io ?? (loadIoOption ? await loadIoOption() : await import(/* 서버가 직접 주는 파일(외부 CDN 안 씀) */ baseUrl + "/socket.io/socket.io.esm.min.js").then(m => m.io).catch(() => null));

  // 돌아왔을 때·온라인 신호 듣기. 소켓이 없어도(파일 불러오기 실패) 이 신호로 다시 해 본다.
  function listenBrowser() {
    if (detachers.length) return;
    const add = (name, fn) => {
      if (typeof target?.addEventListener !== "function") return;
      target.addEventListener(name, fn);
      detachers.push(() => target.removeEventListener(name, fn));
    };
    add("visibilitychange", () => { if (target.document?.visibilityState === "visible") wake(); });
    add("pageshow", e => { if (e?.persisted) wake(); });
    add("online", () => wake());
    add("offline", () => syncConnection());
  }

  async function attach() {
    if (!session.token || socket) return;
    listenBrowser();
    const ioFn = await loadIo();
    if (!session.token || socket) return;
    if (!ioFn) { socketMissing = true; syncConnection(); scheduleIoRetry(); return; }
    clearIoTimer(); socketMissing = false;
    socket = ioFn(baseUrl || undefined, { auth: cb => cb({ token: session.token, groupId: session.groupId }) }); // 재연결 때마다 다시 불러 값을 새로 보낸다
    socket.on("connect", async () => {
      socketUp = true;
      syncConnection();
      await refresh({ force: true });     // 놓친 이벤트는 따로 챙기지 않고 전체를 다시 받는다
      flushOutbox();
    });
    socket.on("disconnect", reason => {
      socketUp = false;
      syncConnection();
      // 서버가 끊은 것(나가기)은 자동 재연결이 안 된다 → connect() 를 부르지 않고 로그아웃 처리
      if (reason === "io server disconnect") signOut("SERVER_DISCONNECT");
    });
    socket.on("connect_error", err => {
      const m = err?.message;
      if (m === "UNAUTHORIZED" || m === "FORBIDDEN") { signOut(m); return; } // 다시 붙여 보지 않는다
      socketUp = false; // 그 밖의 오류는 소켓이 알아서 다시 시도한다
      syncConnection();
    });
    for (const ev of SERVER_EVENTS) socket.on(ev, p => onServerEvent(ev, p));

  }

  function detach() {
    for (const d of detachers) { try { d(); } catch { /* 무시 */ } }
    detachers = [];
    if (socket) { try { socket.disconnect(); } catch { /* 무시 */ } socket = null; }
  }

  // ───────── 보기용 상태 만들기 ─────────
  // 보내지 못한 대기열 항목을 얹어 보여 준다(서버 상태가 새로 와도 내가 누른 것이 사라지지 않게).
  function viewOf(b, day) {
    const view = { ...b, skipped: [...(b.skipped ?? [])], confirmed: b.confirmed ?? null, yesterday: b.yesterday ?? null };
    if (cache.day && day !== cache.day) { // 연결 없이 자정을 넘김
      // 캐시가 정확히 어제 것일 때만 어제 확정이 '어제 메뉴'가 된다. 더 오래됐으면 어제 메뉴는 알 수 없다(null).
      view.yesterday = cache.day === addDays(day, -1) && view.confirmed ? view.confirmed.name : null;
      view.confirmed = null;
      view.skipped = [];
    }
    for (const it of outbox.list()) {
      if (it.boardId !== b.id) continue;
      if (it.type === "skipAdd" && (!it.date || it.date === day) && !view.skipped.includes(it.name)) view.skipped.push(it.name);
      if (it.type === "skipClear" && (!it.date || it.date === day)) view.skipped = [];
      if (it.type === "confirm") {
        if (it.date === day) { // 오늘 확정: 오늘 넘김도 비워진다(서버가 한 트랜잭션으로 하는 것과 같게)
          view.confirmed = { name: it.name, nickname: myNickname(), confirmedAt: now().toISOString() };
          view.skipped = [];
        } else if (it.date === addDays(day, -1)) { // 누른 뒤 자정을 넘김: 어제 메뉴
          view.yesterday = it.name;
        }
      }
    }
    return view;
  }
  // 1단계 getState() 모양: { today, boards[{items:[{on}]}], skipped:{bid:[]}, history:{bid:[]} }
  // history 는 화면의 '오늘 확정'·'어제 메뉴' 계산에 필요한 만큼만 만든다(전체 기록은 listHistory).
  function toLocalState() {
    const day = canWork() && cache.day ? cache.day : today();
    const boards = [], skipped = {}, history = {};
    for (const b of cache.boards) {
      const v = viewOf(b, day);
      boards.push({
        id: v.id, name: v.name, resultLead: v.resultLead, template: v.template, excludeYesterday: v.excludeYesterday,
        sortOrder: v.sortOrder, rev: v.rev, items: v.items.map(i => ({ id: i.id, name: i.name, on: i.isOn })),
      });
      skipped[v.id] = v.skipped;
      const h = [];
      if (v.yesterday) h.push({ date: addDays(day, -1), name: v.yesterday, nickname: "", confirmedAt: "" }); // 날짜는 '오늘이 아님'을 뜻하는 표시
      if (v.confirmed) h.push({ date: day, name: v.confirmed.name, nickname: v.confirmed.nickname ?? "", confirmedAt: v.confirmed.confirmedAt ?? "" });
      history[v.id] = h;
    }
    return { today: day, boards, skipped, history };
  }
  const localBoard = (state, id) => state.boards.find(b => b.id === id);

  // ───────── 오류 바꾸기(서버 → 1단계 코드) ─────────
  function mapError(r) {
    let o;
    if (r.network) return OFFLINE();
    if (r.code === "DUPLICATE_NAME") o = fail("DUPLICATE", r.message);
    else if (r.code === "LIMIT_REACHED") o = fail(r.message.includes("메뉴판") ? "BOARD_LIMIT" : "ITEM_LIMIT", r.message);
    else if (r.code === "VALIDATION" && r.message.includes("1개 이상")) o = fail("LAST_BOARD", r.message);
    else if (r.code === "NOT_FOUND") o = fail("NOT_FOUND", r.message);
    else o = fail(r.code, r.message);
    // 서버가 알려 준 기다릴 시간(429)은 화면이 "n분 뒤에"로 보여 줄 수 있게 그대로 넘긴다
    const sec = r.error?.retryAfterSec;
    return Number.isFinite(sec) ? { ...o, retryAfterSec: sec } : o;
  }
  const guard = () => (canWork() ? null : OFFLINE());
  const trimOrUndef = v => (v === undefined || v === null ? undefined : String(v).trim());
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

  // 편집 요청: 보낸 뒤 응답의 메뉴판을 반영한다. 네트워크 오류면 대기열에 넣지 않고 OFFLINE.
  async function edit(call, build) {
    const r = await call();
    if (!r.ok) return mapError(r);
    const board = isObj(r.data) && str(r.data.id) ? r.data : null;
    if (board) { applyBoard(board); changed(); }
    return { ok: true, ...(build ? build(board) : {}), persisted: true };
  }
  const boardForLocal = id => localBoard(toLocalState(), id);

  // 확정·넘김: 모두 대기열에 먼저 넣고 같은 길로 순서대로 보낸다(앞 요청이 아직 가는 중이어도 뒤집히지 않게).
  // 연결돼 있으면 이 항목의 결과를 기다려 돌려주고(409 는 ALREADY_CONFIRMED), 끊겼거나 서버가 막히면 대기열에 남기고 queued 로 알린다.
  async function queued(type, boardId, extra = {}) {
    if (!cache.boards.some(b => b.id === boardId)) return NOT_FOUND();
    refreshIfNewDay();
    const entry = outbox.push({ type, boardId, date: today(), ...extra });
    const waitForResult = canWork() && !awaitingDecision;
    if (waitForResult) directIds.add(entry.id);
    changed();
    const pendingNow = () => outbox.list().some(x => x.id === entry.id);
    try {
      for (let tries = 0; waitForResult && pendingNow() && tries < 3 && canWork() && !awaitingDecision; tries++) {
        const res = await flushOutbox();
        if (!res || res.stopped) break;
      }
    } finally {
      directIds.delete(entry.id);
    }
    const r = itemResults.get(entry.id);
    itemResults.delete(entry.id);
    if (r?.status === "done") return { ok: true, persisted: true, ...(type === "confirm" && r.data ? { entry: r.data.entry } : {}) };
    if (r?.status === "conflict") return { ok: false, code: "ALREADY_CONFIRMED", message: r.message, existing: r.existing };
    if (r?.status === "dropped") return mapError({ code: r.reason, message: r.message ?? "처리하지 못했어요." });
    if (!session.token) return fail("UNAUTHORIZED", "다시 참여해 주세요."); // 로그아웃으로 대기열째 비워짐
    if (!pendingNow()) return { ok: true, persisted: true }; // 앞선 흐름이 이미 보냈다
    return { ok: true, queued: true, persisted: true };       // 다시 보내기는 연결·refresh·재시도 간격이 맡는다
  }

  const store = {
    // ───── 1단계 저장소 약속 ─────
    async getState() {
      if (session.token && cache.boards.length === 0) await refresh();
      else refreshIfNewDay();
      return toLocalState();
    },
    async getDevice() {
      const d = readDevice();
      return {
        sound: typeof d.sound === "boolean" ? d.sound : false,
        lastBoardId: d.lastBoardId === null || str(d.lastBoardId) ? (d.lastBoardId ?? null) : null,
        nickname: str(d.nickname) ? d.nickname : (cache.me?.nickname ?? ""),
      };
    },
    async setDevice(patch) {
      const p = isObj(patch) ? patch : {};
      const allowed = {};
      if (typeof p.sound === "boolean") allowed.sound = p.sound;
      if (p.lastBoardId === null || str(p.lastBoardId)) allowed.lastBoardId = p.lastBoardId;
      if (str(p.nickname)) allowed.nickname = p.nickname;
      patchDevice(allowed);
      return store.getDevice();
    },

    async createBoard({ name, resultLead, template = "empty", excludeYesterday = true } = {}) {
      const off = guard(); if (off) return off;
      if (cache.boards.length >= MAX_BOARDS) return fail("BOARD_LIMIT", `메뉴판은 ${MAX_BOARDS}개까지 만들 수 있어요.`);
      const t = TEMPLATES[template] ?? TEMPLATES.empty;
      const n = trimOrUndef(name) || t.name;
      const lead = trimOrUndef(resultLead) || t.resultLead;
      const bad = checkBoardFields({ name: n, resultLead: lead });
      if (bad) return bad;
      return edit(() => api.createBoard(session.groupId, { name: n, resultLead: lead, template: t.id, excludeYesterday }),
        b => ({ board: boardForLocal(b.id) }));
    },
    async updateBoard(id, patch = {}) {
      const off = guard(); if (off) return off;
      if (!cache.boards.some(b => b.id === id)) return NOT_FOUND();
      const next = { name: trimOrUndef(patch.name), resultLead: trimOrUndef(patch.resultLead) };
      const bad = checkBoardFields(next);
      if (bad) return bad;
      const body = {};
      if (next.name !== undefined) body.name = next.name;
      if (next.resultLead !== undefined) body.resultLead = next.resultLead;
      if (typeof patch.excludeYesterday === "boolean") body.excludeYesterday = patch.excludeYesterday;
      if (Object.keys(body).length === 0) return { ok: true, board: boardForLocal(id), persisted: true };
      return edit(() => api.updateBoard(id, body), b => ({ board: boardForLocal(b.id) }));
    },
    async deleteBoard(id) {
      const off = guard(); if (off) return off;
      if (!cache.boards.some(b => b.id === id)) return NOT_FOUND();
      if (cache.boards.length <= 1) return fail("LAST_BOARD", "메뉴판은 1개 이상 있어야 해요.");
      const r = await api.deleteBoard(id);
      if (!r.ok) return mapError(r);
      cache.boards = cache.boards.filter(b => b.id !== id);
      delete cache.history[id];
      saveCache();
      changed();
      return { ok: true, persisted: true };
    },
    async reorderBoards(ids) {
      const off = guard(); if (off) return off;
      if (!Array.isArray(ids)) return fail("VALIDATION", "순서가 올바르지 않아요.");
      // 서버는 전체 목록을 요구한다 → 모르는 id 는 빼고, 빠진 메뉴판은 기존 순서대로 뒤에 붙인다
      const known = new Set(cache.boards.map(b => b.id));
      const first = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i);
      const full = [...first, ...cache.boards.map(b => b.id).filter(id => !first.includes(id))];
      const r = await api.reorderBoards(session.groupId, full);
      if (!r.ok) return mapError(r);
      onServerEvent("boards:reordered", { boardIds: full }); // eventId 없음 → 바로 반영
      return { ok: true, persisted: true };
    },

    async addItem(boardId, name, index) {
      const off = guard(); if (off) return off;
      const b = cache.boards.find(x => x.id === boardId);
      if (!b) return NOT_FOUND();
      const n = String(name ?? "").trim();
      if (!n) return fail("EMPTY", "");
      if (n.length > MAX_ITEM_NAME) return fail("NAME_TOO_LONG", `메뉴 이름은 ${MAX_ITEM_NAME}자까지 쓸 수 있어요.`);
      if (b.items.length >= MAX_ITEMS) return fail("ITEM_LIMIT", `${MAX_ITEMS}개까지 넣을 수 있어요.`);
      if (b.items.some(i => i.name === n)) return fail("DUPLICATE", "이미 있는 메뉴예요.");
      const body = { name: n };
      if (Number.isInteger(index) && index >= 0) body.sortOrder = index;
      return edit(() => api.addItem(boardId, body), nb => {
        const it = nb.items.find(i => i.name === n);
        return { item: { id: it.id, name: it.name, on: it.isOn } };
      });
    },
    async setItemOn(boardId, itemId, on) {
      const off = guard(); if (off) return off;
      if (!cache.boards.find(x => x.id === boardId)?.items.some(i => i.id === itemId)) return NOT_FOUND();
      return edit(() => api.setItemOn(boardId, itemId, !!on));
    },
    async removeItem(boardId, itemId) {
      const off = guard(); if (off) return off;
      const b = cache.boards.find(x => x.id === boardId);
      const idx = b ? b.items.findIndex(i => i.id === itemId) : -1;
      if (idx < 0) return NOT_FOUND();
      const gone = b.items[idx];
      return edit(() => api.deleteItem(boardId, itemId), () => ({ item: { id: gone.id, name: gone.name, on: gone.isOn }, index: idx }));
    },
    async resetBoard(boardId) {
      const off = guard(); if (off) return off;
      if (!cache.boards.some(x => x.id === boardId)) return NOT_FOUND();
      return edit(() => api.resetBoard(boardId), b => ({ board: boardForLocal(b.id) }));
    },

    addSkip: (boardId, name) => queued("skipAdd", boardId, { name }),
    clearSkip: boardId => queued("skipClear", boardId),
    // opts.date: 오프라인에서 누른 날(없으면 오늘). 대기열 항목이 다시 보낼 때 쓴다.
    async confirm(boardId, name, { overwrite = false, date } = {}) {
      return queued("confirm", boardId, { name, overwrite: !!overwrite, ...(date ? { date } : {}) });
    },

    async listHistory(boardId, { before, days = 30 } = {}) {
      const empty = { entries: [], hasMore: false, oldest: null };
      const cacheable = before === undefined && days === 30;
      if (canWork()) {
        const r = await api.history(boardId, { before, days });
        if (r.ok) {
          if (cacheable) { cache.history[boardId] = r.data; saveCache(); }
          return r.data;
        }
      }
      return cacheable && cache.history[boardId] ? { ...cache.history[boardId], offline: true } : { ...empty, offline: true };
    },
    async stats(boardId, range) {
      const key = boardId + ":" + range;
      if (canWork()) {
        const r = await api.stats(boardId, range);
        if (r.ok) { cache.stats[key] = r.data; saveCache(); return r.data; }
      }
      return cache.stats[key] ?? [];
    },

    // 변경 알림. 듣는 쪽은 event.type 으로 구분한다:
    //   changed · conflict{boardId,existing,pending} · dropped{reason,item} · signedOut{reason}
    //   confirmedByOther{boardId,entry,replaced,by} · boardDeleted{boardId,byMe}
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // ───── 2단계에서 더해진 것 ─────
    async getGroup() { return cache.group ? { ...cache.group } : null; },
    async listMembers() {
      if (canWork() && session.groupId) {
        const r = await api.members(session.groupId);
        if (r.ok) { cache.members = r.data; saveCache(); }
      }
      return cache.members.map(m => ({ ...m }));
    },
    async leaveGroup() {
      if (!session.groupId) return fail("SIGNED_OUT", "참여한 그룹이 없어요.");
      const r = await api.leave(session.groupId);
      if (!r.ok) return mapError(r);
      signOut("LEFT");
      return { ok: true };
    },
    onConnection(listener) {
      connListeners.add(listener);
      return () => connListeners.delete(listener);
    },
    isOnline: () => online(),
    pendingCount: () => outbox.size(),
    // 충돌 확인창의 답: true = "바꾸기"(덮어쓰기로 다시 보냄), false = "그대로 두기"(그 항목을 버림)
    async resolveConflict(overwrite) {
      // 충돌 난 항목이 아직 맨 앞일 때만 덮어쓰기·지우기(그 사이 대기열이 바뀌었으면 엉뚱한 항목을 건드리지 않는다)
      const head = outbox.head();
      const mine = !!head && head.id === conflictItemId;
      awaitingDecision = false; conflictItemId = null;
      if (mine) { if (overwrite) outbox.overwriteHead(); else outbox.removeHead(); }
      changed();
      return flushOutbox();
    },

    // ───── 시작 화면·세션 ─────
    isSignedIn: () => !!session.token,
    getSession: () => ({ signedIn: !!session.token, groupId: session.groupId, memberId: session.memberId }),
    // 앱이 열릴 때: 토큰이 있으면 소켓을 열고 상태를 받는다
    async start() {
      if (!session.token) return { signedIn: false };
      await attach();
      refresh().then(() => flushOutbox());
      return { signedIn: true };
    },
    stop() { detach(); clearFlushTimer(); clearIoTimer(); socketMissing = false; socketUp = false; syncConnection(); },
    previewInvite: code => api.invitePreview(code).then(r => (r.ok ? { ok: true, ...r.data } : mapError(r))),
    async createGroup({ name, nickname, importBoards } = {}) {
      const body = { name, nickname };
      if (Array.isArray(importBoards) && importBoards.length) body.importBoards = importBoards;
      return enter(await api.createGroup(body));
    },
    async joinGroup(code, nickname) { return enter(await api.join(code, { nickname })); },
    signOut: () => signOut("MANUAL"),
  };

  // 만들기·참여 응답에서 토큰을 한 번만 받아 기기에 저장한다
  async function enter(r) {
    if (!r.ok) return mapError(r);
    const { token, group, member } = r.data;
    session.token = token; session.groupId = group.id; session.memberId = member.id;
    patchDevice({ token, groupId: group.id, memberId: member.id, nickname: member.nickname });
    cache = { day: null, group, me: member, members: [], boards: [], history: {}, stats: {} };
    await store.start();
    await refresh();
    return { ok: true, group, member };
  }

  return store;
}
