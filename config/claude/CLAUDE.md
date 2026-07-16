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

- `filesystem` MCP가 `/workspace` 디렉터리에 연결되어 있습니다 (`.mcp.json` 참고).
- GitHub MCP는 아직 미설정입니다. 실제 사용 전 아래 명령을 (실제 PAT로) 한 번 실행해야 합니다:
  ```bash
  claude mcp add --transport http github https://api.githubcopilot.com/mcp/ \
    --header "Authorization: Bearer YOUR_GITHUB_PAT"
  ```
