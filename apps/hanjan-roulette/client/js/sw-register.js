// 서비스 워커 등록. 지원하지 않거나 실패하면 조용히 넘긴다. (CSP 때문에 인라인 스크립트 대신 파일로 둠)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
