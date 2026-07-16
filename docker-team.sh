#!/bin/bash
# docker-team.sh — Docker 기반 팀 환경 구성 (호스트 실행)

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

IMAGE="claude-team"
CONTAINER="claude-env"
REDIS_CONTAINER="claude-team-redis"
PROJECT_DIR="${PROJECT_DIR:-$HOME/project}"

# ── API 키 확인 ──────────────────────────────────────────────
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${RED}❌ ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.${NC}"
  echo "   export ANTHROPIC_API_KEY='sk-ant-...'"
  exit 1
fi

echo -e "${GREEN}✅ API 키 확인 완료${NC}"

# ── 이미지 존재 확인 ─────────────────────────────────────────
if ! docker image inspect "$IMAGE" &>/dev/null; then
  echo -e "${YELLOW}이미지가 없습니다. 빌드를 시작합니다...${NC}"
  docker build -t "$IMAGE" .
fi

echo -e "${GREEN}✅ 이미지 준비 완료 ($IMAGE)${NC}"

# ── 기존 컨테이너 정리 ───────────────────────────────────────
if docker container inspect "$CONTAINER" &>/dev/null; then
  echo "기존 컨테이너 '$CONTAINER' 종료 및 삭제..."
  docker rm -f "$CONTAINER"
fi

# ── 네트워크 준비 (컨테이너 간 이름으로 통신) ─────────────────
docker network inspect claude-team-net &>/dev/null || docker network create claude-team-net

# ── Redis 컨테이너 기동 (6인 팀 상태 공유용, 08-5) ────────────
if ! docker container inspect "$REDIS_CONTAINER" &>/dev/null; then
  echo -e "\n${YELLOW}Redis 컨테이너 기동 중...${NC}"
  docker run -d --name "$REDIS_CONTAINER" \
    --network claude-team-net \
    redis:7
fi
echo -e "${GREEN}✅ Redis 준비 완료 ($REDIS_CONTAINER, 호스트명: $REDIS_CONTAINER)${NC}"

# ── 컨테이너 기동 ────────────────────────────────────────────
echo -e "\n${YELLOW}컨테이너 기동 중...${NC}"
mkdir -p "$PROJECT_DIR"

docker run -d --name "$CONTAINER" \
  --network claude-team-net \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e REDIS_HOST="$REDIS_CONTAINER" \
  -v "$PROJECT_DIR":/workspace \
  "$IMAGE" sleep infinity

echo -e "${GREEN}✅ 컨테이너 기동 완료 ($CONTAINER)${NC}"

# ── 컨테이너 내에서 팀 셋업 스크립트 실행 ────────────────────
echo -e "\n${YELLOW}팀 환경 구성 중 (컨테이너 내부)...${NC}"

# setup-team.sh를 컨테이너로 복사 후 실행
docker cp setup-team.sh "$CONTAINER":/root/setup-team.sh
docker exec -it "$CONTAINER" bash /root/setup-team.sh
