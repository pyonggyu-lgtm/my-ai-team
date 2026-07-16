#!/bin/bash
# reboot-pane.sh — 지정한 파인의 Claude Code를 올바른 모델로 재기동
# 사용: bash scripts/reboot-pane.sh {파인번호 0~5}

SESSION="team1"
PANE_IDX="$1"

if [[ -z "$PANE_IDX" ]]; then
  echo "사용법: bash reboot-pane.sh {0~5}" >&2
  exit 1
fi

MODELS=("claude-opus-4-8" "claude-opus-4-8" "claude-sonnet-4-6" "claude-sonnet-4-6" "claude-sonnet-4-6" "claude-sonnet-4-6")
MODEL="${MODELS[$PANE_IDX]}"

wait_for_pane() {
  local pane="$1" pattern="$2" timeout="${3:-30}" waited=0
  while [ $waited -lt $timeout ]; do
    tmux capture-pane -t "$pane" -p 2>/dev/null | grep -q "$pattern" && return 0
    sleep 1; waited=$((waited + 1))
  done
  return 1
}

PANE="${SESSION}:0.${PANE_IDX}"
tmux send-keys -t "$PANE" C-c 2>/dev/null; sleep 0.3
tmux send-keys -t "$PANE" C-u 2>/dev/null; sleep 0.2

if [[ "$PANE_IDX" -eq 0 ]]; then
  tmux send-keys -t "$PANE" \
    "cd /workspace && unset CLAUDECODE && claude remote-control --name '팀장-쭌' --spawn session --permission-mode default --verbose" Enter
else
  claude_bin="$(command -v claude)"
  tmux send-keys -t "$PANE" \
    "cd /workspace && unset CLAUDECODE && $claude_bin --model $MODEL --dangerously-skip-permissions" Enter
fi

wait_for_pane "$PANE" "trust this folder" 20 && {
  tmux send-keys -t "$PANE" Enter; sleep 1
}
wait_for_pane "$PANE" "I accept" 20 && {
  tmux send-keys -t "$PANE" Down; sleep 0.5
  tmux send-keys -t "$PANE" Enter; sleep 1
}
wait_for_pane "$PANE" ">" 30
