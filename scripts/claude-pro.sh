#!/bin/bash
# claude-pro.sh — 공장 팀원을 Claude Pro 구독으로 실행하는 포장 스크립트 (2026-11-02)
# 토큰 값은 여기 없음. /home/claude/.secrets/pro-token.secret 에서 읽기만 한다.
# 인증 우선순위상 ANTHROPIC_API_KEY가 구독 토큰보다 앞서므로, 이 프로세스에서만 API 키를 지운다.
TOKEN_FILE="/home/claude/.secrets/pro-token.secret"
if [ -s "$TOKEN_FILE" ]; then
  CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
  export CLAUDE_CODE_OAUTH_TOKEN
  unset ANTHROPIC_API_KEY
else
  echo "⚠️  Pro 토큰 파일이 없습니다 → API 키로 실행합니다. (등록: bash scripts/pro-token-setup.sh)" >&2
fi
exec claude "$@"
