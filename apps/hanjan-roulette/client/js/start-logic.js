// 시작 화면의 순수 함수들(DOM 없음): 입력 검사·초대 코드 다듬기·오류 문구·가져갈 데이터 만들기.
import { addDays } from "./kst.js";
import { MAX_ITEMS, MAX_BOARDS, TEMPLATES } from "./templates.js";

export const MAX_GROUP_NAME = 20;
export const MAX_NICKNAME = 10;
export const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

// 입력 중인 초대 코드: 전각→반각, 대문자, 허용 글자 밖은 지움, 6글자까지
export function cleanCodeInput(raw) {
  const s = String(raw ?? "").normalize("NFKC").toUpperCase();
  let out = "";
  for (const ch of s) if (CODE_LETTERS.includes(ch)) out += ch;
  return out.slice(0, CODE_LENGTH);
}
export const isFullCode = code => code.length === CODE_LENGTH && [...code].every(c => CODE_LETTERS.includes(c));

// 보내기 전에 검사 → 문제가 있으면 { field, message }, 없으면 null.
// (서버 검사와 같은 한도. 서버에서 400 이 나도 "그룹 만들기" 횟수 제한에 세어지므로 먼저 막는다)
export function validateCreate({ name, nickname }) {
  const n = String(name ?? "").trim(), k = String(nickname ?? "").trim();
  if (!n) return { field: "name", message: "그룹 이름을 써 주세요." };
  if (n.length > MAX_GROUP_NAME) return { field: "name", message: `그룹 이름은 ${MAX_GROUP_NAME}자까지 쓸 수 있어요.` };
  if (!k) return { field: "nickname", message: "내 이름을 써 주세요." };
  if (k.length > MAX_NICKNAME) return { field: "nickname", message: `내 이름은 ${MAX_NICKNAME}자까지 쓸 수 있어요.` };
  return null;
}
export function validateJoin({ code, nickname }) {
  if (!isFullCode(cleanCodeInput(code))) return { field: "code", message: "초대 코드 6글자를 넣어 주세요." };
  const k = String(nickname ?? "").trim();
  if (!k) return { field: "nickname", message: "내 이름을 써 주세요." };
  if (k.length > MAX_NICKNAME) return { field: "nickname", message: `내 이름은 ${MAX_NICKNAME}자까지 쓸 수 있어요.` };
  return null;
}

// store-remote 가 돌려준 실패({code,message,retryAfterSec?}) → 화면 문구
export function startErrorMessage(r, kind) {
  if (r.code === "RATE_LIMITED") {
    const min = Number.isFinite(r.retryAfterSec) ? Math.max(1, Math.ceil(r.retryAfterSec / 60)) : null;
    return min ? `너무 여러 번 시도했어요. ${min}분 뒤에 다시 해 주세요.` : "너무 여러 번 시도했어요. 잠시 뒤에 다시 해 주세요.";
  }
  if (r.code === "OFFLINE" || r.code === "NETWORK") return "연결이 안 돼요. 잠시 뒤에 다시 해 주세요.";
  if (r.code === "NOT_FOUND" && kind === "join") return "초대 코드를 찾을 수 없어요. 다시 확인해 주세요.";
  return r.message || "잠시 뒤에 다시 해 주세요.";
}

// 이 폰(혼자 쓰기)에 그룹으로 가져갈 만한 것이 있는가: 기록이 있거나, 메뉴판이 2개 이상이거나, 처음 점심 메뉴판에서 바뀐 곳이 있을 때
export function hasMovable(state) {
  const boards = state?.boards ?? [];
  if (boards.length === 0) return false;
  const hist = boards.reduce((n, b) => n + (state.history?.[b.id]?.length ?? 0), 0);
  if (hist > 0 || boards.length > 1) return true;
  const b = boards[0], t = TEMPLATES.lunch;
  return !(b.template === "lunch" && b.name === t.name && b.resultLead === t.resultLead && b.excludeYesterday === true
    && b.items.length === t.items.length && b.items.every((it, i) => it.name === t.items[i] && it.on));
}

// 서버 importBoards 모양: 메뉴는 on 그대로, 기록은 {date,name,confirmedAt}. 오늘 이후 날짜·같은 날 중복은 뺀다(서버가 거부하므로).
export function buildImport(state, today) {
  const boards = (state?.boards ?? []).slice(0, MAX_BOARDS).map(b => {
    const seen = new Set();
    const history = [];
    for (const e of [...(state.history?.[b.id] ?? [])].sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0))) { // 최신 날짜 우선
      if (e.date > today || seen.has(e.date)) continue;
      seen.add(e.date);
      history.push({ date: e.date, name: e.name, ...(e.confirmedAt ? { confirmedAt: e.confirmedAt } : {}) });
    }
    return {
      name: b.name, resultLead: b.resultLead, template: b.template, excludeYesterday: b.excludeYesterday !== false,
      items: b.items.slice(0, MAX_ITEMS).map(i => ({ name: i.name, on: i.on !== false })),
      history,
    };
  });
  return boards;
}
export function importSummary(boards) {
  const days = boards.reduce((n, b) => n + b.history.length, 0);
  return `메뉴판 ${boards.length}개, 기록 ${days}일치를 그룹으로 옮겨요`;
}

// 초대 링크
export const inviteLink = (origin, code) => `${origin}/?join=${code}`;

// 주소의 ?join=CODE → 다듬은 코드(없거나 6글자가 아니어도 채울 만큼은 돌려줌), 없으면 null
export function joinParam(search) {
  try {
    const v = new URLSearchParams(search).get("join");
    return v == null ? null : cleanCodeInput(v);
  } catch { return null; }
}
export const yesterdayOf = today => addDays(today, -1);
