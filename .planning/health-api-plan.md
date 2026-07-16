# 헬스체크 API — Phase 계획

**요청자:** 진서(팀장) · **PM/아키텍트:** 진록 · **작성일:** 2026-07-16

## 목표
`GET /health` 요청 시 `{status, uptime, version}`을 JSON으로 반환하는 최소 헬스체크 엔드포인트 구현.

## 스택 결정 (아키텍트 판단)
- 런타임: **Node.js**
- 프레임워크: **Express** (경량, 테스트 용이)
- 테스트: **Jest + Supertest** (app 인스턴스 export → HTTP 통합 테스트)
- 그린필드이므로 `package.json`부터 신규 생성

## 응답 계약 (인터페이스 = 계약, 변경 시 진오에 선공지)
```
GET /health  →  200 OK  (Content-Type: application/json)
{
  "status":  "ok",        // 문자열 리터럴. 프로세스 정상 시 항상 "ok"
  "uptime":  123.45,      // number, 초 단위. process.uptime()
  "version": "1.0.0"      // string. package.json 의 version 필드
}
```

## Phase 분해

| Phase | 담당 | 산출물 | 상태 |
|---|---|---|---|
| 1. 설계 | 진록 | `docs/api-spec.md`, 본 계획서 | ✅ 완료 |
| 1b. 조사(병렬) | 진삼 | status/uptime 컨벤션 조사 → `docs/research/` | 진행 |
| 2. 구현 | 진오 | `package.json`, `src/app.js`, `src/server.js`, `tests/health.test.js` | 대기 |
| 3. 리뷰 | 진육 | 구현 리뷰 (읽기 전용) | 대기 |

- **진사(UI):** 이번 작업은 UI 없음 → 배정 없음 (정직하게 제외)
- 순서: (설계+조사 병렬) → 구현 → 리뷰. 리뷰 중 해당 파일 수정 금지.

## 완료 기준 (DoD)
- `GET /health` 200 + 스키마 3필드 정확히 반환
- 테스트 GREEN (2개 이상: 상태코드, 스키마)
- 진육 리뷰 통과
