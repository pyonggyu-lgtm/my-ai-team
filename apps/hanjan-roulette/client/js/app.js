// 상태·화면·이벤트 연결. 저장은 store-local.js 를 통해서만 한다(원본 135–441줄 동작 유지).
import { drawWheel, planSpin, animateSpin } from "./wheel.js";
import { yesterdayName, todayConfirmed, computePool, itemTag } from "./pool.js";
import { setSound, tick, chime, startConfetti, stopConfetti } from "./effects.js";
import { createLocalStore, getBrowserStorage } from "./store-local.js";
import { createRemoteStore } from "./store-remote.js";
import { TEMPLATES, MAX_ITEMS } from "./templates.js";
import { withRo } from "./josa.js";
import { joinParam, isOtherGroupLink, ALREADY_IN_GROUP } from "./start-logic.js";
import { initBoardEditor } from "./views/board-editor.js";
import { initHistory } from "./views/history.js";
import { initStart } from "./views/start.js";
import { initGroup } from "./views/group.js";

const $ = id => document.getElementById(id);

// 저장소는 두 가지: 혼자 쓰기(local, 이 폰에만) / 그룹(remote, 서버 기준). 둘 다 같은 storage 를 쓰고(기기 정보 키 공유),
// 화면 쪽은 아래 `store` 를 통해 지금 고른 쪽을 부른다. 1단계 약속(함수 이름·반환 모양)이 같아서 나머지 코드는 그대로다.
const storage = getBrowserStorage();
const local = createLocalStore(storage);
const remote = createRemoteStore({ storage });
let kind = null;            // "solo" | "group" | null(시작 화면)
let impl = local;
const STORE_METHODS = ["getState", "getDevice", "setDevice", "createBoard", "updateBoard", "deleteBoard", "reorderBoards", "addItem",
  "setItemOn", "removeItem", "resetBoard", "addSkip", "clearSkip", "confirm", "listHistory", "stats"];
const store = Object.fromEntries(STORE_METHODS.map(m => [m, (...a) => impl[m](...a)]));
let groupName = "";

// ---------- state ----------
let S = { today: "", boards: [], skipped: {}, history: {} };   // store.getState() 사본
let curId = null;                                              // 지금 보는 메뉴판
let sound = false;

const cv = $("wheel"), g = cv.getContext("2d");
let wheelNames = [];
let theta = 0, spinning = false, starting = false, staleWhileSpin = false;
let pendingName = null, pendingSingle = false, pendingBoardId = null;

const board = () => S.boards.find(b => b.id === curId) || S.boards[0];   // 그룹 모드에서 첫 연결 전이면 undefined
const histOf = b => S.history[b.id] || [];
const skipOf = b => S.skipped[b.id] || [];
// 어제 메뉴: "어제 먹음 제외"를 끈 메뉴판은 null (computePool·itemTag 모두)
const yesterdayOf = b => (b.excludeYesterday ? yesterdayName(histOf(b), S.today) : null);

async function refresh() {
  S = await store.getState();
  if (S.boards.length && !S.boards.some(b => b.id === curId)) curId = S.boards[0].id;
  if (kind === "group") groupName = (await remote.getGroup())?.name ?? groupName;
}
async function resync() { await refresh(); render(); historyView.refreshIfOpen(); groupView.refreshIfOpen(); }

// pool.js 는 순수 함수라, 넘김 비우기(원본 195줄)는 여기서 한다. (store 호출은 기다리지 않아도 순서대로 실행된다)
function compute() {
  const b = board();
  const r = computePool({ items: b.items, skippedNames: skipOf(b), yesterday: yesterdayOf(b), excludeYesterday: b.excludeYesterday });
  if (r.resetSkipped) { S.skipped[b.id] = []; store.clearSkip(b.id); }
  return r;
}

// ---------- spin ----------
async function spin() {
  if (!board() || startView.isOpen() || spinning || starting || $("overlay").classList.contains("show") || document.querySelector("dialog[open]")) return;
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
  if (staleWhileSpin) { staleWhileSpin = false; resync(); }   // 회전 중 다른 탭·다른 사람이 바꾼 것은 끝난 뒤에
  flushLater();
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
  flushLater();
}

