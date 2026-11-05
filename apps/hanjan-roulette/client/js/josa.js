// 조사 붙이기 — 서버(오류·알림 문구)와 화면이 함께 쓴다. DOM 없음.

// "○○로" / "○○으로" / "○○(으)로"
// 마지막 글자가 한글이고 받침이 있으면 "으로"(ㄹ 받침은 "로"), 받침이 없으면 "로", 한글이 아니면 "(으)로".
export function withRo(word) {
  const w = String(word ?? "");
  const code = w.length ? w.charCodeAt(w.length - 1) : 0;
  if (code < 0xac00 || code > 0xd7a3) return w + "(으)로";
  const jong = (code - 0xac00) % 28; // 0 = 받침 없음, 8 = ㄹ
  return w + (jong === 0 || jong === 8 ? "로" : "으로");
}
