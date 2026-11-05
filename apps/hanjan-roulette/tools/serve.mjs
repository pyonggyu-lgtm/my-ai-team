// 의존성 없는 정적 파일 서버. client/ 를 기본 8080 포트로 제공 (PORT 환경 변수로 변경).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client"));
const PORT = Number(process.env.PORT) || 8080;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { return send(res, 400, "Bad Request"); }
  if (pathname.includes("\0")) return send(res, 400, "Bad Request");
  if (pathname === "/") pathname = "/index.html";

  const file = path.resolve(ROOT, "." + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden");

  fs.realpath(file, (err, real) => {
    if (err) return send(res, 404, "Not Found");
    if (!real.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden");
    fs.stat(real, (err2, st) => {
      if (err2 || !st.isFile()) return send(res, 404, "Not Found");
      const type = MIME[path.extname(real).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": "no-cache" });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(real).pipe(res);
    });
  });
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}/  (root: ${ROOT})`));
