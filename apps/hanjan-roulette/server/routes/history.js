// 확정·기록·통계 API (설계 4.2 단계 2).
import { ApiError, bad, bodyObject, str, bool, validDate, queryValue } from "../http.js";
import { todayKST, addDays } from "../../client/js/kst.js";
import { sliceHistory, countByName } from "../../client/js/records.js";
import { MAX_ITEM_NAME } from "../../client/js/templates.js";
import { withRo } from "../../client/js/josa.js";

export function mountHistoryRoutes(app, { db, now, realtime, requireMember }) {
  const by = req => ({ memberId: req.member.id, nickname: req.member.nickname });

  app.post("/api/boards/:bid/history", requireMember, (req, res) => {
    const body = bodyObject(req);
    const name = str(body, "name", "메뉴 이름", MAX_ITEM_NAME);
    const overwrite = bool(body, "overwrite", { optional: true, fallback: false });
    const d = now();
    const today = todayKST(d);
    let date = today;
    if (body.date !== undefined && body.date !== null) {
      if (!validDate(body.date)) throw bad("날짜가 올바르지 않아요.");
      // 오늘 또는 어제만 받는다(오프라인에서 누른 확정)
      if (body.date !== today && body.date !== addDays(today, -1)) throw bad("연결이 오래 끊겨 확정을 보내지 못했어요.");
      date = body.date;
    }
    const r = db.confirm({ boardId: req.params.bid, date, name, memberId: req.member.id, overwrite, confirmedAt: d.toISOString() });
    if (!r.ok) {
      const e = r.existing;
      throw new ApiError(409, "ALREADY_CONFIRMED", `${e.nickname}님이 ${withRo(e.name)} 확정했어요. 바꿀까요?`, { existing: e });
    }
    const gid = req.member.groupId;
    realtime.emit(gid, "history:confirmed", {
      boardId: req.params.bid, entry: r.entry,
      replaced: r.replaced ? { name: r.replaced.name, nickname: r.replaced.nickname } : null,
    }, by(req));
    realtime.emit(gid, "board:updated", { board: r.board }, by(req));
    res.status(201).json({ entry: r.entry, board: r.board });
  });

  app.get("/api/boards/:bid/history", requireMember, (req, res) => {
    const today = todayKST(now());
    const beforeRaw = queryValue(req, "before");
    if (beforeRaw !== undefined && !validDate(beforeRaw)) throw bad("날짜가 올바르지 않아요.");
    const daysRaw = queryValue(req, "days");
    let days = 30;
    if (daysRaw !== undefined) {
      if (!/^\d{1,2}$/.test(daysRaw) || Number(daysRaw) < 1 || Number(daysRaw) > 90) throw bad("기록 일수는 1~90 사이로 써 주세요.");
      days = Number(daysRaw);
    }
    res.json(sliceHistory(db.historyEntries(req.params.bid), today, { before: beforeRaw, days }));
  });

  app.get("/api/boards/:bid/stats", requireMember, (req, res) => {
    const range = queryValue(req, "range") ?? "30";
    if (!["30", "90", "all"].includes(range)) throw bad("기록 범위가 올바르지 않아요.");
    res.json(countByName(db.historyEntries(req.params.bid), todayKST(now()), range));
  });
}
