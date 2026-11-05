// 서버 호출 — fetch 감싸기. 결과는 던지지 않고 값으로 돌려준다.
//   성공 { ok:true, status, data }   실패 { ok:false, status, code, message, error }
//   네트워크 오류·시간 초과는 { ok:false, network:true, code:"NETWORK", message }
// 재시도: 네트워크 오류인 GET 만 1·2·4초 간격으로 3번. 쓰기는 자동으로 다시 보내지 않는다.

export const NETWORK_MESSAGE = "인터넷 연결을 확인해 주세요.";
const DEFAULT_ERROR_MESSAGE = "잠시 후 다시 시도해 주세요.";

export function createApi({
  fetchFn = globalThis.fetch?.bind(globalThis),
  baseUrl = "",
  getToken = () => null,
  onUnauthorized = () => {},   // 401(토큰이 없거나 틀림·나간 멤버) 또는 403(남의 그룹)
  onResult = () => {},         // 모든 호출 결과를 알려 준다(연결 상태 판단용)
  timers = { setTimeout: globalThis.setTimeout?.bind(globalThis), clearTimeout: globalThis.clearTimeout?.bind(globalThis) },
  sleep = ms => new Promise(r => timers.setTimeout(r, ms)),
  timeoutMs = 8000,
  retryDelays = [1000, 2000, 4000],
} = {}) {
  async function once(method, path, { body, auth, query }) {
    let url = baseUrl + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += "?" + s;
    }
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = auth ? getToken() : null;
    if (token) headers.Authorization = "Bearer " + token;

    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = timers.setTimeout(() => ctl?.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(url, {
        method, headers, cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl?.signal,
      });
    } catch {
      return { ok: false, network: true, status: 0, code: "NETWORK", message: NETWORK_MESSAGE };
    } finally {
      timers.clearTimeout(timer);
    }
    let data = null;
    if (res.status !== 204) {
      try { data = await res.json(); } catch { data = null; }
    }
    if (res.ok) return { ok: true, status: res.status, data };
    const error = data && typeof data === "object" && data.error && typeof data.error === "object" ? data.error : {};
    return {
      ok: false, status: res.status, method, path,
      code: typeof error.code === "string" ? error.code : "HTTP_" + res.status,
      message: typeof error.message === "string" ? error.message : DEFAULT_ERROR_MESSAGE,
      error,
    };
  }

  async function request(method, path, opts = {}) {
    const o = { auth: true, ...opts };
    const attempts = method === "GET" ? retryDelays.length + 1 : 1;
    let r;
    for (let i = 0; i < attempts; i++) {
      r = await once(method, path, o);
      if (!r.network || i === attempts - 1) break;
      await sleep(retryDelays[i]);
    }
    try { onResult(r); } catch { /* 알림 실패는 무시 */ }
    if (o.auth && !r.ok && (r.status === 401 || r.status === 403)) {
      try { onUnauthorized(r); } catch { /* 무시 */ }
    }
    return r;
  }

  const enc = encodeURIComponent;
  return {
    request,
    health: () => request("GET", "/api/health", { auth: false }),
    createGroup: body => request("POST", "/api/groups", { body, auth: false }),
    invitePreview: code => request("GET", `/api/invites/${enc(code)}`, { auth: false }),
    join: (code, body) => request("POST", `/api/invites/${enc(code)}/join`, { body, auth: false }),
    state: gid => request("GET", `/api/groups/${enc(gid)}/state`),
    members: gid => request("GET", `/api/groups/${enc(gid)}/members`),
    leave: gid => request("DELETE", `/api/groups/${enc(gid)}/members/me`),
    createBoard: (gid, body) => request("POST", `/api/groups/${enc(gid)}/boards`, { body }),
    reorderBoards: (gid, boardIds) => request("PUT", `/api/groups/${enc(gid)}/boards/order`, { body: { boardIds } }),
    updateBoard: (bid, body) => request("PATCH", `/api/boards/${enc(bid)}`, { body }),
    deleteBoard: bid => request("DELETE", `/api/boards/${enc(bid)}`),
    addItem: (bid, body) => request("POST", `/api/boards/${enc(bid)}/items`, { body }),
    setItemOn: (bid, iid, isOn) => request("PATCH", `/api/boards/${enc(bid)}/items/${enc(iid)}`, { body: { isOn } }),
    deleteItem: (bid, iid) => request("DELETE", `/api/boards/${enc(bid)}/items/${enc(iid)}`),
    resetBoard: bid => request("POST", `/api/boards/${enc(bid)}/reset`),
    addSkipped: (bid, name) => request("POST", `/api/boards/${enc(bid)}/skipped`, { body: { name } }),
    clearSkipped: bid => request("DELETE", `/api/boards/${enc(bid)}/skipped`),
    confirm: (bid, body) => request("POST", `/api/boards/${enc(bid)}/history`, { body }),
    history: (bid, { before, days } = {}) => request("GET", `/api/boards/${enc(bid)}/history`, { query: { before, days } }),
    stats: (bid, range) => request("GET", `/api/boards/${enc(bid)}/stats`, { query: { range } }),
  };
}
