#!/bin/bash
SESSION="team"

# 특정 pane에 패턴이 나타날 때까지 대기
# $1: pane 주소 (예: team:0.1)
# $2: 대기할 텍스트 패턴
# $3: 최대 대기 시간(초, 기본 30)
wait_for_pane() {
  local pane="$1"
  local pattern="$2"
  local timeout="${3:-30}"
  local waited=0

  while [ $waited -lt $timeout ]; do
    if tmux capture-pane -t "$pane" -p 2>/dev/null | grep -q "$pattern"; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1 # 타임아웃
}

# $1: 파인 주소 (예: team:0.2)
# $2: 모델 (기본값: claude-sonnet-4-6)
start_claude_in_pane() {
  local pane="$1"
  local model="${2:-claude-sonnet-4-6}"
  local claude_bin
  claude_bin="$(command -v claude)"

  # 이전 입력 초기화
  tmux send-keys -t "$pane" C-c 2>/dev/null
  sleep 0.3
  tmux send-keys -t "$pane" C-u 2>/dev/null
  sleep 0.2

  # Claude 실행
  tmux send-keys -t "$pane" \
    "cd /home/user && unset CLAUDECODE && $claude_bin --model $model --dangerously-skip-permissions" \
    Enter

  # 다이얼로그 1: "trust this folder" → Enter
  if wait_for_pane "$pane" "trust this folder" 20; then
    tmux send-keys -t "$pane" Enter
    sleep 1
  fi

  # 다이얼로그 2: "I accept" → Down + Enter
  if wait_for_pane "$pane" "I accept" 20; then
    tmux send-keys -t "$pane" Down
    sleep 0.5
    tmux send-keys -t "$pane" Enter
    sleep 1
  fi

  # Claude 프롬프트(>) 나타날 때까지 대기
  wait_for_pane "$pane" ">" 30
}

# 파인별 이름과 모델 배열
MEMBER_NAMES=("쭌" "민준" "지훈" "수아" "서연" "태양")
MEMBER_MODELS=(
  "claude-sonnet-4-6" # 0: 쭌
  "claude-opus-4-8"   # 1: 민준 (복잡한 설계 → Opus)
  "claude-sonnet-4-6" # 2: 지훈
  "claude-sonnet-4-6" # 3: 수아
  "claude-sonnet-4-6" # 4: 서연
  "claude-sonnet-4-6" # 5: 태양
)

for pane in 0 1 2 3 4 5; do
  model="${MEMBER_MODELS[$pane]}"
  echo -n "  Pane $pane (${MEMBER_NAMES[$pane]}): 시작 중..."

  start_claude_in_pane "$SESSION:0.$pane" "$model"

  # 성공 여부 확인
  if tmux capture-pane -t "$SESSION:0.$pane" -p 2>/dev/null | grep -q ">"; then
    echo " ✅ 준비 완료"
  else
    echo " ⚠️ 타임아웃 — 수동 확인 필요"
  fi
done
