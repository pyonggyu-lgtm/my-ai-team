// 후보 규칙·상태 태그 — 순수 함수만 (DOM·localStorage 없음). 원본 174–199, 378–382줄.

// 오늘이 아닌 가장 최근 기록의 name, 없으면 null
export function yesterdayName(history, today) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].date !== today) return history[i].name;
  return null;
}

// 오늘 기록의 name, 없으면 null
export function todayConfirmed(history, today) {
  const h = history.find(h => h.date === today);
  return h ? h.name : null;
}

// → { pool, block?, single?, msg, resetSkipped? }
// 원본은 모두 넘겼을 때 스스로 skipped를 비우고 저장했다. 여기서는 resetSkipped:true 로 알려 주기만 한다.
export function computePool({ items, skippedNames, yesterday, excludeYesterday = true }) {
  const base = items.filter(i => i.on).map(i => i.name);
  if (base.length < 2) return { pool: [], block: true, msg: "메뉴를 2개 이상 켜 주세요." };
  const y = excludeYesterday ? yesterday : null;
  const sk = skippedNames;
  const pool = base.filter(n => !sk.includes(n) && n !== y);
  if (pool.length >= 2) return { pool, msg: "" };
  const noSkip = base.filter(n => !sk.includes(n));
  if (noSkip.length >= 2) return { pool: noSkip, msg: "메뉴가 부족해서 어제 메뉴도 넣었어요." };
  if (noSkip.length === 1) return { pool: noSkip, single: true, msg: "남은 메뉴가 이것뿐이에요." };
  const r = computePool({ items, skippedNames: [], yesterday, excludeYesterday });
  r.msg = "모든 메뉴를 한 번씩 넘겨서 처음부터 다시 돌려요." + (r.msg ? " " + r.msg : "");
  r.resetSkipped = true;
  return r;
}

// "오늘 확정" | "오늘 넘김" | "어제 먹음" | ""
export function itemTag(item, { confirmed, skippedNames, yesterday }) {
  if (item.on && confirmed === item.name) return "오늘 확정";
  if (item.on && skippedNames.includes(item.name)) return "오늘 넘김";
  if (item.on && yesterday === item.name) return "어제 먹음";
  return "";
}
