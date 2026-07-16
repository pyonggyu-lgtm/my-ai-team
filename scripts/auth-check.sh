#!/bin/bash
# auth-check.sh — Claude Code 인증 상태 빠른 점검

echo "=== 1. 프로세스 확인 ==="
pgrep -af claude || echo "[없음] Claude Code가 실행 중이 아닙니다"

echo ""
echo "=== 2. 인증 상태 ==="
claude auth status 2>/dev/null || echo "[오류] auth status 실행 실패"

echo ""
echo "=== 3. 네트워크 (api.anthropic.com) ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/messages)
echo "HTTP 응답 코드: $CODE"
case "$CODE" in
  200|401) echo "[정상] 네트워크 연결 OK (401=인증만 실패)" ;;
  000) echo "[오류] 서버에 도달 불가 — 방화벽 또는 DNS 확인 필요" ;;
  *) echo "[경고] 예상치 못한 코드: $CODE" ;;
esac

echo ""
echo "=== 4. 설정 파일 유효성 ==="
python3 -c "import json; json.load(open('$HOME/.claude/settings.json'))" \
  && echo "[정상] JSON 유효" \
  || echo "[오류] JSON 구문 오류 — settings.json 점검 필요"
