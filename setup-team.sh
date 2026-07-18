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

# ── 유틸: 파인별 HOME에 역할 전용 CLAUDE.md 구성 (공통 + roles/{name}.md) ──
setup_agent_home() {
  local name="$1"
  local home="/home/claude/agents/$name"
  mkdir -p "$home/.claude"
  cat /workspace/config/claude/CLAUDE.md /workspace/config/claude/roles/"$name".md \
    > "$home/.claude/CLAUDE.md"
}

# ── 유틸: Claude 실행 + 다이얼로그 자동 처리 ────────────────
# $3: 에이전트 HOME 디렉터리 (파인별로 다른 역할을 로드하기 위함)
start_claude_in_pane() {
  local pane="$1" model="${2:-claude-sonnet-4-6}" agent_home="$3"
  local claude_bin; claude_bin="$(command -v claude)"

  tmux send-keys -t "$pane" C-c 2>/dev/null; sleep 0.3
  tmux send-keys -t "$pane" C-u 2>/dev/null; sleep 0.2

  tmux send-keys -t "$pane" \
    "cd /workspace && unset CLAUDECODE && HOME=$agent_home $claude_bin --model $model --dangerously-skip-permissions" Enter

  # 다이얼로그 0: 테마 선택 화면 (최초 실행 시) → Enter (기본 테마)
  wait_for_pane "$pane" "Syntax theme" 15 && {
    tmux send-keys -t "$pane" Enter; sleep 1
  }

  # 다이얼로그 0.5: API 키 사용 확인 (기본값 No) → Up + Enter
  wait_for_pane "$pane" "Do you want to use this API key" 15 && {
    tmux send-keys -t "$pane" Up; sleep 0.3
    tmux send-keys -t "$pane" Enter; sleep 1
  }

  # 다이얼로그 0.7: 보안 안내 화면 → Enter
  wait_for_pane "$pane" "Press Enter to continue" 15 && {
    tmux send-keys -t "$pane" Enter; sleep 1
  }

  # 다이얼로그 1: trust folder → Enter
  wait_for_pane "$pane" "trust this folder" 20 && {
    tmux send-keys -t "$pane" Enter; sleep 1
  }

  # 다이얼로그 2: Bypass Permissions 동의 (기본값 No, exit) → Down + Enter
  wait_for_pane "$pane" "I accept" 20 && {
    tmux send-keys -t "$pane" Down; sleep 0.5
    tmux send-keys -t "$pane" Enter; sleep 1
  }

  # 실제 프롬프트 기호는 "❯"(유니코드)라 ">"와 매치되지 않아 항상 타임아웃하던 버그.
  # 입력창 힌트 문구 'Try "..."'로 판정 — 파인이 9줄 안팎으로 작아 릴리스 노트 팝업 등이
  # 뜨면 그 아래 상태줄("for shortcuts")은 화면 밖으로 밀려날 수 있지만 입력창 자체는
  # 항상 보인다. 그래도 실패 시 || true로 흡수해 set -e가 이 파인 하나 때문에
  # 스크립트 전체(나머지 파인들)를 죽이지 않게 한다.
  wait_for_pane "$pane" 'Try "' 30 || true
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
tmux select-pane -t "$SESSION:0.0" -T "진서"
tmux select-pane -t "$SESSION:0.1" -T "진록 아키텍트"
tmux select-pane -t "$SESSION:0.2" -T "진삼 리서쳐"
tmux select-pane -t "$SESSION:0.3" -T "진사 UI/UX디자이너"
tmux select-pane -t "$SESSION:0.4" -T "진오 개발자"
tmux select-pane -t "$SESSION:0.5" -T "진육 QA·리뷰어"

echo "  ✅ 레이아웃 구성 완료 (6 panes)"

# ── [3/4] Claude 자동 실행 ──────────────────────────────────
echo -e "\n${YELLOW}[3/4] Claude 실행 중... (파인당 최대 1분)${NC}"

MEMBER_NAMES=("진서" "진록" "진삼" "진사" "진오" "진육")
MEMBER_HOMES=("jun" "minjun" "jihun" "sua" "seoyeon" "taeyang") # config/claude/roles/*.md 파일명과 일치
MEMBER_MODELS=(
  "claude-opus-4-8"   # 진서 (팀장 — 판단·조율 중심)
  "claude-opus-4-8"   # 진록 (PM — 설계·추론 중심)
  "claude-sonnet-4-6" # 진삼
  "claude-sonnet-4-6" # 진사
  "claude-sonnet-4-6" # 진오
  "claude-sonnet-4-6" # 진육
)

echo "  파인별 역할 CLAUDE.md 구성 중..."
for name in "${MEMBER_HOMES[@]}"; do
  setup_agent_home "$name"
done
echo "  ✅ 6개 역할 HOME 구성 완료"
echo ""

for pane in 0 1 2 3 4 5; do
  echo -n "  Pane $pane (${MEMBER_NAMES[$pane]}): "
  AGENT_HOME="/home/claude/agents/${MEMBER_HOMES[$pane]}"

  if [ "$pane" -eq 0 ]; then
    # 팀장(진서)만 서버 모드로 실행 — 모바일 등 외부에서 직접 접속 가능 (04-3장)
    # 주의: Remote-Control은 OAuth 로그인이 필요해 API 키만으로는 동작하지 않는다 (04-1장).
    # OAuth 미설정 환경이면 이 명령은 실패하며, 아래에서 일반 모드로 대체 실행해야 한다.
    tmux send-keys -t "$SESSION:0.0" \
      "cd /workspace && unset CLAUDECODE && HOME=$AGENT_HOME claude remote-control --name '팀장-진서' --spawn session --permission-mode default --verbose" Enter
    wait_for_pane "$SESSION:0.0" "Syntax theme" 15 && {
      tmux send-keys -t "$SESSION:0.0" Enter; sleep 1
    }
    wait_for_pane "$SESSION:0.0" "Do you want to use this API key" 15 && {
      tmux send-keys -t "$SESSION:0.0" Up; sleep 0.3
      tmux send-keys -t "$SESSION:0.0" Enter; sleep 1
    }
    wait_for_pane "$SESSION:0.0" "Press Enter to continue" 15 && {
      tmux send-keys -t "$SESSION:0.0" Enter; sleep 1
    }
    wait_for_pane "$SESSION:0.0" "trust this folder" 20 && {
      tmux send-keys -t "$SESSION:0.0" Enter; sleep 1
    }
    wait_for_pane "$SESSION:0.0" "I accept" 20 && {
      tmux send-keys -t "$SESSION:0.0" Down; sleep 0.5
      tmux send-keys -t "$SESSION:0.0" Enter; sleep 1
    }
    # Remote-Control은 OAuth 없이 "Error: You must be logged in" 으로 즉시 실패한다.
    # 그 경우 일반 모드(--dangerously-skip-permissions)로 대체 실행한다.
    wait_for_pane "$SESSION:0.0" "must be logged in" 5 && {
      start_claude_in_pane "$SESSION:0.0" "${MEMBER_MODELS[0]}" "$AGENT_HOME"
    } || true
  else
    start_claude_in_pane "$SESSION:0.$pane" "${MEMBER_MODELS[$pane]}" "$AGENT_HOME" || true
  fi

  tmux capture-pane -t "$SESSION:0.$pane" -p 2>/dev/null | grep -q 'Try "' \
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
