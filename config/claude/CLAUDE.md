# 팀 공통 설정

## 안전 규칙 (모든 규칙보다 우선)

### 사용자 승인이 필요한 두 지점

진서(팀장)의 승인은 사용자 승인을 대신하지 않는다. 아래 두 지점에서는 진서가 사용자에게 요청하고, **사용자가 직접 "승인"이라고 답한 뒤에만** 진행한다.

1. **설계가 끝난 뒤, 구현을 시작하기 전**: 진록의 설계 문서(Phase 0)를 사용자가 읽고 승인해야 진오·진사에게 구현을 지시할 수 있다.
2. **밖으로 나가는 작업 전**: git push, 배포(AWS·Vercel 등), 외부 서비스 가입·연결, 유료 API 사용.

### 금지 사항 (사용자의 명시적 지시가 없으면 하지 않는다)

- 파일·폴더 삭제 (지워야 할 것이 있으면 목록을 진록에게 보고)
- git push와 배포 명령 실행 (사용자가 직접 한다)
- 비밀 파일(.env, *.pem, *.key, credentials) 읽기·출력, API 키·토큰을 파일이나 메시지에 쓰기
- 지시받지 않은 패키지 설치, 외부 서비스 가입
- 팀 설정 파일 수정: `config/claude/`, `.claude/`, `setup-team.sh`, `scripts/reboot-pane.sh`
- 지금 작업 중인 앱이 아닌 다른 앱 폴더의 파일 수정

이 중 일부는 `config/claude/settings.json`의 deny 규칙으로 프로그램이 막는다. 막히면 다른 방법으로 우회하지 말고 진록에게 보고한다.

---

## Bot Mode (안전 규칙 다음으로 우선)

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
- 단, `filesystem` MCP는 비밀 파일 차단을 우회할 수 있어 settings.json에서 막아 두었다. 파일 작업은 기본 Read·Edit 도구를 쓴다.
- `memory`: 진삼(조사 결과 저장) → 진오(구현 시 조회)처럼 에이전트 간 장기 지식 공유에 사용
- `sequential-thinking`: 진록이 복잡한 작업을 서브스텝으로 분해할 때 사용
- `playwright`: 진사가 배포된 화면의 렌더링을 검증할 때 사용 (browser_snapshot)
- `git`: 진오가 커밋, 진육이 diff 리뷰. push는 사용자가 직접 한다 (에이전트는 push 금지)
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

## 충돌 방지 — 앱별 폴더와 역할별 파일 소유권

앱은 하나씩 `apps/{앱이름}/` 폴더 안에서 만든다. 새 앱을 시작하면 진록이 이 폴더를 먼저 만들고, 아래 영역은 모두 **그 앱 폴더 안**을 뜻한다. 한 번에 한 앱만 작업한다.

| 담당 | 영역 (`apps/{앱이름}/` 기준) |
|---|---|
| 진록 | docs/, .planning/ |
| 진삼 | docs/research/ |
| 진사 | src/styles/, assets/, docs/design/ |
| 진오 | src/ (styles/ 제외), tests/ |
| 진육 | 파일 수정 없음, 읽기·리뷰만 |

- 설계 → 구현 → 리뷰 순서를 지켜 단계 간 충돌을 원천 차단한다 (리뷰 중에는 해당 파일을 수정하지 않는다)
- 팀 공통 폴더(저장소 맨 위의 `docs/`, `scripts/`, `config/` 등)는 사용자가 지시할 때만 수정한다
- 충돌 발견 시 스스로 해결하지 않고 진록에게 보고하여 판단을 받는다

---

## Redis 상태공유 (키 스키마)

Redis 접속: `redis-cli -h ${REDIS_HOST:-claude-team-redis}`

| 키 | 용도 | TTL |
|---|---|---|
| `agent:{이름}:status` | working / idle / blocked / rate_limited | 없음 |
| `agent:{이름}:context_pct` | 컨텍스트 사용률 0~100 | 없음 |
| `agent:{이름}:task` | 현재 작업 한 줄 설명 | 없음 |
| `lock:file:{경로}` | 파일 점유 (NX로 원자적 획득) | 3600s |
| `team:phase:{n}:status` | planned/in_progress/review/done | 없음 |
| `queue:review` | 리뷰 대기 목록 (LPUSH/RPOP) | 없음 |
| `channel:team:events` | 팀 전체 이벤트 Pub/Sub | - |
| `stream:team:events` | Phase 완료 등 소실 불가 이벤트 (XADD/XREAD) | - |

- 모든 에이전트는 작업 시작 시 `agent:{이름}:status`를 `working`으로, 완료 시 `idle`로 갱신한다
- 하트비트(주기적 생존 신호)는 쓰지 않는다. AI는 일정 간격으로 스스로 깨어날 수 없어 지켜지지 않고 요금만 낭비된다. 팀원 상태 확인은 `agent:{이름}:status`와 `tmux capture-pane`으로 한다
- 파일 수정 전 `SET lock:file:{경로} {이름} EX 3600 NX`로 락 획득, 실패하면 다른 에이전트 작업 중이므로 대기
- 소실되면 다음 단계가 멈추는 이벤트(Phase 완료 등)는 Streams(`XADD`) 사용, 실시간 알림은 Pub/Sub(`PUBLISH`) 사용
