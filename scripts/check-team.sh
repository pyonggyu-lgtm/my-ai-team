#!/bin/bash
# check-team.sh — 팀 세션 상태 점검 및 복구
# 사용: bash scripts/check-team.sh (프로젝트 루트에서 실행)

SESSION="team1"
EXPECTED_PANES=6
TITLES=("진서" "진록 아키텍트" "진삼 리서쳐" "진사 UI/UX디자이너" "진오 개발자" "진육 QA·리뷰어")

# 1. 세션 존재 확인
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "세션이 없습니다. 재구성합니다..."
  bash "$(dirname "$0")/../setup-team.sh"
  exit 0
fi

# 2. 파인 수 확인
CURRENT_PANES=$(tmux list-panes -t "$SESSION:0" | wc -l)
if [ "$CURRENT_PANES" -ne "$EXPECTED_PANES" ]; then
  echo "파인 수 불일치: $CURRENT_PANES / $EXPECTED_PANES"
  echo "전체 재구성을 권장합니다: bash setup-team.sh"
  exit 1
fi

# 3. 각 파인에서 Claude 실행 상태 확인
for i in 0 1 2 3 4 5; do
  PANE_CMD=$(tmux list-panes -t "$SESSION:0" -F "#{pane_index} #{pane_current_command}" \
    | grep "^$i " | awk '{print $2}')

  if [ "$PANE_CMD" != "claude" ] && [ "$PANE_CMD" != "node" ]; then
    echo "Pane $i (${TITLES[$i]}): Claude 미실행 — 재시작합니다"
    tmux send-keys -t "$SESSION:0.$i" "claude" Enter
  else
    echo "Pane $i (${TITLES[$i]}): 정상"
  fi
done

echo "점검 완료"