$("okBtn").onclick = async () => {
  const boardId = pendingBoardId, name = pendingName;
  const r = await store.confirm(boardId, name, { overwrite: false });
  await hideOverlay();
  if (r.ok) { if (r.queued) showToast("연결이 끊겨 있어요. 연결되면 확정을 보낼게요."); return; }
  if (r.code === "ALREADY_CONFIRMED") {   // 그사이 다른 사람이 오늘 확정했다
    showOverwrite({
      existing: r.existing, pending: { name, date: S.today },
      onYes: async () => {
        const r2 = await store.confirm(boardId, name, { overwrite: true });
        await refresh(); render();
        if (!r2.ok) showToast(r2.message);
      },
    });
    return;
  }
  showToast(r.code === "NOT_FOUND" ? "이 메뉴판이 지워져서 확정하지 못했어요." : r.message);
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
  $("groupBtn").querySelector(".gb-label").textContent = kind === "group" ? "그룹 설정" : "친구와 함께 쓰기";
  $("groupBtnName").textContent = kind === "group" ? groupName : "";
  if (!b) {   // 그룹 모드인데 아직 한 번도 못 받았을 때(연결 전)
    wheelNames = []; if (!spinning) drawWheel(g, wheelNames, theta, 0);
    editor.renderTabs([], null);
    $("notice").textContent = "연결되면 메뉴판이 보여요.";
    $("spin").disabled = true; $("today").textContent = ""; $("count").textContent = ""; $("list").textContent = "";
    return;
  }
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
    cb.onchange = async () => {
      const r = await store.setItemOn(b.id, it.id, cb.checked);
      if (!r.ok) $("addMsg").textContent = r.message;       // 연결이 없으면 "연결되면 바꿀 수 있어요."
      await refresh(); render();
    };
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
  if (!r.ok) { $("addMsg").textContent = r.message; return; }
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
  if (!board()) return;
  const r = await store.addItem(board().id, $("addInput").value);
  if (!r.ok) { if (r.code !== "EMPTY") msg.textContent = r.message; return; }
  $("addInput").value = ""; msg.textContent = "";
  await refresh(); render();
};
$("addInput").oninput = () => { $("addMsg").textContent = ""; };

$("resetBtn").onclick = async () => {
  const b = board(); if (!b) return;
  const n = TEMPLATES[b.template].items.length;
  const q = n ? "메뉴를 처음 " + n + "개로 되돌릴까요? 지금 목록은 사라져요." : "메뉴를 모두 비울까요? 지금 목록은 사라져요.";
  if (!confirm(q)) return;
  const r = await store.resetBoard(b.id);
  if (!r.ok) $("addMsg").textContent = r.message;
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
  if (spinning || starting || !board()) return;
  editor.openEdit(board().id, $("boardSettingsBtn"));
};

// ---------- spin trigger ----------
$("spin").onclick = e => { e.target.blur(); spin(); };
// 1단계에서 새로 넣은 컨트롤(탭 줄의 탭·+·기록, 메뉴판 설정)에서는 Space 가 버튼 누르기다. 원본 컨트롤은 그대로 Space=돌리기.
const ownsSpace = t => !!(t && t.closest && t.closest("#boardBar, #boardSettingsBtn, #groupBtn, #peerToast, #startScreen"));
addEventListener("keydown", e => {
  if (e.code !== "Space" || startView.isOpen() || e.target.tagName === "INPUT" || ownsSpace(e.target) || document.querySelector("dialog[open]")) return;
  e.preventDefault(); spin();
});
addEventListener("keyup", e => {
  if (e.code === "Space" && !startView.isOpen() && e.target.tagName !== "INPUT" && !ownsSpace(e.target) && !document.querySelector("dialog[open]")) e.preventDefault();
});

// ---------- 2단계: 알림·확인창은 회전 중이거나 다른 창이 떠 있으면 미뤘다가 끝난 뒤에 (2-8) ----------
const later_ = [];
const noticeBlocked = () => spinning || starting || $("overlay").classList.contains("show") || !!document.querySelector("dialog[open]") || startView.isOpen();
function later(fn) { if (noticeBlocked()) later_.push(fn); else fn(); }
function flushLater() { while (later_.length && !noticeBlocked()) later_.shift()(); }
document.addEventListener("close", () => setTimeout(flushLater, 0), true);   // dialog 의 close 는 퍼지지 않아 capture 로 듣는다

