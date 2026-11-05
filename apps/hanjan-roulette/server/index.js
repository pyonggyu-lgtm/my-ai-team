// 서버 뼈대. 시험은 createServer({ dbPath, now }) 로 임의 포트·임시 DB 로 띄운다.
import express from "express";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { Server as IoServer } from "socket.io";
import { openDb } from "./db.js";
import { createRateLimiter, requireMember } from "./auth.js";
import { ApiError, statusOfDbCode } from "./http.js";
import { DbError } from "./db.js";
import { createRealtime } from "./realtime.js";
import { mountGroupRoutes } from "./routes/groups.js";
import { mountBoardRoutes } from "./routes/boards.js";
import { mountHistoryRoutes } from "./routes/history.js";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function createServer({ dbPath = ":memory:", now = () => new Date(), staticDir = null, rateLimit, createLimit, joinLimit, log = null } = {}) {
  const db = openDb(dbPath, { now });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback"); // Nginx 는 같은 서버(루프백)에 있다

  const httpServer = createHttpServer(app);
  const io = new IoServer(httpServer); // CORS 설정 안 함(같은 주소에서만)
  const server = { app, httpServer, io, db, realtime: createRealtime({ io, db, now }) };
  // 라우트는 server.realtime 을 부를 때마다 읽는다 → 시험에서 emit 을 감시할 수 있다
  const realtime = { emit: (...a) => server.realtime.emit(...a), disconnectMember: (...a) => server.realtime.disconnectMember(...a) };

  const limiter = createRateLimiter({ ...rateLimit, now }); // 초대 코드 틀린 시도
  // 그룹 만들기(인증 없음): 주소당 1시간에 5번, 맞든 틀리든 센다. 초대 limiter 와 별개.
  const createLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000, globalMax: Infinity, ...createLimit, now });
  // 참여 성공: 주소당 1시간에 30번. 초대 틀린 시도 limiter 와 별개.
  const joinLimiter = createRateLimiter({ max: 30, windowMs: 60 * 60 * 1000, globalMax: Infinity, ...joinLimit, now });
  const auth = requireMember({
    findMemberByTokenHash: db.findMemberByTokenHash,
    getGroup: db.getGroup,
    groupIdOfBoard: db.groupIdOfBoard,
  });

  // 요청 기록은 메서드·경로(쿼리 제외)·상태 코드만. 초대 코드는 경로에 있으므로 가린다.
  const pathOf = req => req.originalUrl.split("?")[0]; // 쿼리 제외, 마운트 경로 포함
  // 대소문자·연속 슬래시를 바꿔 써도(/API/Invites/…, /api//invites/…) 초대 코드는 남기지 않는다.
  const safePath = p => {
    const n = p.toLowerCase().replace(/\/{2,}/g, "/");
    return n.startsWith("/api/invites/") ? n.replace(/^\/api\/invites\/[^/]*/, "/api/invites/***") : p;
  };
  if (log) app.use((req, res, next) => {
    res.on("finish", () => log(`${req.method} ${safePath(pathOf(req))} ${res.statusCode}`));
    next();
  });

  const smallJson = express.json({ limit: "16kb" });
  const bigJson = express.json({ limit: "1mb" }); // 그룹 만들 때 옮기는 기록 때문
  // 그룹 만들기는 라우트 안에서 (생성 제한 → bigJson) 순서로 읽는다 → 막힌 주소는 본문을 읽지 않는다.
  const isCreate = req => req.method === "POST" && /^\/api\/groups\/?$/i.test(req.path);
  app.use((req, res, next) => (isCreate(req) ? next() : smallJson(req, res, next)));

  const ctx = { db, now, realtime, requireMember: auth, limiter, createLimiter, joinLimiter, bigJson };
  mountGroupRoutes(app, ctx);
  mountBoardRoutes(app, ctx);
  mountHistoryRoutes(app, ctx);

  if (staticDir) app.use(express.static(staticDir));
  app.use("/api", (req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "찾을 수 없어요." } });
  });

  // 오류는 한 곳에서. 스택·요청 본문·Authorization 헤더는 기록하지 않는다.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status, code, message, extra = {};
    if (err instanceof ApiError) ({ status, code, message, extra } = err);
    else if (err instanceof DbError && statusOfDbCode(err.code)) ({ code, message } = err), status = statusOfDbCode(err.code);
    else if (err?.type === "entity.parse.failed") [status, code, message] = [400, "VALIDATION", "보낸 내용이 올바르지 않아요."];
    else if (err?.type === "entity.too.large") [status, code, message] = [413, "VALIDATION", "보낸 내용이 너무 커요."];
    else {
      [status, code, message] = [500, "INTERNAL", "잠시 후 다시 시도해 주세요."];
      if (log) log(`${req.method} ${safePath(pathOf(req))} 500 INTERNAL`);
    }
    res.status(status).json({ error: { code, message, ...extra } });
  });

  let closed = false;
  return Object.assign(server, {
    listen(port = 0, host = process.env.HOST || "127.0.0.1") {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => resolve(httpServer.address().port));
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      server.realtime.close();
      await new Promise(res => { io.close(() => res()); httpServer.closeAllConnections?.(); });
      db.close();
    },
  });
}

// 파일을 직접 실행했을 때만: 개발 서버
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await createServer({ dbPath: join(APP_ROOT, "data", "hanjan.db"), staticDir: join(APP_ROOT, "client"), log: console.log });
  const port = await s.listen(Number(process.env.PORT) || 3000);
  console.log(`한잔메뉴룰렛 개발 서버: http://localhost:${port}`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => s.close().then(() => process.exit(0)));
}
