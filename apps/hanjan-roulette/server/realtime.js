// 실시간(Socket.IO): 그룹 방, 서버 → 기기 이벤트, 한국 자정 day:changed.
// 쓰기는 모두 REST 로 하고, 라우트가 커밋한 뒤에만 emit 을 부른다. 기기 → 서버 이벤트는 2단계에 없다.
import { randomUUID } from "node:crypto";
import { hashToken } from "./auth.js";
import { todayKST } from "../client/js/kst.js";

export const roomOf = gid => `group:${gid}`;

export function createRealtime({ io, db, now = () => new Date(), checkIntervalMs = 30_000 }) {
  // 접속 확인: auth { token, groupId } → 토큰(UNAUTHORIZED) → 소속(FORBIDDEN). 없는 그룹도 FORBIDDEN(존재 여부를 알려 주지 않음).
  io.use((socket, next) => {
    const auth = socket.handshake.auth;
    const token = auth && typeof auth.token === "string" ? auth.token : "";
    const member = token ? db.findMemberByTokenHash(hashToken(token)) : null;
    if (!member || member.leftAt) return next(new Error("UNAUTHORIZED"));
    const groupId = auth && typeof auth.groupId === "string" ? auth.groupId : "";
    if (!groupId || member.groupId !== groupId) return next(new Error("FORBIDDEN"));
    socket.data.memberId = member.id;
    socket.data.groupId = groupId;
    next();
  });

  // 재연결·서버 재시작 뒤에도 새 소켓이 들어오므로 방 가입은 여기서 매번 한다.
  io.on("connection", socket => {
    // 접속 확인 뒤 방에 들어가기 전에 나갔을 수 있다 → 다시 확인
    const m = db.getMember(socket.data.memberId);
    if (!m || m.leftAt) return void socket.disconnect(true);
    socket.join(roomOf(socket.data.groupId));
  });

  const stamp = by => ({ eventId: randomUUID(), at: now().toISOString(), by });

  let lastDay = todayKST(now());

  const rt = {
    // 공통 필드 { eventId, at, by:{memberId,nickname} } 를 붙여 그 그룹 방 전체에 보낸다.
    emit(gid, event, payload, by) {
      io.to(roomOf(gid)).emit(event, { ...payload, ...stamp(by) });
    },

    // 나간 멤버의 소켓을 모두 끊는다(member:left 를 먼저 보낸 뒤 호출). 자동 재연결도 안 한다(disconnect(true)).
    disconnectMember(gid, memberId) {
      const ids = io.sockets.adapter.rooms.get(roomOf(gid));
      if (!ids) return;
      for (const id of [...ids]) {
        const s = io.sockets.sockets.get(id);
        if (s && s.data.memberId === memberId) s.disconnect(true);
      }
    },

    // 한국 날짜가 바뀌었으면 모든 기기에 day:changed. 바뀌었는지 돌려준다.
    checkDay() {
      const today = todayKST(now());
      if (today === lastDay) return false;
      lastDay = today;
      io.emit("day:changed", { today, ...stamp(null) });
      return true;
    },

    close() { clearInterval(timer); },
  };

  const timer = setInterval(() => rt.checkDay(), checkIntervalMs);
  timer.unref();
  return rt;
}