// 남이 확정했다는 짧은 알림(8초)
let peerTimer = 0;
function showPeer(text) {
  $("peerToastText").textContent = text; $("peerToast").hidden = false;
  clearTimeout(peerTimer);
  peerTimer = setTimeout(() => { $("peerToast").hidden = true; }, 8000);
}
$("peerToastClose").onclick = () => { clearTimeout(peerTimer); $("peerToast").hidden = true; };

// 덮어쓰기 확인창: "{닉네임}님이 {메뉴}로 확정했어요. 바꿀까요?" — Esc·"그대로 두기"가 안전한 쪽
function showOverwrite({ existing, pending, onYes, onNo }) {
  const dlg = $("overwriteDialog");
  const menu = String(existing?.name ?? "");
  $("overwriteWho").textContent = existing?.nickname || "누군가";
  $("overwriteMenu").textContent = menu;
  $("overwriteRo").textContent = withRo(menu).slice(menu.length);      // 로 / 으로 / (으)로
  $("overwriteMine").textContent = pending?.name ?? "";
  $("overwriteSub").hidden = !pending?.name;
  $("overwriteDay").hidden = !(pending?.date && pending.date !== S.today);  // 오프라인에서 어제 누른 확정이면 '어제'라고 알린다
  let decided = false;
  $("overwriteYesBtn").onclick = () => { decided = true; dlg.close(); onYes?.(); };
  $("overwriteNoBtn").onclick = () => dlg.close();
  dlg.onclose = () => { if (!decided) onNo?.(); };
  dlg.showModal();
}

// 연결 끊김 띠: 한 번 연결된 뒤 끊겼거나, 처음 연결이 3초 넘게 안 될 때만
let everConnected = false, connTimer = 0;
function showBar(on) { $("connBar").hidden = !on; document.body.classList.toggle("is-offline", on); }
function watchConnection() {
  everConnected = false; clearTimeout(connTimer); showBar(false);
  connTimer = setTimeout(() => { if (kind === "group" && !remote.isOnline()) showBar(true); }, 3000);
}
remote.onConnection(online => {
  if (kind !== "group") return;
  if (online) { everConnected = true; clearTimeout(connTimer); showBar(false); } else if (everConnected) showBar(true);
});

// 저장소 알림(subscribe)
const markStale = () => { if (spinning || starting) staleWhileSpin = true; else resync(); };
function onStoreEvent(e) {
  switch (e?.type) {
    case "conflict":      // 오프라인에서 누른 확정이 보내 보니 남이 먼저 확정해 둔 경우
      later(() => showOverwrite({
        existing: e.existing, pending: e.pending,
        onYes: () => remote.resolveConflict(true), onNo: () => remote.resolveConflict(false),
      }));
      break;
    case "dropped":
      later(() => showToast(e.reason === "VALIDATION" ? "연결이 오래 끊겨 확정을 보내지 못했어요."
        : e.reason === "NOT_FOUND" ? "메뉴판이 지워져서 보내지 못한 것이 있어요." : "보내지 못한 것이 있어요."));
      break;
    case "confirmedByOther": {
      const who = e.entry?.nickname || e.by?.nickname || "누군가";
      later(() => showPeer(`${who}님이 ${withRo(String(e.entry?.name ?? ""))} 확정했어요`));
      break;
    }
    case "boardDeleted":
      if (!e.byMe) later(() => showToast("다른 사람이 메뉴판을 지웠어요."));
      markStale();
      break;
    case "signedOut": signedOut(e.reason); break;
    case "synced": checkInviteLink(); break;   // 첫 서버 확인 — 화면은 다시 그리지 않는다
    default: markStale();   // changed · 혼자 쓰기의 다른 탭 storage 이벤트
  }
}

// ---------- 시작 화면·모드 ----------
const cleanUrl = () => { try { history.replaceState(null, "", location.pathname); } catch { /* 무시 */ } };
let unsub = () => {};
let booted = false;

