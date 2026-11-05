// 기록·통계 순수 함수. 브라우저와 2단계 서버가 함께 쓴다.
import { addDays } from "./kst.js";

// 기록의 date 는 "YYYY-MM-DD" 모양이고 name 은 문자열이어야 한다. 아니면 이 파일의 함수들은 그 기록을 무시한다.
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validEntry = e => e !== null && typeof e === "object" && typeof e.date === "string" && DATE_RE.test(e.date) && typeof e.name === "string";

// entries: [{date,name,...}] (순서 상관없음). 최신순으로 돌려준다.
// → { entries, hasMore, oldest }  oldest = 가장 오래된 기록 날짜(없으면 null)
// before(없으면 today+1) 미만, before-days 이상. hasMore = 그보다 오래된 기록이 있는지.
export function sliceHistory(entries, today, { before, days = 30 } = {}) {
  const end = before ?? addDays(today, 1);
  const start = addDays(end, -days);
  const sorted = entries.filter(validEntry).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return {
    entries: sorted.filter(e => e.date < end && e.date >= start),
    hasMore: sorted.some(e => e.date < start),
    oldest: sorted.length ? sorted[sorted.length - 1].date : null,
  };
}

// range: 30 | 90 | "all". 30/90은 오늘 포함 최근 N일(today-(N-1) ~ today).
// → [{name,count}] 횟수 내림차순, 같으면 localeCompare("ko")
export function countByName(entries, today, range) {
  let list = entries.filter(validEntry);
  if (range !== "all") {
    const start = addDays(today, -(Number(range) - 1));
    list = list.filter(e => e.date >= start && e.date <= today);
  }
  const m = new Map();
  for (const e of list) m.set(e.name, (m.get(e.name) || 0) + 1);
  return [...m].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

// ---- 기록 창 "더 보기"(30일씩) 날짜 창 계산 ----
// pages 개의 30일 묶음을 이미 봤을 때, 다음 묶음은 [today+1-30*(pages+1), today+1-30*pages).
// 즉 listHistory({ before: pageBefore(today, pages), days: 30 }). pages=0 이면 기본(오늘 포함 최근 30일).
export function pageBefore(today, pages, days = 30) {
  return addDays(today, 1 - days * pages);
}

// 다음 묶음을 불러온다. 그 30일에 기록이 없어도 더 오래된 기록이 있으면 비어 있지 않은 묶음까지 건너뛴다.
// fetchPage({ before, days }) → { entries, hasMore }  (store.listHistory 또는 sliceHistory 래퍼)
// → { entries, pages: 본 묶음 수(건너뛴 것 포함), hasMore }
// 끝없이 돌지 않도록 두 가지로 멈춘다: ① fetchPage 가 oldest(가장 오래된 기록 날짜)를 알려 주면, 다음 묶음의 끝이
// 그 날짜 이하일 때 ② 그래도 모르면 maxPages(약 100년치) 묶음을 넘길 때. 멈추면 { entries: [], hasMore: false }.
export async function loadNextPage(fetchPage, today, pages, days = 30, maxPages = 1200) {
  let p = pages;
  while (p < maxPages) {
    const before = pageBefore(today, p, days);
    const r = await fetchPage({ before, days });
    p++;
    if (r.entries.length > 0 || !r.hasMore) return { entries: r.entries, pages: p, hasMore: r.hasMore };
    if (r.oldest != null && r.oldest >= addDays(before, -days)) return { entries: [], pages: p, hasMore: false }; // 앞뒤가 안 맞는 응답
  }
  return { entries: [], pages: p, hasMore: false };
}
