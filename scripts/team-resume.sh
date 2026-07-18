#!/usr/bin/env bash
# team-resume.sh — 팀 환경을 재개하는 단일 진입점 (호스트에서 실행)
#
# 상황별로 필요한 만큼만 처리한다:
#   컨테이너 자체가 없음      → docker-team.sh로 처음부터 생성
#   컨테이너가 꺼져 있음      → docker start로 켜기(빌드/온보딩 재사용, 데이터 보존)
#   컨테이너는 떠 있음        → 그대로 다음 단계로
#   tmux 세션/파인 문제       → team-recover.sh가 내부에서 자동 진단·재기동
#
# 사용법: bash scripts/team-resume.sh  (프로젝트 루트에서)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONTAINER="claude-env"
REDIS_CONTAINER="claude-team-redis"
SESSION="team1"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok() { echo -e "${GREEN}[OK]${NC} $*"; }
info() { echo -e "${YELLOW}[..]${NC} $*"; }
fail() { echo -e "${RED}[!!]${NC} $*"; }

echo "▶ 1단계: 컨테이너 존재 여부 확인 중..."
if ! docker container inspect "$CONTAINER" &>/dev/null; then
  info "컨테이너가 없습니다 — docker-team.sh로 처음부터 생성합니다."
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    fail "ANTHROPIC_API_KEY 환경변수가 없습니다. export ANTHROPIC_API_KEY=... 먼저 실행하세요."
    exit 1
  fi
  ( cd "$PROJECT_ROOT" && bash docker-team.sh )
  ok "컨테이너 생성 및 팀 기동 완료"
  echo "  접속: docker exec -it $CONTAINER tmux attach -t $SESSION"
  exit 0
fi
ok "컨테이너 존재 확인"

echo "▶ 2단계: 컨테이너 실행 상태 확인 중..."
STATUS=$(docker container inspect -f '{{.State.Status}}' "$CONTAINER")
if [ "$STATUS" != "running" ]; then
  info "컨테이너가 꺼져 있습니다 — 켭니다 (온보딩·설정은 그대로 보존됨)..."
  docker start "$REDIS_CONTAINER" &>/dev/null || true
  docker start "$CONTAINER" &>/dev/null
  sleep 2
  ok "컨테이너 기동 완료"
else
  ok "컨테이너 이미 실행 중"
fi

echo "▶ 3단계: 팀 세션(tmux) 상태 점검 및 자동 복구 중..."
docker exec "$CONTAINER" bash -c "cd /workspace && bash scripts/team-recover.sh"

echo ""
ok "═══ 팀 재개 완료 ═══"
echo "  접속: docker exec -it $CONTAINER tmux attach -t $SESSION"
