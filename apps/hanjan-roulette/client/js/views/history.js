// 기록 창: 메뉴판 고르기, 기간별 메뉴 횟수 막대, 날짜별 기록 + 더 보기(30일씩). 마크업은 index.html.
// 목록 자르기·집계는 store(listHistory·stats → records.js)가 한다.
import { loadNextPage } from "../records.js";

const $ = id => document.getElementById(id);
const DAYS = 30;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// "2026-11-05" → "11월 5일 (목)", 올해가 아니면 "2025년 11월 5일 (수)". 요일은 UTC로 계산(시간대 영향 없음).
export function formatDate(dateStr, today) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = WEEK[new Date(dateStr + "T00:00:00Z").getUTCDay()];
  return (String(y) === String(today).slice(0, 4) ? "" : y + "년 ") + m + "월 " + d + "일 (" + wd + ")";
}

// getBoards(): 지금 메뉴판들, getCurrentId(): 보고 있는 메뉴판, getToday(): 오늘 날짜
export function initHistory({ store, getBoards, getCurrentId, getToday, isBusy = () => false }) {
  const dlg = $("historyDialog");
  let boardId = null, range = 30, shown = [], hasMore = false, token = 0;

  function renderChips() {
    const box = $("historyBoards");
    box.textContent = "";
    for (const b of getBoards()) {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip"; c.dataset.boardId = b.id; c.textContent = b.name;
      c.setAttribute("aria-pressed", b.id === boardId ? "true" : "false");
      box.appendChild(c);
    }
  }
  function renderRange() {
    for (const b of $("rangeBtns").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.range) === String(range) ? "true" : "false");
  }
  function renderStats(rows) {
    const ul = $("statsList");
    ul.textContent = "";
    $("statsEmpty").hidden = rows.length > 0;
    ul.hidden = rows.length === 0;
    const top = rows.length ? rows[0].count : 1;
    for (const r of rows) {
      const li = document.createElement("li"); li.className = "bar-row";
      const nm = document.createElement("span"); nm.className = "bar-name"; nm.textContent = r.name;
      const ct = document.createElement("span"); ct.className = "bar-count"; ct.textContent = r.count + "번";
      const tr = document.createElement("span"); tr.className = "bar-track";
      const fl = document.createElement("span"); fl.className = "bar-fill"; fl.style.setProperty("--pct", (r.count / top * 100) + "%");
      tr.appendChild(fl);
      li.append(nm, ct, tr);
      ul.appendChild(li);
    }
  }
  function renderList() {
    const ul = $("historyList"), today = getToday();
    ul.textContent = "";
    for (const e of shown) {
      const li = document.createElement("li"); li.className = "h-row";
      const tm = document.createElement("time"); tm.className = "h-date"; tm.dateTime = e.date; tm.textContent = formatDate(e.date, today);
      const mn = document.createElement("span"); mn.className = "h-menu"; mn.textContent = e.name;
      const who = document.createElement("span"); who.className = "h-who"; who.textContent = e.nickname || "나";
      li.append(tm, mn, who);
      ul.appendChild(li);
    }
    ul.hidden = shown.length === 0;
    $("historyEmpty").hidden = shown.length > 0;
    // style.css 의 `#historyMore { display:block }` 가 hidden 속성을 이기므로 display 도 직접 끈다
    $("historyMore").hidden = !hasMore;
    $("historyMore").style.display = hasMore ? "" : "none";
  }

  // 지금까지 본 30일 묶음 수(비어서 건너뛴 묶음 포함)
  let pages = 1;
  const fetchPage = a => store.listHistory(boardId, a);

  // n 개 묶음을 처음부터 받아 다시 그린다. 그 구간이 비었는데 더 오래된 기록이 있으면 비어 있지 않은 묶음까지 건너뛴다.
  async function loadAll(n = 1) {
    const my = ++token;
    const [h, s] = await Promise.all([store.listHistory(boardId, { days: DAYS * n }), store.stats(boardId, range)]);
    if (my !== token) return;                 // 그사이 다른 요청이 시작됨
    let list = h.entries, more = h.hasMore, p = n;
    if (list.length === 0 && more) {
      const nx = await loadNextPage(fetchPage, getToday(), p, DAYS);
      if (my !== token) return;
      list = nx.entries; more = nx.hasMore; p = nx.pages;
    }
    shown = list; hasMore = more; pages = p;
    renderStats(s); renderList();
  }
  async function more() {
    const my = ++token;
    const nx = await loadNextPage(fetchPage, getToday(), pages, DAYS);
    if (my !== token) return;
    shown = shown.concat(nx.entries); hasMore = nx.hasMore; pages = nx.pages;
    renderList();
  }
  async function pick(id) {
    boardId = id; range = 30;
    renderChips(); renderRange();
    await loadAll(1);
  }

  $("historyBoards").addEventListener("click", e => {
    const c = e.target.closest && e.target.closest(".chip");
    if (c && c.dataset.boardId !== boardId) pick(c.dataset.boardId);
  });
  $("rangeBtns").addEventListener("click", async e => {
    const b = e.target.closest && e.target.closest("button");
    if (!b) return;
    range = b.dataset.range === "all" ? "all" : Number(b.dataset.range);
    renderRange();
    const my = ++token;                       // 기간 버튼은 막대만 바꾼다
    const s = await store.stats(boardId, range);
    if (my === token) renderStats(s);
  });
  $("historyMore").addEventListener("click", more);
  $("historyCloseBtn").addEventListener("click", () => dlg.close());
  $("historyBtn").addEventListener("click", async () => {
    if (dlg.open || isBusy()) return;           // 회전 중에는 열지 않는다
    const boards = getBoards();
    boardId = boards.some(b => b.id === getCurrentId()) ? getCurrentId() : boards[0].id;
    range = 30; shown = []; hasMore = false; pages = 1;
    renderChips(); renderRange();
    await loadAll(1);
    if (isBusy()) return;                       // 불러오는 사이 회전이 시작됐으면 열지 않는다
    dlg.showModal();
  });

  return {
    isOpen: () => dlg.open,
    // 다른 탭에서 바뀌었을 때: 열려 있으면 목록만 다시 그린다(보던 만큼, 기간 유지)
    async refreshIfOpen() {
      if (!dlg.open) return;
      const boards = getBoards();
      if (!boards.some(b => b.id === boardId)) { await pick(boards[0].id); return; }
      renderChips();
      await loadAll(Math.max(1, pages));
    },
  };
}
