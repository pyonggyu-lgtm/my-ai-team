# Ping API — Phase 계획

**요청자:** 진서(팀장) · **PM/아키텍트:** 진록 · **작성일:** 2026-07-16

## 목표
`GET /ping` 요청 시 `{"message":"pong"}`을 JSON으로 반환하는 최소 라이브니스 엔드포인트 추가.

## 스택 결정 (아키텍트 판단)
- 기존 `/health` 인프라(Express `app` export + Jest/Supertest) **그대로 재사용**.
- 신규 의존성·파일 구조 변경 없음. `src/app.js`에 라우트 1개 추가 + `tests/ping.test.js` 신설.

## 응답 계약 (인터페이스 = 계약)
```
GET /ping  →  200 OK  (Content-Type: application/json)
{
  "message": "pong"   // 문자열 리터럴. 항상 "pong"
}
```
- `/health`와 달리 동적 필드 없음(uptime/version 불필요) — 순수 라이브니스 프로브.
- 인증 불필요, 파라미터 없음.

## Phase 분해

| Phase | 담당 | 산출물 | 상태 |
|---|---|---|---|
| 1. 설계 | 진록 | `.planning/ping-api-plan.md`, `docs/api-spec.md` 갱신 | 진행 |
| 2. 구현 | 진오 | `tests/ping.test.js`(RED) → `src/app.js`(GREEN) | 대기 |
| 3. 리뷰 | 진육 | 구현 diff 리뷰 (읽기 전용) | 대기 |

- **진삼(조사):** 기존 /health 패턴 재사용 → 신규 조사 불필요, 배정 없음.
- **진사(UI):** UI 없음 → 배정 없음.
- 순서: 설계 → 구현 → 리뷰. 리뷰 중 해당 파일 수정 금지.

## 완료 기준 (DoD)
- `GET /ping` 200 + `{message:"pong"}` 정확히 반환, Content-Type JSON.
- TDD: RED(테스트 먼저 실패 확인) → GREEN(구현 후 통과). 테스트 3개(상태코드/body/Content-Type).
- 기존 `tests/health.test.js` 회귀 없음(전체 스위트 GREEN).
- 진육 리뷰 통과.
