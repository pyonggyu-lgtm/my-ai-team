// 인증: 기기 토큰(DB에는 해시만), 초대 코드, 초대 코드 시도 제한, requireMember 미들웨어.
// DB 를 직접 import 하지 않는다 — 조회 함수를 주입받는다(시험에서 가짜로 바꾸기 쉽게).
import { createHash, randomBytes, randomInt } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

// ---- 토큰 ----
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = t => createHash("sha256").update(String(t)).digest("hex");

// ---- 초대 코드 ----
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31종 (0·O·1·I·L 제외)
export const INVITE_LENGTH = 6;

// exists(code) → true 면 겹친 것이므로 다시 뽑는다.
export function newInviteCode(exists = () => false, maxTries = 50) {
  for (let n = 0; n < maxTries; n++) {
    let code = "";
    for (let i = 0; i < INVITE_LENGTH; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
    if (!exists(code)) return code;
  }
  throw new Error("초대 코드를 만들지 못했어요.");
}

// 전각 글자(NFKC)를 반각으로, 대문자로, 공백·하이픈·대시류는 앞뒤·가운데 모두 뺀다
// ("abc-234", "ABC 234", "ＡＢＣ２３４", "ABC—234" → "ABC234").
export const normalizeInviteCode = input =>
  (typeof input === "string" ? input.normalize("NFKC").toUpperCase().replace(/[\s\-\u2010-\u2015\u2212]/g, "") : "");
const INVITE_RE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`);
export const isValidInviteCode = code => INVITE_RE.test(code);

// ---- 오류 응답 ----
const sendError = (res, status, code, message, extra = {}) =>
  res.status(status).json({ error: { code, message, ...extra } });

// ---- 시도 제한용 주소 묶기 ----
// IPv4 는 주소 하나, IPv6 는 앞 64비트(/64)를 하나로, ::ffff:a.b.c.d(IPv4 매핑)는 IPv4 로.
export function ipKey(ip) {
  if (typeof ip !== "string" || ip === "") return "unknown";
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return "unknown";
  let addr = ip.split("%")[0];
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(addr); // 끝이 IPv4 모양이면 16진 두 칸으로
  if (m) {
    const o = m[2].split(".").map(Number);
    addr = m[1] + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  const n = groups.map(g => parseInt(g, 16));
  if (n.slice(0, 5).every(x => x === 0) && n[5] === 0xffff) return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
  return "v6:" + n.slice(0, 4).map(x => x.toString(16)).join(":");
}

// ---- 초대 코드 시도 제한 ----
// 틀린 시도(없는 코드·닫힌 그룹)만 센다. 주소(ipKey)당 windowMs 안에 max번 틀리면 창이 끝날 때까지 막는다(맞는 코드여도).
// 주소와 상관없이 서버 전체 틀린 시도가 windowMs 안에 globalMax번이면 창이 끝날 때까지 모두 막는다.
// 꽉 차면(maxEntries) 기한 지난 항목 → 차단 안 된 오래된 항목 순으로만 지우고, 차단 중인 항목은 남긴다.
// 그래도 자리가 없으면 새 주소는 막는다(공격 중이라고 보고 닫힌 쪽으로).
// isBlocked 는 읽기만 한다(항목을 넣거나 지우지 않는다). 정리는 recordFailure 에서만 한다.
export function createRateLimiter({ max = 10, windowMs = 10 * 60 * 1000, now = () => new Date(), maxEntries = 10000, globalMax = 300 } = {}) {
  const map = new Map(); // key → { start, count }  (넣은 순서 = 오래된 순서)
  let global = { start: now().getTime(), count: 0 };
  let lastSweep = global.start;
  const expired = (e, t) => t - e.start >= windowMs;
  const retryAfter = (start, t) => Math.max(1, Math.ceil((start + windowMs - t) / 1000));
  const sweep = t => {
    for (const [k, e] of map) if (expired(e, t)) map.delete(k);
    lastSweep = t;
  };
  // 새 주소를 넣을 자리가 있는가(읽기만)
  function hasRoom(t) {
    if (map.size < maxEntries) return true;
    for (const e of map.values()) if (expired(e, t) || e.count < max) return true;
    return false;
  }
  // 새 주소를 넣을 자리를 만든다(지우기 포함). 못 만들면 false.
  function makeRoom(t) {
    if (map.size < maxEntries) return true;
    sweep(t);
    if (map.size < maxEntries) return true;
    for (const [k, e] of map) { // 차단 안 된 가장 오래된 것
      if (e.count < max) { map.delete(k); return true; }
    }
    return false;
  }
  return {
    // → { blocked:false } | { blocked:true, retryAfterSec }
    isBlocked(ip) {
      const t = now().getTime();
      if (!expired(global, t) && global.count >= globalMax) return { blocked: true, retryAfterSec: retryAfter(global.start, t) };
      const e = map.get(ipKey(ip));
      if (e && !expired(e, t)) return e.count >= max ? { blocked: true, retryAfterSec: retryAfter(e.start, t) } : { blocked: false };
      if (!hasRoom(t)) {
        let soonest = Infinity;
        for (const x of map.values()) if (x.start < soonest) soonest = x.start;
        return { blocked: true, retryAfterSec: retryAfter(soonest, t) };
      }
      return { blocked: false };
    },
    recordFailure(ip) {
      const t = now().getTime();
      if (t - lastSweep >= Math.min(windowMs, 60_000)) sweep(t);
      if (expired(global, t)) global = { start: t, count: 0 };
      global.count++;
      const key = ipKey(ip);
      let e = map.get(key);
      if (e && expired(e, t)) { map.delete(key); e = undefined; }
      if (!e) {
        if (!makeRoom(t)) return;
        e = { start: t, count: 0 };
        map.set(key, e);
      }
      e.count++;
    },
    size: () => map.size,
  };
}

const tooMany = (res, retryAfterSec) => {
  res.set("Retry-After", String(retryAfterSec));
  return sendError(res, 429, "RATE_LIMITED", "시도가 너무 많아요. 잠시 후 다시 해 주세요.", { retryAfterSec });
};

// 이미 막힌 주소면 429. 통과하면 req.recordInviteFailure() 로 틀린 시도를 기록할 수 있다.
export const rateLimitMiddleware = limiter => (req, res, next) => {
  const r = limiter.isBlocked(req.ip);
  if (r.blocked) return tooMany(res, r.retryAfterSec);
  req.recordInviteFailure = () => limiter.recordFailure(req.ip);
  next();
};

// 요청마다 센다(맞든 틀리든). max 번까지 통과, 그다음부터 429. 그룹 만들기처럼 인증 없이 데이터를 만드는 API 용.
export const countedRateLimitMiddleware = limiter => (req, res, next) => {
  const r = limiter.isBlocked(req.ip);
  if (r.blocked) return tooMany(res, r.retryAfterSec);
  limiter.recordFailure(req.ip);
  next();
};

// ---- 멤버 확인 ----
// lookups: { findMemberByTokenHash(hash), getGroup(gid), groupIdOfBoard(bid) }
// 순서: 토큰(401) → 없는 id(404) → 남의 그룹(403). 통과하면 req.member = { id, groupId, nickname }.
export function requireMember({ findMemberByTokenHash, getGroup, groupIdOfBoard }) {
  return (req, res, next) => {
    const m = /^Bearer +(\S+)$/i.exec(req.get("authorization") ?? "");
    const member = m ? findMemberByTokenHash(hashToken(m[1])) : null;
    if (!member || member.leftAt) return sendError(res, 401, "UNAUTHORIZED", "다시 참여해 주세요.");

    const { gid, bid } = req.params;
    if (gid !== undefined) {
      if (!getGroup(gid)) return sendError(res, 404, "NOT_FOUND", "그룹을 찾을 수 없어요.");
      if (gid !== member.groupId) return sendError(res, 403, "FORBIDDEN", "이 그룹의 멤버가 아니에요.");
    }
    if (bid !== undefined) {
      const owner = groupIdOfBoard(bid);
      if (!owner) return sendError(res, 404, "NOT_FOUND", "메뉴판을 찾을 수 없어요.");
      if (owner !== member.groupId) return sendError(res, 403, "FORBIDDEN", "이 그룹의 멤버가 아니에요.");
    }
    req.member = { id: member.id, groupId: member.groupId, nickname: member.nickname };
    next();
  };
}
