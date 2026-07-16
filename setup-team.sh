#!/bin/bash
# setup-team.sh — 컨테이너 내부 Claude 멀티에이전트 팀 환경 자동 구성

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SESSION="team1"

# ── 유틸: 파인에 패턴이 나타날 때까지 대기 ──────────────────
wait_for_pane() {
  local pane="$1" pattern="$2" timeout="${3:-30}" waited=0
  while [ $waited -lt $timeout ]; do
    tmux capture-pane -t "$pane" -p 2>/dev/null | grep -q "$pattern" && return 0
    sleep 1; waited=$((waited + 1))
  done
  return 1
}

# ── 유틸: Claude 실행 + 다이얼로그 자동 처리 ────────────────
start_claude_in_pane() {
  local pane="$1" model="${2:-claude-sonnet-4-6}"
  local claude_bin; claude_bin="$(command -v claude)"

  tmux send-keys -t "$pane" C-c 2>/dev/null; sleep 0.3
  tmux send-keys -t "$pane" C-u 2>/dev/null; sleep 0.2

  tmux send-keys -t "$pane" \
    "cd /workspace && unset CLAUDECODE && $claude_bin --model $model --dangerously-skip-permissions" Enter

  # 다이얼로그 1: trust folder → Enter
  wait_for_pane "$pane" "trust this folder" 20 && {
    tmux send-keys -t "$pane" Enter; sleep 1
  }

  # 다이얼로그 2: terms of service → Down + Enter
  wait_for_pane "$pane" "I accept" 20 && {
    tmux send-keys -t "$pane" Down; sleep 0.5
    tmux send-keys -t "$pane" Enter; sleep 1
  }

  wait_for_pane "$pane" ">" 30
}

# ── [0/4] 사전 요구사항 확인 ────────────────────────────────
echo -e "${YELLOW}[0/4] 사전 요구사항 확인...${NC}"

MISSING=()
command -v tmux &>/dev/null || MISSING+=("tmux (apt-get install -y tmux)")
command -v claude &>/dev/null || MISSING+=("claude (npm install -g @anthropic-ai/claude-code)")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${RED}❌ 누락된 의존성:${NC}"
  for m in "${MISSING[@]}"; do echo "  - $m"; done
  exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${RED}❌ ANTHROPIC_API_KEY 환경변수가 없습니다.${NC}"
  echo "   docker run 시 -e ANTHROPIC_API_KEY=... 옵션을 확인하세요."
  exit 1
fi

echo "  ✅ tmux $(tmux -V | awk '{print $2}')"
echo "  ✅ claude $(claude --version 2>/dev/null | head -1)"
echo "  ✅ API 키 주입 확인"

# ── [1/4] 기존 세션 정리 ────────────────────────────────────
echo -e "\n${YELLOW}[1/4] 기존 세션 초기화...${NC}"
tmux has-session -t "$SESSION" 2>/dev/null && {
  tmux kill-session -t "$SESSION"
  echo "  기존 '$SESSION' 세션 종료"
}

# ── [2/4] TMUX 세션 & 레이아웃 구성 ────────────────────────
echo -e "\n${YELLOW}[2/4] TMUX 세션 & 레이아웃 구성...${NC}"

tmux new-session -d -s "$SESSION" -x 220 -y 50

# 파인 5개 분할
tmux split-window -t "$SESSION:0.0" -h
tmux split-window -t "$SESSION:0.1" -h
tmux split-window -t "$SESSION:0.2" -h
tmux split-window -t "$SESSION:0.3" -h
tmux split-window -t "$SESSION:0.4" -h

# main-vertical 레이아웃 (팀장 왼쪽 넓게)
tmux select-layout -t "$SESSION:0" even-horizontal
tmux select-layout -t "$SESSION:0" main-vertical
tmux set-option -t "$SESSION" main-pane-width 110

# 파인 제목 표시 설정
tmux set-option -t "$SESSION" pane-border-status top
tmux set-option -t "$SESSION" pane-border-format " #{pane_title} "
tmux set-option -t "$SESSION" allow-rename off

# 파인 이름 설정
tmux select-pane -t "$SESSION:0.0" -T "쭌"
tmux select-pane -t "$SESSION:0.1" -T "민준 아키텍트"
tmux select-pane -t "$SESSION:0.2" -T "지훈 리서쳐"
tmux select-pane -t "$SESSION:0.3" -T "수아 UI/UX디자이너"
tmux select-pane -t "$SESSION:0.4" -T "서연 개발자"
tmux select-pane -t "$SESSION:0.5" -T "태양 QA·리뷰어"

echo "  ✅ 레이아웃 구성 완료 (6 panes)"

# ── [3/4] Claude 자동 실행 ──────────────────────────────────
echo -e "\n${YELLOW}[3/4] Claude 실행 중... (파인당 최대 1분)${NC}"

MEMBER_NAMES=("쭌" "민준" "지훈" "수아" "서연" "태양")
MEMBER_MODELS=(
  "claude-opus-4-8"   # 쭌 (팀장 — 판단·조율 중심)
  "claude-opus-4-8"   # 민준 (PM — 설계·추론 중심)
  "claude-sonnet-4-6" # 지훈
  "claude-sonnet-4-6" # 수아
  "claude-sonnet-4-6" # 서연
  "claude-sonnet-4-6" # 태양
)

for pane in 0 1 2 3 4 5; do
  echo -n "  Pane $pane (${MEMBER_NAMES[$pane]}): "

  if [ "$pane" -eq 0 ]; then
    # 팀장(쭌)만 서버 모드로 실행 — 모바일 등 외부에서 직접 접속 가능 (04-3장)
    tmux send-keys -t "$SESSION:0.0" \
      "cd /workspace && unset CLAUDECODE && claude remote-control --name '팀장-쭌' --spawn session --verbose" Enter
    wait_for_pane "$SESSION:0.0" "trust this folder" 20 && {
      tmux send-keys -t "$SESSION:0.0" Enter; sleep 1
    }
    wait_for_pane "$SESSION:0.0" "I accept" 20 && {
      tmux send-keys -t "$SESSION:0.0" Down; sleep 0.5
      tmux send-keys -t "$SESSION:0.0" Enter; sleep 1
    }
  else
    start_claude_in_pane "$SESSION:0.$pane" "${MEMBER_MODELS[$pane]}"
  fi

  tmux capture-pane -t "$SESSION:0.$pane" -p 2>/dev/null | grep -q ">" \
    && echo -e "${GREEN}✅ 준비 완료${NC}" \
    || echo -e "${RED}⚠️ 타임아웃 — 수동 확인 필요${NC}"
done

# ── [4/4] 완료 ──────────────────────────────────────────────
echo -e "\n${GREEN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║        ✅ 팀 환경 구성 완료!           ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# 터미널에서 직접 실행한 경우 자동 attach
[ -t 1 ] && tmux attach -t "$SESSION"
