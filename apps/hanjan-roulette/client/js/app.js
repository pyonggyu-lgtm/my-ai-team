// 상태·화면·이벤트 연결. 저장은 store-local.js 를 통해서만 한다(원본 135–441줄 동작 유지).
import { drawWheel, planSpin, animateSpin } from "./wheel.js";
import { yesterdayName, todayConfirmed, computePool, itemTag } from "./pool.js";
import { setSound, tick, chime, startConfetti, stopConfetti } from "./effects.js";
import { createLocalStore } from "./store-local.js";
import { TEMPLATES, MAX_ITEMS } from "./templates.js";
import { initBoardEditor } from "./views/board-editor.js";
import { initHistory } from "./views/history.js";

const $ = id => document.getElementById(id);
const store = createLocalStore();

// ---------- state ----------
let S = { today: "", boards: [], skipped: {}, history: {} };   // store.getState() 사본
let curId = null;                                              // 지금 보는 메뉴판
let sound = false;

const cv = $("wheel"), g = cv.getContext("2d");
let wheelNames = [];
let theta = 0, spinning = false, starting = false, staleWhileSpin = false;
let pendingName = null, pendingSingle = false, pendingBoardId = null;

const board = () => S.boards.find(b => b.id === curId) || S.boards[0];
const histOf = b => S.history[b.id] || [];
const skipOf = b => S.skipped[b.id] || [];
// 어제 메뉴: "어제 먹음 제외"를 끈 메뉴판은 null (computePool·itemTag 모두)
const yesterdayOf = b => (b.excludeYesterday ? yesterdayName(histOf(b), S.today) : null);

async function refresh() {
  S = await store.getState();
  if (!S.boards.some(b => b.id === curId)) curId = S.boards[0].id;
}
async function resync() { await refresh(); render(); historyView.refreshIfOpen(); }

// pool.js 는 순수 함수라, 넘김 비우기(원본 195줄)는 여기서 한다. (store 호출은 기다리지 않아도 순서대로 실행된다)
function compute() {
  const b = board();
  const r = computePool({ items: b.items, skippedNames: skipOf(b), yesterday: yesterdayOf(b), excludeYesterday: b.excludeYesterday });
  if (r.resetSkipped) { S.skipped[b.id] = []; store.clearSkip(b.id); }
  return r;
}

// ---------- spin ----------
async function spin() {
  if (spinning || starting || $("overlay").classList.contains("show") || document.querySelector("dialog[open]")) return;
  starting = true;
  let plan = null;
  try {
    await refresh();                 // 한국 자정이 지났을 수 있으니 오늘 날짜부터 다시 받는다
    const comp = compute();
    render();
    if (comp.block) return;
    if (comp.single) { showResult(comp.pool[0], true); return; }
    wheelNames = comp.pool.slice();  // freeze wheel for this spin
    plan = planSpin(theta, wheelNames.length);   // winner is decided before the animation
    spinning = true; setBusy(true); $("spin").disabled = true;
  } finally {
    starting = false;
    // 준비 중 들어온 변경: 메뉴 부족·1개 남음으로 회전 없이 끝났으면 지금 반영(회전이 시작됐으면 끝난 뒤)
    if (!spinning && staleWhileSpin) { staleWhileSpin = false; resync(); }
  }
  const { k, delta } = plan;
  const finalTheta = await animateSpin({ ctx: g, names: wheelNames, from: theta, delta, onTick: tick });
  theta = finalTheta;
  spinning = false; setBusy(false);
  showResult(wheelNames[k], false);
  if (staleWhileSpin) { staleWhileSpin = false; resync(); }   // 회전 중 다른 탭에서 바뀐 것은 끝난 뒤에
}
function setBusy(on) {
  document.body.classList.toggle("busy", on);
  $("boardBar").inert = on;
}

// ---------- result overlay ----------
function showResult(name, single) {
  pendingName = name; pendingSingle = single; pendingBoardId = board().id;
  $("resultLead").textContent = board().resultLead;
  $("resultName").textContent = name;
  $("againBtn").style.display = single ? "none" : "";
  $("overlay").classList.add("show");
  chime(); startConfetti($("confetti"));
}
async function hideOverlay() {
  $("overlay").classList.remove("show"); stopConfetti();
  await refresh(); render();
}

$("okBtn").onclick = async () => {
  const r = await store.confirm(pendingBoardId, pendingName, { overwrite: false });
  await hideOverlay();
  if (!r.ok) showToast(r.code === "NOT_FOUND" ? "이 메뉴판이 지워져서 확정하지 못했어요." : r.message);
};
$("againBtn").onclick = async () => {
  const r = await store.addSkip(pendingBoardId, pendingName);
  await hideOverlay();
  if (!r.ok) { showToast(r.code === "NOT_FOUND" ? "이 메뉴판이 지워져서 넘기지 못했어요." : r.message); return; }
  setTimeout(spin, 350);
};
$("closeBtn").onclick = () => { hideOverlay(); };

