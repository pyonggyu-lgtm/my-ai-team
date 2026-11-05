// 그룹·초대·멤버 API (설계 4.2 단계 2).
import { ApiError, bad, bodyObject, str, bool, validDate } from "../http.js";
import { newToken, hashToken, newInviteCode, normalizeInviteCode, isValidInviteCode, rateLimitMiddleware, countedRateLimitMiddleware, successLimitMiddleware } from "../auth.js";
import { todayKST } from "../../client/js/kst.js";
import { TEMPLATES, TEMPLATE_IDS, MAX_ITEMS, MAX_ITEM_NAME, MAX_BOARDS, MAX_BOARD_NAME, MAX_RESULT_LEAD } from "../../client/js/templates.js";

export const MAX_GROUP_NAME = 20;
export const MAX_NICKNAME = 10;
export const MAX_IMPORT_HISTORY = 3660; // 메뉴판 하나당 10년치

// 1단계 getState() 모양의 메뉴판들 → db.createGroup 의 boards 로. 하나라도 틀리면 400(일부만 옮기지 않음).
function parseImport(raw, nowIso, today) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw bad("옮길 메뉴판 모양이 올바르지 않아요.");
  if (raw.length > MAX_BOARDS) throw bad("메뉴판은 10개까지 만들 수 있어요.");
  return raw.map(b => {
    if (b === null || typeof b !== "object" || Array.isArray(b)) throw bad("옮길 메뉴판 모양이 올바르지 않아요.");
    const name = str(b, "name", "메뉴판 이름", MAX_BOARD_NAME);
    const template = b.template === undefined || b.template === null ? "empty" : b.template;
    if (!TEMPLATE_IDS.includes(template)) throw bad("옮길 메뉴판 모양이 올바르지 않아요.");
    const resultLead = str(b, "resultLead", "결과 문구", MAX_RESULT_LEAD, { optional: true }) ?? TEMPLATES[template].resultLead;
    const excludeYesterday = bool(b, "excludeYesterday", { optional: true, fallback: true });
    const rawItems = b.items ?? [];
    if (!Array.isArray(rawItems)) throw bad("옮길 메뉴판 모양이 올바르지 않아요.");
    if (rawItems.length > MAX_ITEMS) throw bad("16개까지 넣을 수 있어요.");
    const seen = new Set();
    const items = rawItems.map(it => {
      if (it === null || typeof it !== "object") throw bad("옮길 메뉴판 모양이 올바르지 않아요.");
      const n = str(it, "name", "메뉴 이름", MAX_ITEM_NAME);
      if (seen.has(n)) throw bad("이미 있는 메뉴예요.");
      seen.add(n);
      const on = it.isOn ?? it.on; // 1단계는 on, 서버는 isOn
      if (on !== undefined && typeof on !== "boolean") throw bad("옮길 메뉴판 모양이 올바르지 않아요.");
      return { name: n, isOn: on !== false };
    });
    const rawHist = b.history ?? [];
    if (!Array.isArray(rawHist)) throw bad("옮길 기록 모양이 올바르지 않아요.");
    if (rawHist.length > MAX_IMPORT_HISTORY) throw bad("옮길 기록이 너무 많아요.");
    const dates = new Set();
    const history = rawHist.map(h => {
      if (h === null || typeof h !== "object" || !validDate(h.date)) throw bad("옮길 기록의 날짜가 올바르지 않아요.");
      if (h.date > today) throw bad("옮길 기록에 아직 오지 않은 날짜가 있어요.");
      if (dates.has(h.date)) throw bad("옮길 기록의 날짜가 겹쳐요.");
      dates.add(h.date);
      const confirmedAt = typeof h.confirmedAt === "string" && !Number.isNaN(Date.parse(h.confirmedAt))
        ? new Date(h.confirmedAt).toISOString() : nowIso;
      return { date: h.date, name: str(h, "name", "기록의 메뉴 이름", MAX_ITEM_NAME), confirmedAt };
    });
    return { name, resultLead, template, excludeYesterday, items, history };
  });
}

