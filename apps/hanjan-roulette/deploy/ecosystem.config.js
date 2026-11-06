// PM2 설정. 사용: cd /srv/hanjan/apps/hanjan-roulette && pm2 start deploy/ecosystem.config.js
// ─ 경로는 여기 한 곳 ─
const APP = "/srv/hanjan/apps/hanjan-roulette";
const LOG = "/srv/hanjan-data/logs";

// ※ 앱 package.json 은 "type":"module" 이지만, 같은 폴더의 deploy/package.json({"type":"commonjs"}) 덕분에
//   이 파일은 CommonJS 로 읽힌다. PM2 가 require 로 읽으므로 module.exports 를 쓴다.
module.exports = {
  apps: [{
    name: "hanjan",
    cwd: APP,
    // node 를 직접 실행한다. PM2 가 server/index.js 를 자기 실행기(ProcessContainerFork)로 불러오면
    // index.js 의 '직접 실행했을 때만' 조건(process.argv[1])이 거짓이 되어 서버가 안 뜨기 때문.
    script: "/usr/bin/node",
    interpreter: "none",
    args: "--env-file=.env server/index.js",   // PORT, HOST, DB_PATH 는 APP/.env 에서 (비밀값 없음)
    instances: 1,                       // 방·시도 제한이 메모리에 있어 1개만
    exec_mode: "fork",
    env: { NODE_ENV: "production" },
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 2000,
    max_memory_restart: "300M",
    kill_timeout: 5000,                 // SIGINT(PM2 기본) 후 DB 를 닫을 시간
    time: true,
    out_file: `${LOG}/hanjan-out.log`,
    error_file: `${LOG}/hanjan-error.log`,
    merge_logs: true,
  }],
};