// ---------- menu list ----------
function render() {
  const b = board();
  const comp = compute();
  if (!spinning) { wheelNames = comp.pool.slice(); drawWheel(g, wheelNames, theta, 0); }
  editor.renderTabs(S.boards, b.id);
  $("notice").textContent = comp.msg;
  $("spin").disabled = spinning || !!comp.block;
  const tc = todayConfirmed(histOf(b), S.today);
  $("today").textContent = tc ? "오늘 " + b.name + " 확정: " + tc : "";
  $("count").textContent = b.items.length + " / " + MAX_ITEMS;
  $("snd").textContent = sound ? "소리 켜짐" : "소리 꺼짐";
  $("snd").classList.toggle("on", sound);
  $("snd").setAttribute("aria-pressed", sound);

  const y = yesterdayOf(b), list = $("list");
  list.textContent = "";
  for (const it of b.items) {
    const li = document.createElement("li");
    const tag = itemTag(it, { confirmed: tc, skippedNames: skipOf(b), yesterday: y });
    li.className = (it.on ? "" : "off") + (tag && tag !== "오늘 확정" ? " excl" : "");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = it.on;
    cb.onchange = async () => { await store.setItemOn(b.id, it.id, cb.checked); await refresh(); render(); };
    const nm = document.createElement("span"); nm.className = "name"; nm.textContent = it.name; nm.title = it.name;
    const tg = document.createElement("span"); tg.className = "tag"; tg.textContent = tag;
    const x = document.createElement("button"); x.className = "x"; x.type = "button"; x.textContent = "×"; x.title = "지우기";
    x.onclick = () => removeItem(b.id, it.id);
    li.append(cb, nm, tg, x);
    list.appendChild(li);
  }
}

let toastTimer = 0;
function showToast(text) {
  const t = $("toast");
  t.textContent = text; t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 5000);
}
async function removeItem(boardId, itemId) {
  const r = await store.removeItem(boardId, itemId);
  if (!r.ok) return;
  await refresh(); render();
  const t = $("toast");
  t.textContent = "「" + r.item.name + "」를 지웠어요";
  const bt = document.createElement("button"); bt.textContent = "되돌리기";
  bt.onclick = async () => {
    t.style.display = "none"; clearTimeout(toastTimer);
    const back = await store.addItem(boardId, r.item.name, r.index);   // 원래 자리로
    if (!back.ok) $("addMsg").textContent = back.message;
    await refresh(); render();
  };
  t.appendChild(bt);
  t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 5000);
}

$("addForm").onsubmit = async e => {
  e.preventDefault();
  const msg = $("addMsg");
  const r = await store.addItem(board().id, $("addInput").value);
  if (!r.ok) { if (r.code !== "EMPTY") msg.textContent = r.message; return; }
  $("addInput").value = ""; msg.textContent = "";
  await refresh(); render();
};
$("addInput").oninput = () => { $("addMsg").textContent = ""; };

$("resetBtn").onclick = async () => {
  const b = board(), n = TEMPLATES[b.template].items.length;
  const q = n ? "메뉴를 처음 " + n + "개로 되돌릴까요? 지금 목록은 사라져요." : "메뉴를 모두 비울까요? 지금 목록은 사라져요.";
  if (!confirm(q)) return;
  await store.resetBoard(b.id);
  await refresh(); render();
};
$("snd").onclick = () => {
  sound = !sound; setSound(sound);
  store.setDevice({ sound });
  render(); if (sound) tick();
};

// ---------- 메뉴판 바꾸기·관리 ----------
async function selectBoard(id) {
  if (spinning || id === curId) return;
  curId = id;
  store.setDevice({ lastBoardId: id });     // 새로고침하면 이 메뉴판이 열린다
  render();
}
const editor = initBoardEditor({
  store,
  getBoards: () => S.boards,
  onSelect: selectBoard,
  onChanged: async ({ boardId, deleted }) => {
    await refresh();
    if (!deleted) { curId = boardId; store.setDevice({ lastBoardId: boardId }); }
    else if (curId === boardId) curId = S.boards[0].id;
    render();
  },
});
const historyView = initHistory({
  store,
  getBoards: () => S.boards,
  getCurrentId: () => curId,
  getToday: () => S.today,
  isBusy: () => spinning || starting,
});
$("boardSettingsBtn").onclick = () => {
  if (spinning || starting) return;
  editor.openEdit(board().id, $("boardSettingsBtn"));
};
// 다른 탭에서 바뀌면 다시 그린다(회전 중이면 끝난 뒤)
store.subscribe(() => { if (spinning || starting) staleWhileSpin = true; else resync(); });

// ---------- spin trigger ----------
$("spin").onclick = e => { e.target.blur(); spin(); };
// 1단계에서 새로 넣은 컨트롤(탭 줄의 탭·+·기록, 메뉴판 설정)에서는 Space 가 버튼 누르기다. 원본 컨트롤은 그대로 Space=돌리기.
const ownsSpace = t => !!(t && t.closest && t.closest("#boardBar, #boardSettingsBtn"));
addEventListener("keydown", e => {
  if (e.code !== "Space" || e.target.tagName === "INPUT" || ownsSpace(e.target) || document.querySelector("dialog[open]")) return;
  e.preventDefault(); spin();
});
addEventListener("keyup", e => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && !ownsSpace(e.target) && !document.querySelector("dialog[open]")) e.preventDefault();
});

// ---------- 시작 ----------
(async () => {
  const dev = await store.getDevice();
  sound = dev.sound === true; setSound(sound);
  curId = dev.lastBoardId;
  await refresh();                                   // 없어진 메뉴판이면 첫 메뉴판
  render();
})();
// canvas text needs the embedded font; redraw once it is ready
if (document.fonts && document.fonts.load) {
  document.fonts.load("700 40px Pretendard").then(() => { if (!spinning) drawWheel(g, wheelNames, theta, 0); });
}