export function mountGroupRoutes(app, { db, now, realtime, requireMember, limiter, createLimiter, joinLimiter, bigJson }) {
  const by = req => ({ memberId: req.member.id, nickname: req.member.nickname });
  const limit = rateLimitMiddleware(limiter);
  const groupInfo = g => ({ id: g.id, name: g.name, inviteCode: g.inviteCode });

  // 없는 코드·형식이 틀린 코드·활성 멤버 0명 그룹은 모두 같은 404. 없는 코드와 활성 멤버 0명 그룹만 틀린 시도로 센다(형식 오류는 세지 않음). 데이터는 지우지 않음.
  const openGroupByCode = (req, rawCode) => {
    const code = normalizeInviteCode(rawCode);
    // 형식이 틀린 입력은 진짜 코드일 수 없으므로 DB 조회 없이 404, 틀린 시도로 세지 않는다(어르신 오타로 막히지 않게)
    if (!isValidInviteCode(code)) throw new ApiError(404, "NOT_FOUND", "없는 초대 코드예요.");
    const g = db.getGroupByInvite(code);
    if (!g || db.memberCount(g.id) === 0) {
      req.recordInviteFailure();
      throw new ApiError(404, "NOT_FOUND", "없는 초대 코드예요.");
    }
    return g;
  };

  app.get("/api/health", (req, res) => {
    const d = now();
    res.json({ ok: true, now: d.toISOString(), today: todayKST(d) });
  });

  app.post("/api/groups", countedRateLimitMiddleware(createLimiter), bigJson, (req, res) => {
    const body = bodyObject(req);
    const name = str(body, "name", "그룹 이름", MAX_GROUP_NAME);
    const nickname = str(body, "nickname", "닉네임", MAX_NICKNAME);
    const imp = body.importBoards;
    const boards = Array.isArray(imp) && imp.length === 0 ? undefined : parseImport(imp, now().toISOString(), todayKST(now()));
    const token = newToken();
    const { group, member } = db.createGroup({
      name, nickname, tokenHash: hashToken(token),
      inviteCode: newInviteCode(c => db.getGroupByInvite(c) !== null), boards,
    });
    res.status(201).json({ group: groupInfo(group), member: { id: member.id, nickname: member.nickname, isOwner: true }, token });
  });

  app.get("/api/invites/:code", limit, (req, res) => {
    const g = openGroupByCode(req, req.params.code);
    res.json({ groupName: g.name, memberCount: db.memberCount(g.id) });
  });

  app.post("/api/invites/:code/join", limit, successLimitMiddleware(joinLimiter), (req, res) => {
    const g = openGroupByCode(req, req.params.code);
    const nickname = str(bodyObject(req), "nickname", "닉네임", MAX_NICKNAME);
    const token = newToken();
    const m = db.addMember({ groupId: g.id, nickname, tokenHash: hashToken(token) });
    const member = { id: m.id, nickname: m.nickname, isOwner: false, joinedAt: m.joinedAt };
    req.recordSuccess();
    realtime.emit(g.id, "member:joined", { member }, { memberId: m.id, nickname: m.nickname });
    res.status(201).json({ group: groupInfo(g), member, token });
  });

  app.get("/api/groups/:gid/state", requireMember, (req, res) => {
    const today = todayKST(now());
    const g = db.getGroup(req.params.gid);
    const members = db.listMembers(g.id);
    res.json({
      today,
      group: groupInfo(g),
      me: members.find(m => m.id === req.member.id) ?? { id: req.member.id, nickname: req.member.nickname, isOwner: false },
      members,
      boards: db.boardsOf(g.id, today),
    });
  });

  app.get("/api/groups/:gid/members", requireMember, (req, res) => {
    res.json(db.listMembers(req.params.gid));
  });

  app.delete("/api/groups/:gid/members/me", requireMember, (req, res) => {
    db.leaveMember({ groupId: req.params.gid, memberId: req.member.id });
    realtime.emit(req.params.gid, "member:left", { member: { id: req.member.id, nickname: req.member.nickname } }, by(req));
    realtime.disconnectMember(req.params.gid, req.member.id);
    res.status(204).end();
  });
}
