// 오프라인 대기열 — 확정·넘김 추가·넘김 비우기 3가지만 쌓는다. 들어간 순서대로 하나씩 보낸다.
// 저장은 시도만 하고(막혀 있어도 메모리에는 남음), localStorage 는 직접 만지지 않고 받은 storage 로만 쓴다.
import { DATE_RE } from "./records.js";

export const OUTBOX_KEY = "hanjan.v1.outbox";
export const OUTBOX_TYPES = ["confirm", "skipAdd", "skipClear"];
const MAX_QUEUE = 200;

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const str = v => typeof v === "string" && v.length > 0;

function cleanItem(raw) {
  if (!isObj(raw) || !OUTBOX_TYPES.includes(raw.type) || !str(raw.boardId) || !str(raw.id)) return null;
  const date = typeof raw.date === "string" && DATE_RE.test(raw.date) ? raw.date : null;
  if (raw.type === "skipClear") return { id: raw.id, type: "skipClear", boardId: raw.boardId, date };
  if (!str(raw.name)) return null;
  if (raw.type === "skipAdd") return { id: raw.id, type: "skipAdd", boardId: raw.boardId, name: raw.name, date };
  if (!date) return null; // 확정은 누른 날짜가 꼭 있어야 한다
  return { id: raw.id, type: "confirm", boardId: raw.boardId, name: raw.name, date, overwrite: raw.overwrite === true };
}

export function createOutbox({ storage, key = OUTBOX_KEY, newId = () => globalThis.crypto.randomUUID() } = {}) {
  let items = [];
  try {
    const raw = storage?.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) items = arr.map(cleanItem).filter(Boolean);
  } catch { items = []; }

  const persist = () => { try { storage?.setItem(key, JSON.stringify(items)); } catch { /* 메모리에는 남는다 */ } };

  let flushing = null;

  const box = {
    list: () => items.map(i => ({ ...i })),
    size: () => items.length,
    head: () => (items[0] ? { ...items[0] } : null),

    // 넣은 항목을 돌려준다. 너무 쌓이면 가장 오래된 "넘김" 항목부터 버린다(확정은 지키려고).
    push(item) {
      const clean = cleanItem({ id: newId(), ...item });
      if (!clean) throw new Error("대기열에 넣을 수 없는 항목");
      items.push(clean);
      while (items.length > MAX_QUEUE) {
        const i = items.findIndex(x => x.type !== "confirm");
        items.splice(i >= 0 ? i : 0, 1);
      }
      persist();
      return { ...clean };
    },
    removeHead() { const h = items.shift(); persist(); return h ?? null; },
    isFlushing: () => flushing !== null,
    // 충돌 확인창에서 "바꾸기"를 고르면 맨 앞 항목을 덮어쓰기로 바꾼다
    overwriteHead() { if (items[0]?.type === "confirm") { items[0].overwrite = true; persist(); } },
    // 로그아웃·그룹 나가기
    clear() { items = []; persist(); },

    // send(item) → { status } :
    //   "done" 보냄 완료 / "dropped" 버림(reason) / "conflict" 멈춤(existing) / "network" 멈춤 / "fatal" 멈춤
    // → { sent, dropped:[{item,reason,silent}], stopped: null|"conflict"|"network"|"fatal", conflict? }
    // 동시에 두 번 돌지 않는다(이미 돌고 있으면 그 결과를 기다린다).
    flush(send) {
      if (flushing) return flushing;
      const run = async () => {
        const out = { sent: 0, dropped: [], stopped: null };
        {
          while (items.length > 0) {
            const item = { ...items[0] };
            const r = await send(item);
            // 보내는 동안 대기열이 바뀌었을 수 있다(로그아웃으로 비움 등) → 보낸 항목이 아직 맨 앞일 때만 지운다
            const removeSent = () => { if (items[0]?.id === item.id) { items.shift(); persist(); } };
            if (r.status === "done") { removeSent(); out.sent++; continue; }
            if (r.status === "dropped") {
              removeSent();
              out.dropped.push({ item, reason: r.reason, silent: !!r.silent });
              continue;
            }
            out.stopped = r.status === "conflict" ? "conflict" : r.status === "network" ? "network" : "fatal";
            if (r.status === "conflict") out.conflict = { item, existing: r.existing };
            break;
          }
        }
        return out;
      };
      flushing = run().finally(() => { flushing = null; }); // 할 일이 없어 바로 끝나도 표시가 남지 않게 비동기로 해제
      return flushing;
    },
  };
  return box;
}
