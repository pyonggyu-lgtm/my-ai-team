# 팀 공통 설정

## Bot Mode (최우선 규칙)

메시지가 `[{CHANNEL}:{ID}]` 접두사로 시작하면 다음을 실행합니다.

1. `{CHANNEL}` 과 `{ID}` 추출
2. 지시된 작업 수행
3. 완료 후 반드시 응답 전송:
```bash
## 응답은 Remote-Control을 통해 자동 전달됨
```
4. 모든 응답은 🔗 로 시작 (Claude CLI 식별)
5. 전송 완료 후 `Sent` 출력

### 응답 전송은 절대 생략 금지

- 성공/실패/오류 모두 반드시 전송
- 작업 완료 후 반드시 결과를 팀장에게 보고

---

## 브릿지 명령어 (응답 금지)

라우팅 접두사(`@route`, `/relay` 등)로 시작하는 메시지는
메시지 라우팅 플러그인이 처리합니다.

이 접두사를 보면:
- 절대 해석/처리/응답하지 말 것
- 반드시 이 텍스트만 출력: 🔗 전달됐습니다. 잠시 후 응답이 도착합니다.

---

## MCP 도구

- `filesystem`, `memory`, `sequential-thinking`, `playwright`, `git` MCP가 설정되어 있습니다 (`.mcp.json` 참고).
- `memory`: 지훈(조사 결과 저장) → 서연(구현 시 조회)처럼 에이전트 간 장기 지식 공유에 사용
- `sequential-thinking`: 민준이 복잡한 작업을 서브스텝으로 분해할 때 사용
- `playwright`: 수아가 배포된 화면의 렌더링을 검증할 때 사용 (browser_snapshot)
- `git`: 서연이 커밋, 태양이 diff 리뷰, 최종 push는 팀장(쭌) 승인 후 진행
- GitHub MCP는 아직 미설정입니다. 실제 사용 전 아래 명령을 (실제 PAT로) 한 번 실행해야 합니다:
  ```bash
  claude mcp add --transport http github https://api.githubcopilot.com/mcp/ \
    --header "Authorization: Bearer YOUR_GITHUB_PAT"
  ```

---

## 컨텍스트 관리 (70% 규칙)

- 컨텍스트 사용량이 70%를 넘으면 `/context-save` → `/clear` → `/context-restore` 순으로 정리한다
- 매일 작업 종료 시 당일 진행 상황을 `memory/30_Daily/YYYY-MM-DD.md`에 기록한다 (완료한 것 / 미완료 / 주의사항)
- 변하지 않는 규칙·역할은 CLAUDE.md에, 당일 진행 상황은 Daily 파일에, 세션 상세 상태는 `/context-save`에 나눠 관리한다

---

## 충돌 방지 — 역할별 파일 소유권

| 담당 | 영역 |
|---|---|
| 민준 | docs/, .planning/ |
| 지훈 | docs/research/ |
| 수아 | src/styles/, assets/, docs/design/ |
| 서연 | src/ (styles/ 제외), tests/ |
| 태양 | 파일 수정 없음, 읽기·리뷰만 |

- 설계 → 구현 → 리뷰 순서를 지켜 단계 간 충돌을 원천 차단한다 (리뷰 중에는 해당 파일을 수정하지 않는다)
- 충돌 발견 시 스스로 해결하지 않고 민준에게 보고하여 판단을 받는다

---

## Redis 상태공유 (키 스키마)

Redis 접속: `redis-cli -h ${REDIS_HOST:-claude-team-redis}`

| 키 | 용도 | TTL |
|---|---|---|
| `agent:{이름}:status` | working / idle / blocked / rate_limited | 없음 |
| `agent:{이름}:heartbeat` | 생존 확인용 타임스탬프, 15초마다 갱신 | 120s |
| `agent:{이름}:context_pct` | 컨텍스트 사용률 0~100 | 없음 |
| `agent:{이름}:task` | 현재 작업 한 줄 설명 | 없음 |
| `lock:file:{경로}` | 파일 점유 (NX로 원자적 획득) | 3600s |
| `team:phase:{n}:status` | planned/in_progress/review/done | 없음 |
| `queue:review` | 리뷰 대기 목록 (LPUSH/RPOP) | 없음 |
| `channel:team:events` | 팀 전체 이벤트 Pub/Sub | - |
| `stream:team:events` | Phase 완료 등 소실 불가 이벤트 (XADD/XREAD) | - |

- 모든 에이전트는 작업 시작 시 `agent:{이름}:status`를 `working`으로, 완료 시 `idle`로 갱신한다
- 15초마다 `SET agent:{이름}:heartbeat $(date +%s) EX 120`로 하트비트 갱신
- 파일 수정 전 `SET lock:file:{경로} {이름} EX 3600 NX`로 락 획득, 실패하면 다른 에이전트 작업 중이므로 대기
- 소실되면 다음 단계가 멈추는 이벤트(Phase 완료 등)는 Streams(`XADD`) 사용, 실시간 알림은 Pub/Sub(`PUBLISH`) 사용
