// 그룹 설정 창(초대 링크·코드·멤버 목록·나가기)과 "그룹 설정" 버튼. 마크업은 index.html.
// 서버가 준 문자열(그룹 이름·닉네임)은 모두 textContent 로만 넣는다.
import { inviteLink } from "../start-logic.js";

const $ = id => document.getElementById(id);

// getStore(): 지금 그룹 저장소(store-remote). onOpenStart(): 혼자 쓰기 중 "친구와 함께 쓰기".
export function initGroup({ getStore }) {
  const dlg = $("groupDialog"), leaveDlg = $("leaveDialog");
  let copyTimer = 0, current = { code: "", link: "" };

  function say(text) {
    const m = $("copyMsg");
    m.textContent = text;
    clearTimeout(copyTimer);
    if (text) copyTimer = setTimeout(() => { m.textContent = ""; }, 3000);
  }
  async function copy(text, okText) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      say(okText);
    } catch {
      say("복사가 안 돼요. 아래 링크를 길게 눌러 복사해 주세요.");
      const el = $("inviteLink");
      el.focus(); el.select();
    }
  }
  $("copyLinkBtn").onclick = () => copy(current.link, "링크를 복사했어요");
  $("copyCodeBtn").onclick = () => copy(current.code, "코드를 복사했어요");

  function renderMembers(members, myId) {
    const ul = $("memberList");
    ul.textContent = "";
    for (const m of members) {
      const li = document.createElement("li"); li.className = "member-row";
      const nm = document.createElement("span"); nm.className = "member-name"; nm.textContent = m.nickname;
      li.appendChild(nm);
      if (m.isOwner) { const t = document.createElement("span"); t.className = "member-tag"; t.textContent = "만든 사람"; li.appendChild(t); }
      if (m.id === myId) { const t = document.createElement("span"); t.className = "member-tag me"; t.textContent = "나"; li.appendChild(t); }
      ul.appendChild(li);
    }
    $("memberCount").textContent = members.length + "명";
  }

  async function open() {
    const store = getStore();
    const group = await store.getGroup();
    if (!group) return;
    current = { code: group.inviteCode, link: inviteLink(location.origin, group.inviteCode) };
    $("groupDialogTitle").textContent = group.name;
    $("inviteCode").textContent = group.inviteCode;
    $("inviteLink").value = current.link;
    say("");
    renderMembers(await store.listMembers(), store.getSession().memberId);
    if (!dlg.open) dlg.showModal();
  }
  $("groupCloseBtn").onclick = () => dlg.close();

  // ---------- 나가기 ----------
  $("leaveBtn").onclick = () => { $("leaveMsg").textContent = ""; leaveDlg.showModal(); };
  $("leaveNoBtn").onclick = () => leaveDlg.close();
  $("leaveYesBtn").onclick = async () => {
    const b = $("leaveYesBtn");
    if (b.disabled) return;
    b.disabled = true;
    const r = await getStore().leaveGroup();       // 연결이 없으면 "연결되면 바꿀 수 있어요."
    b.disabled = false;
    if (!r.ok) { $("leaveMsg").textContent = r.message; return; }
    leaveDlg.close(); dlg.close();                  // 이어서 signedOut 신호로 시작 화면이 열린다
  };

  return {
    open,
    // 멤버가 바뀌었을 때 열려 있으면 목록만 다시 그린다
    async refreshIfOpen() {
      if (!dlg.open) return;
      const store = getStore();
      renderMembers(await store.listMembers(), store.getSession().memberId);
    },
    closeAll() { if (leaveDlg.open) leaveDlg.close(); if (dlg.open) dlg.close(); },
  };
}
