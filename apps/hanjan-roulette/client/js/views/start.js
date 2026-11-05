// 시작 화면: 그룹 만들기 / 초대 코드로 참여 / 혼자 쓰기. 마크업은 index.html, 구조 설명은 docs/design/2단계_화면.md.
// 서버가 준 문자열은 모두 textContent 로만 넣는다.
import {
  cleanCodeInput, isFullCode, validateCreate, validateJoin, startErrorMessage, hasMovable, buildImport, importSummary,
} from "../start-logic.js";
import { MAX_MEMBERS } from "../templates.js";

const $ = id => document.getElementById(id);

// local: 혼자 쓰기 저장소(가져갈 데이터를 읽는 용도), remote: 그룹 저장소(만들기·참여·미리 보기)
// onSolo(): "혼자 쓰기" 선택. onEntered(): 만들기·참여 성공(토큰은 remote 가 이미 기기에 저장함). onBack(): 돌아가기.
export function initStart({ local, remote, onSolo, onEntered, onBack }) {
  const screen = $("startScreen");
  const forms = { create: $("createForm"), join: $("joinForm") };
  let busy = false, importable = null, lastPreview = "", previewSeq = 0, groupFull = false;

  function setMode(m) {
    $("modeCreate").setAttribute("aria-pressed", String(m === "create"));
    $("modeJoin").setAttribute("aria-pressed", String(m === "join"));
    forms.create.hidden = m !== "create";
    forms.join.hidden = m !== "join";
  }
  $("modeCreate").onclick = () => setMode("create");
  $("modeJoin").onclick = () => setMode("join");

  const setMsg = (id, text) => { $(id).textContent = text || ""; };
  function setBusy(btnId, on, label) {
    busy = on;
    const b = $(btnId);
    b.disabled = on || (btnId === "joinBtn" && groupFull);
    $("soloBtn").disabled = on;       // 요청 중에는 다른 길로 새지 못하게
    $("startBackBtn").disabled = on;
    if (on) { b.dataset.label = b.textContent; b.textContent = "잠시만요…"; } else if (b.dataset.label) { b.textContent = b.dataset.label; }
    void label;
  }

  // ---------- 가져가기(이 폰의 혼자 쓰기 데이터) ----------
  async function loadImportable() {
    importable = null;
    try {
      const st = await local.getState();
      if (hasMovable(st)) importable = buildImport(st, st.today);
    } catch { importable = null; }
    const row = $("importRow");
    row.hidden = !importable;
    if (importable) $("importSummary").textContent = importSummary(importable);
  }

  // ---------- 그룹 만들기 ----------
  forms.create.onsubmit = async e => {
    e.preventDefault();
    if (busy) return;
    const name = $("createGroupName").value, nickname = $("createNick").value;
    const bad = validateCreate({ name, nickname });
    if (bad) { setMsg("createMsg", bad.message); $(bad.field === "name" ? "createGroupName" : "createNick").focus(); return; }
    setMsg("createMsg", "");
    setBusy("createBtn", true);
    const importBoards = importable && $("importCheck").checked ? importable : undefined;
    const r = await remote.createGroup({ name: name.trim(), nickname: nickname.trim(), importBoards });
    setBusy("createBtn", false);
    if (!r.ok) { setMsg("createMsg", startErrorMessage(r, "create")); return; }
    onEntered();
  };

  // ---------- 코드로 참여 ----------
  async function preview(code) {
    const seq = ++previewSeq;
    const r = await remote.previewInvite(code); // 6글자가 된 순간 한 번만(시도 제한이 10분에 10번)
    if (seq !== previewSeq || $("joinCode").value !== code) return;
    if (!r.ok) { lastPreview = ""; setMsg("joinMsg", startErrorMessage(r, "join")); return; } // 같은 코드로 다시 시도할 수 있게
    $("joinGroupName").textContent = r.groupName;
    $("joinGroupCount").textContent = `지금 ${r.memberCount}명이 함께 있어요`;
    $("joinPreview").hidden = false;
    if (r.memberCount >= MAX_MEMBERS) { // 서버가 어차피 거절한다 → 미리 알리고 참여 버튼을 막는다
      groupFull = true; $("joinBtn").disabled = true;
      setMsg("joinMsg", `이 그룹은 ${MAX_MEMBERS}명이 다 찼어요.`);
    }
  }
  function onCodeInput() {
    const input = $("joinCode");
    const code = cleanCodeInput(input.value);
    if (input.value !== code) input.value = code;
    if (isFullCode(code) && code === lastPreview) return;   // 이미 미리 보기를 요청(또는 표시)한 같은 코드면 그대로 둔다
    groupFull = false; if (!busy) $("joinBtn").disabled = false;
    previewSeq++;                                  // 이전 미리 보기 결과는 버린다
    $("joinPreview").hidden = true;
    setMsg("joinMsg", "");
    if (isFullCode(code) && code !== lastPreview) { lastPreview = code; preview(code); }
    if (!isFullCode(code)) lastPreview = "";
  }
  $("joinCode").addEventListener("input", onCodeInput);
  forms.join.onsubmit = async e => {
    e.preventDefault();
    if (busy) return;
    const code = cleanCodeInput($("joinCode").value), nickname = $("joinNick").value;
    const bad = validateJoin({ code, nickname });
    if (bad) { setMsg("joinMsg", bad.message); $(bad.field === "code" ? "joinCode" : "joinNick").focus(); return; }
    setMsg("joinMsg", "");
    setBusy("joinBtn", true);
    const r = await remote.joinGroup(code, nickname.trim());
    setBusy("joinBtn", false);
    if (!r.ok) { setMsg("joinMsg", startErrorMessage(r, "join")); return; }
    onEntered();
  };

  $("soloBtn").onclick = () => { if (!busy) onSolo(); };
  $("startBackBtn").onclick = () => { if (!busy) onBack(); };

  // ---------- 열고 닫기 ----------
  const behind = () => [document.querySelector("main"), document.querySelector("aside")];
  const view = {
    isOpen: () => !screen.hidden,
    // opts: { mode:"create"|"join", code, canGoBack, notice }
    async show({ mode = "create", code = "", canGoBack = false, notice = "" } = {}) {
      for (const el of behind()) if (el) el.inert = true;   // 키보드·스페이스바가 룰렛으로 가지 않게
      screen.hidden = false;
      $("startBackBtn").hidden = !canGoBack;
      setMode(mode);
      setMsg("createMsg", mode === "create" ? notice : "");
      setMsg("joinMsg", mode === "join" ? notice : "");
      await loadImportable();
      if (!$("createNick").value || !$("joinNick").value) {
        try {
          const nick = (await local.getDevice()).nickname;
          if (nick) { if (!$("createNick").value) $("createNick").value = nick; if (!$("joinNick").value) $("joinNick").value = nick; }
        } catch { /* 닉네임 채우기는 덤 */ }
      }
      if (mode === "join") {
        if (code) { $("joinCode").value = ""; $("joinCode").value = cleanCodeInput(code); onCodeInput(); }
        if (notice) setMsg("joinMsg", notice);   // 코드를 채우면 메시지가 지워지므로 안내는 그 뒤에
        ($("joinCode").value.length === 6 ? $("joinNick") : $("joinCode")).focus();
      } else {
        $("createGroupName").focus();
      }
    },
    hide() {
      screen.hidden = true;
      for (const el of behind()) if (el) el.inert = false;
    },
  };
  return view;
}
