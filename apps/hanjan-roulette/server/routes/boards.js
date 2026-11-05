// 메뉴판·메뉴·오늘 넘김 API (설계 4.2 단계 2).
import { todayKST } from "../../client/js/kst.js";
import { bad, bodyObject, str, bool } from "../http.js";
import { TEMPLATE_IDS, TEMPLATES, MAX_ITEM_NAME, MAX_BOARD_NAME, MAX_RESULT_LEAD } from "../../client/js/templates.js";

export function mountBoardRoutes(app, { db, now, realtime, requireMember }) {
  const by = req => ({ memberId: req.member.id, nickname: req.member.nickname });
  const send = (req, res, board, status = 200) => {
    realtime.emit(req.member.groupId, "board:updated", { board }, by(req));
    res.status(status).json(board);
  };

  app.post("/api/groups/:gid/boards", requireMember, (req, res) => {
    const body = bodyObject(req);
    const name = str(body, "name", "메뉴판 이름", MAX_BOARD_NAME);
    const template = body.template ?? "empty";
    if (!TEMPLATE_IDS.includes(template)) throw bad("메뉴판 종류가 올바르지 않아요.");
    const resultLead = str(body, "resultLead", "결과 문구", MAX_RESULT_LEAD, { optional: true }) ?? TEMPLATES[template].resultLead;
    const excludeYesterday = bool(body, "excludeYesterday", { optional: true, fallback: true });
    const board = db.createBoard({ groupId: req.params.gid, name, resultLead, template, excludeYesterday });
    realtime.emit(req.params.gid, "board:created", { board }, by(req));
    res.status(201).json(board);
  });

  app.patch("/api/boards/:bid", requireMember, (req, res) => {
    const body = bodyObject(req);
    const patch = {};
    const name = str(body, "name", "메뉴판 이름", MAX_BOARD_NAME, { optional: true });
    const lead = str(body, "resultLead", "결과 문구", MAX_RESULT_LEAD, { optional: true });
    const ex = bool(body, "excludeYesterday", { optional: true });
    if (name !== undefined) patch.name = name;
    if (lead !== undefined) patch.resultLead = lead;
    if (ex !== undefined) patch.excludeYesterday = ex;
    if (Object.keys(patch).length === 0) throw bad("바꿀 내용이 없어요.");
    send(req, res, db.updateBoard(req.params.bid, patch));
  });

  app.delete("/api/boards/:bid", requireMember, (req, res) => {
    db.deleteBoard(req.params.bid);
    realtime.emit(req.member.groupId, "board:deleted", { boardId: req.params.bid }, by(req));
    res.status(204).end();
  });

  app.put("/api/groups/:gid/boards/order", requireMember, (req, res) => {
    const ids = bodyObject(req).boardIds;
    if (!Array.isArray(ids) || !ids.every(x => typeof x === "string")) throw bad("보낸 내용이 올바르지 않아요.");
    db.reorderBoards(req.params.gid, ids);
    realtime.emit(req.params.gid, "boards:reordered", { boardIds: ids }, by(req));
    res.status(204).end();
  });

  app.post("/api/boards/:bid/items", requireMember, (req, res) => {
    const body = bodyObject(req);
    const name = str(body, "name", "메뉴 이름", MAX_ITEM_NAME);
    let sortOrder;
    if (body.sortOrder !== undefined && body.sortOrder !== null) {
      // 메뉴 목록 안의 자리 번호(0부터). 끝보다 크면 맨 끝에 들어간다.
      if (!Number.isSafeInteger(body.sortOrder) || body.sortOrder < 0) throw bad("보낸 내용이 올바르지 않아요.");
      sortOrder = body.sortOrder;
    }
    send(req, res, db.addItem({ boardId: req.params.bid, name, sortOrder }), 201);
  });

  app.patch("/api/boards/:bid/items/:iid", requireMember, (req, res) => {
    const isOn = bool(bodyObject(req), "isOn");
    send(req, res, db.setItemOn({ boardId: req.params.bid, itemId: req.params.iid, isOn }));
  });

  app.delete("/api/boards/:bid/items/:iid", requireMember, (req, res) => {
    send(req, res, db.deleteItem({ boardId: req.params.bid, itemId: req.params.iid }));
  });

  app.post("/api/boards/:bid/reset", requireMember, (req, res) => {
    send(req, res, db.resetBoard(req.params.bid));
  });

  // 실제로 바뀌었을 때만 이벤트를 보낸다(이미 있는 이름이면 그대로 200, 이벤트 없음)
  const sendIfChanged = (req, res, before, board) => {
    if (board.rev !== before) realtime.emit(req.member.groupId, "board:updated", { board }, by(req));
    res.json(board);
  };
  const revOf = bid => db.boardView(bid, todayKST(now())).rev;

  app.post("/api/boards/:bid/skipped", requireMember, (req, res) => {
    const name = str(bodyObject(req), "name", "메뉴 이름", MAX_ITEM_NAME);
    const before = revOf(req.params.bid);
    sendIfChanged(req, res, before, db.addSkipped({ boardId: req.params.bid, name }));
  });

  app.delete("/api/boards/:bid/skipped", requireMember, (req, res) => {
    const before = revOf(req.params.bid);
    sendIfChanged(req, res, before, db.clearSkipped(req.params.bid));
  });
}
