// 메뉴판 줄(탭) + 메뉴판 관리 창. 마크업은 index.html, 구조 설명은 docs/design/1단계_화면.md.
import { TEMPLATES } from "../templates.js";

const $ = id => document.getElementById(id);
const LONG_PRESS_MS = 500, MOVE_CANCEL_PX = 10;

// store: 저장소 약속. onSelect(id): 탭 눌러 바꾸기.
// onChanged({ boardId, deleted }): 만들기(boardId=새 판)·고치기·삭제 뒤. 호출 전에 창은 이미 닫혀 있다.
export function initBoardEditor({ store, getBoards, onSelect, onChanged }) {
  const tabs = $("boardTabs"), dlg = $("boardDialog"), form = $("boardForm");
  let mode = "create", editing = null, autoName = "", autoLead = "", sig = "", suppressClick = false, opener = null;

  // ---------- 탭 줄 ----------
  function renderTabs(boards, currentId) {
    const next = JSON.stringify([currentId, boards.map(b => [b.id, b.name])]);
    if (next === sig) return;           // 바뀐 게 없으면 다시 그리지 않는다(포커스·스크롤 유지)
    sig = next;
    tabs.textContent = "";
    for (const b of boards) {
      const t = document.createElement("button");
      t.type = "button"; t.className = "tab"; t.dataset.boardId = b.id;
      t.textContent = b.name; t.title = b.name;
      if (b.id === currentId) t.setAttribute("aria-current", "true");
      tabs.appendChild(t);
    }
    const cur = tabs.querySelector('[aria-current="true"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ inline: "center", block: "nearest" });
  }

  const tabOf = e => e.target.closest && e.target.closest(".tab");
  let timer = 0, sx = 0, sy = 0;
  const stopTimer = () => { clearTimeout(timer); timer = 0; };
  tabs.addEventListener("pointerdown", e => {
    suppressClick = false;
    const t = tabOf(e);
    if (!t || (e.button !== undefined && e.button !== 0)) return;
    sx = e.clientX; sy = e.clientY;
    stopTimer();
    timer = setTimeout(() => {
      timer = 0; suppressClick = true;
      openEdit(t.dataset.boardId, t);
    }, LONG_PRESS_MS);
  });
  tabs.addEventListener("pointermove", e => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > MOVE_CANCEL_PX) stopTimer();
  });
  tabs.addEventListener("pointerup", stopTimer);
  tabs.addEventListener("pointercancel", stopTimer);
  tabs.addEventListener("pointerleave", stopTimer);
  tabs.addEventListener("contextmenu", e => {
    const t = tabOf(e);
    if (!t) return;
    e.preventDefault(); stopTimer(); suppressClick = true;
    openEdit(t.dataset.boardId, t);
  });
  tabs.addEventListener("click", e => {
    const t = tabOf(e);
    if (!t) return;
    if (suppressClick) { suppressClick = false; return; }
    onSelect(t.dataset.boardId);
  });
  $("addBoardBtn").addEventListener("click", () => openCreate());
  // 창을 닫으면 남은 "다음 클릭 무시" 표시를 지운다(메뉴키·길게 누르기 뒤 첫 탭 선택이 무시되지 않게)
  dlg.addEventListener("close", () => { suppressClick = false; });

  // ---------- 관리 창 ----------
  const templateValue = () => (form.querySelector('input[name="template"]:checked') || {}).value || "lunch";
  const msg = text => { $("boardMsg").textContent = text || ""; };

  function applyTemplateDefaults() {
    const t = TEMPLATES[templateValue()];
    // 비어 있거나 직전에 자동으로 채운 값 그대로일 때만 채운다(사용자가 쓴 글은 덮지 않음)
    if (!$("boardName").value || $("boardName").value === autoName) $("boardName").value = autoName = t.name;
    if (!$("boardLead").value || $("boardLead").value === autoLead) $("boardLead").value = autoLead = t.resultLead;
  }
  form.querySelectorAll('input[name="template"]').forEach(r => r.addEventListener("change", applyTemplateDefaults));

  function openCreate() {
    if (dlg.open) return;
    mode = "create"; editing = null; autoName = autoLead = "";
    $("boardDialogTitle").textContent = "새 메뉴판";
    $("boardName").value = ""; $("boardLead").value = "";
    form.querySelector('input[name="template"][value="lunch"]').checked = true;
    $("templateField").hidden = false;
    $("boardExclude").checked = true;
    $("boardDeleteBtn").hidden = true;
    msg("");
    applyTemplateDefaults();
    dlg.showModal();
  }
  function openEdit(boardId, openerEl) {
    if (dlg.open) return;
    const b = getBoards().find(x => x.id === boardId);
    if (!b) return;
    mode = "edit"; editing = b; opener = openerEl || null;
    $("boardDialogTitle").textContent = "메뉴판 고치기";
    $("boardName").value = b.name; $("boardLead").value = b.resultLead;
    $("templateField").hidden = true;
    $("boardExclude").checked = b.excludeYesterday;
    $("boardDeleteBtn").hidden = false;
    msg("");
    dlg.showModal();
  }
  function closeAndFocus() {
    dlg.close();
    if (mode === "edit") {
      // 열었던 버튼(메뉴판 설정)으로, 탭이 다시 그려져 없어졌으면 현재 탭으로
      const c = opener && opener.isConnected && !opener.classList.contains("tab") ? opener
        : tabs.querySelector('[aria-current="true"]') || tabs.querySelector(".tab");
      if (c) c.focus();
    }
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("boardSaveBtn");
    btn.disabled = true;
    try {
      const fields = { name: $("boardName").value, resultLead: $("boardLead").value, excludeYesterday: $("boardExclude").checked };
      const r = mode === "create"
        ? await store.createBoard({ ...fields, template: templateValue() })
        : await store.updateBoard(editing.id, fields);
      if (!r.ok) { msg(r.message); return; }
      const id = r.board.id;
      closeAndFocus();
      onChanged({ boardId: id });
    } finally { btn.disabled = false; }
  });
  $("boardCancelBtn").addEventListener("click", closeAndFocus);
  $("boardDeleteBtn").addEventListener("click", async () => {
    if (!editing) return;
    if (!confirm("‘" + editing.name + "’ 메뉴판을 지울까요? 이 메뉴판의 기록도 함께 사라져요.")) return;
    const r = await store.deleteBoard(editing.id);
    if (!r.ok) { msg(r.message); return; }
    const id = editing.id;
    closeAndFocus();
    onChanged({ boardId: id, deleted: true });
  });

  return { renderTabs, openEdit, isOpen: () => dlg.open };
}
