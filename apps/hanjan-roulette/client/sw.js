// 서비스 워커: 앱 파일을 미리 저장해 오프라인에서도 열리게 한다.
// 앱 파일을 바꿔 배포할 때는 아래 CACHE 이름의 숫자를 올린다. (이 이름은 이 한 곳에서만 정의)
const CACHE = "hanjan-v1";

const APP_FILES = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "fonts/Pretendard-Bold.woff2",
  "fonts/Pretendard-Medium.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "js/sw-register.js",
  "js/api.js",
  "js/app.js",
  "js/effects.js",
  "js/josa.js",
  "js/kst.js",
  "js/outbox.js",
  "js/pool.js",
  "js/records.js",
  "js/start-logic.js",
  "js/store-local.js",
  "js/store-remote.js",
  "js/templates.js",
  "js/wheel.js",
  "js/views/board-editor.js",
  "js/views/group.js",
  "js/views/history.js",
  "js/views/start.js",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_FILES.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("hanjan-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API·실시간 연결은 건드리지 않는다(네트워크만)
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;

  // 페이지 이동은 쿼리(?join=…)를 무시하고 index.html 로 응답
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE)
        .then(c => c.match("index.html"))
        .then(hit => hit || fetch(req))
    );
    return;
  }

  // 나머지: 저장본 먼저, 없으면 네트워크
  event.respondWith(
    caches.open(CACHE)
      .then(c => c.match(req))
      .then(hit => hit || fetch(req))
  );
});
