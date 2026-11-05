// 한국 시간(KST) 날짜 계산 — 기기 시간대와 상관없음. 서버도 같이 씀.

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});

// → "YYYY-MM-DD"
export function todayKST(now = new Date()) {
  return fmt.format(now);
}

// 문자열 날짜에 n일을 더한다. UTC 기준으로 계산해 시간대 영향이 없다.
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