async function boot() {
  const dev = await store.getDevice();
  sound = dev.sound === true; setSound(sound);
  curId = dev.lastBoardId;
  await refresh();                                   // 없어진 메뉴판이면 첫 메뉴판
  render();
  booted = true;
}
async function enterSolo() {
  remote.stop(); unsub();
  kind = "solo"; impl = local; showBar(false); clearTimeout(connTimer);
  unsub = local.subscribe(onStoreEvent);
  await boot();
}
async function enterGroup() {
  unsub();
  kind = "group"; impl = remote;
  unsub = remote.subscribe(onStoreEvent);
  watchConnection();
  await remote.start();
  await boot();
}
async function showStart(opts = {}) {
  const canGoBack = opts.canGoBack ?? ((await local.getMode()) === "solo");
  await startView.show({ ...opts, canGoBack });
}
// 그룹에서 나갔거나 로그인 정보가 사라졌을 때
let joinFromLink = null;   // 링크의 초대 코드 — 서버가 로그인을 확인해 줄 때까지(signedOut 이나 synced) 보관
// 첫 서버 확인(GET /state 성공 · 소켓 connect 뒤의 refresh)이 끝났다: 로그인이 유효하니 다른 그룹 링크면 알려 준다.
async function checkInviteLink() {
  const code = joinFromLink; joinFromLink = null;
  if (!code || kind !== "group") return;
  const group = await remote.getGroup();
  if (group && isOtherGroupLink(code, group)) later(() => { if (kind === "group") showToast(ALREADY_IN_GROUP); });
}
async function signedOut(reason) {
  unsub(); remote.stop();
  kind = null; showBar(false); clearTimeout(connTimer);
  groupView.closeAll();
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  $("peerToast").hidden = true;
  if ($("overlay").classList.contains("show")) { $("overlay").classList.remove("show"); stopConfetti(); }
  await local.setMode(null);
  S = { today: "", boards: [], skipped: {}, history: {} }; curId = null;
  render();
  later_.length = 0;                                 // 이 그룹에서 미뤄 둔 알림은 버린다
  // 초대 링크로 열었는데 첫 서버 확인 전에 로그아웃됐으면(무효 토큰) 그 코드로 참여 탭
  const code = reason === "LEFT" || reason === "MANUAL" ? null : joinFromLink; joinFromLink = null;
  await showStart({ mode: code ? "join" : "create", code: code ?? "", canGoBack: false,
    notice: reason === "LEFT" || reason === "MANUAL" ? "" : "그룹에서 나갔거나 연결 정보가 사라졌어요. 다시 참여해 주세요." });
}

const startView = initStart({
  local, remote,
  onSolo: async () => { await local.setMode("solo"); startView.hide(); cleanUrl(); await enterSolo(); },
  onEntered: async () => { await local.setMode(null); startView.hide(); cleanUrl(); await enterGroup(); },
  onBack: async () => { startView.hide(); cleanUrl(); if (kind !== "solo" || !booted) await enterSolo(); },
});
const groupView = initGroup({ getStore: () => remote });
$("groupBtn").onclick = () => {
  if (spinning || starting) return;
  if (kind === "group") groupView.open(); else showStart({ mode: "create", canGoBack: true });
};

(async () => {
  const sess = await local.getSession();
  const joinCode = joinParam(location.search);
  if (sess.signedIn) {   // 이미 그룹에 들어 있으면 초대 주소로는 옮겨 가지 않는다(다른 그룹이면 알려 준다)
    if (joinCode !== null) cleanUrl();
    joinFromLink = joinCode || null;
    await enterGroup();   // 캐시가 있으면 서버 확인을 기다리지 않고 돌아온다 → 코드는 synced/signedOut 이 올 때까지 둔다
    return;
  }
  if (joinCode !== null) { await showStart({ mode: "join", code: joinCode }); return; }
  if ((await local.getMode()) === "solo") { await enterSolo(); return; }
  await showStart({ mode: "create", canGoBack: false });
})();
// canvas text needs the embedded font; redraw once it is ready
if (document.fonts && document.fonts.load) {
  document.fonts.load("700 40px Pretendard").then(() => { if (!spinning) drawWheel(g, wheelNames, theta, 0); });
}
