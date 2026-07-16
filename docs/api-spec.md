# API 명세 — 헬스체크

## GET /ping

서비스 라이브니스(liveness) 확인용 최소 엔드포인트. 인증 불필요, 파라미터 없음.

### 요청
```
GET /ping
```

### 응답 — 200 OK
`Content-Type: application/json`

| 필드 | 타입 | 설명 | 출처 |
|---|---|---|---|
| `message` | string | 항상 `"pong"` | 리터럴 |

예시:
```json
{
  "message": "pong"
}
```

### 구현 가이드 (진오 참조)
- `src/app.js`에 `app.get('/ping', ...)` 라우트 1개 추가. `res.json({ message: 'pong' })`.
- `/health`와 동일한 export 구조 재사용 (신규 파일·의존성 없음).

### 테스트 요구사항 (tests/ping.test.js — supertest+jest)
1. `GET /ping` → 200
2. 응답 body 가 `{ message: "pong" }`
3. `Content-Type` 이 JSON

---

## GET /health

서비스 생존 및 기본 메타데이터 확인용 엔드포인트. 인증 불필요.

### 요청
```
GET /health
```
파라미터 없음.

### 응답 — 200 OK
`Content-Type: application/json`

| 필드 | 타입 | 설명 | 출처 |
|---|---|---|---|
| `status` | string | 서비스 상태. 정상 시 `"ok"` | 리터럴 |
| `uptime` | number | 프로세스 가동 시간(초, 소수 허용) | `process.uptime()` |
| `version` | string | 앱 버전 (semver) | `package.json` 의 `version` |

예시:
```json
{
  "status": "ok",
  "uptime": 123.45,
  "version": "1.0.0"
}
```

### 구현 가이드 (진오 참조)
- `src/app.js`: Express `app` 을 생성·export (라우트만 등록, listen 하지 않음 → 테스트에서 supertest 로 주입).
- `src/server.js`: `app.listen(PORT)` 진입점. `PORT` 는 env `PORT` 또는 기본 `3000`.
- `version` 은 `require('../package.json').version` 로 읽는다 (하드코딩 금지).
- `uptime` 은 매 요청 시 `process.uptime()` 로 계산.

### 테스트 요구사항 (tests/health.test.js)
1. `GET /health` → 200
2. 응답 body 에 `status === "ok"`, `typeof uptime === "number"`, `typeof version === "string"` 존재
3. `Content-Type` 이 JSON

### 향후 확장 (이번 범위 아님)
- DB/의존성 헬스 → `status: "degraded"` 세분화, `checks[]` 배열 추가 여지.
