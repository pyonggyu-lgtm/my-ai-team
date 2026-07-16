#!/usr/bin/env bash
# heartbeat-check.sh — 쭌 5분 체크루프에서 호출
# 사용: REDIS_HOST=claude-team-redis bash scripts/heartbeat-check.sh

REDIS_HOST="${REDIS_HOST:-claude-team-redis}"
AGENTS=(쭌 민준 지훈 수아 서연 태양)

for AGENT in "${AGENTS[@]}"; do
  TTL=$(redis-cli -h "$REDIS_HOST" TTL "agent:${AGENT}:heartbeat")
  STATUS=$(redis-cli -h "$REDIS_HOST" GET "agent:${AGENT}:status")

  if [[ "$TTL" == "-2" ]]; then
    echo "[!!] ${AGENT}: 하트비트 키 없음 — 미초기화 또는 장기 다운"
  elif [[ "$TTL" -lt 30 ]]; then
    echo "[??] ${AGENT}: 하트비트 곧 만료 (남은 TTL: ${TTL}s) — hang 의심"
  else
    echo "[OK] ${AGENT}: 정상 (상태=${STATUS}, TTL=${TTL}s)"
  fi
done
