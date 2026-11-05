// 라우트 공통: 오류 모양, 입력 검사 도우미. 오류 응답은 언제나 { error: { code, message } }.
import { DATE_RE } from "../client/js/records.js";

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const DB_STATUS = { VALIDATION: 400, NOT_FOUND: 404, DUPLICATE_NAME: 409, LIMIT_REACHED: 422 };
export const statusOfDbCode = code => DB_STATUS[code];

export const bad = message => new ApiError(400, "VALIDATION", message);
const BAD_BODY = "보낸 내용이 올바르지 않아요.";

// 요청 본문은 JSON 객체여야 한다(본문이 없으면 빈 객체).
export function bodyObject(req) {
  const b = req.body ?? {};
  if (b === null || typeof b !== "object" || Array.isArray(b)) throw bad(BAD_BODY);
  return b;
}

// 문자열: 타입 검사 → trim → 길이(1..max). 알 수 없는 필드는 읽지 않으므로 무시된다.
export function str(obj, key, label, max, { optional = false } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw bad(`${label}을(를) 입력해 주세요.`);
  }
  if (typeof v !== "string") throw bad(BAD_BODY);
  const t = v.trim();
  if (t.length < 1 || t.length > max) throw bad(`${label}은(는) 1~${max}자로 써 주세요.`);
  return t;
}

export function bool(obj, key, { optional = false, fallback } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (optional) return fallback;
    throw bad(BAD_BODY);
  }
  if (typeof v !== "boolean") throw bad(BAD_BODY);
  return v;
}

// 실제로 있는 날짜인지("2026-02-30" 거름)
export function validDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// 쿼리 문자열 값(한 번만, 문자열이어야 함)
export function queryValue(req, key) {
  const v = req.query[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw bad(BAD_BODY);
  return v;
}
