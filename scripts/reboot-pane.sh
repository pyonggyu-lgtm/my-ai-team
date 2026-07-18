#!/bin/bash
# reboot-pane.sh — 지정한 파인의 Claude Code를 올바른 모델·역할로 재기동
# 사용: bash scripts/reboot-pane.sh {파인번호 0~5}

SESSION="team1"
PANE_IDX="$1"

if [[ -z "$PANE_IDX" ]]; then
  echo "사용법: bash reboot-pane.sh {0~5}" >&2
  exit 1
fi

MODELS=("claude-opus-4-8" "claude-opus-4-8" "claude-sonnet-4-6" "claude-sonnet-4-6" "claude-sonnet-4-6" "claude-sonnet-4-6")
HOMES=("jun" "minjun" "jihun" "sua" "seoyeon" "taeyang") # config/claude/roles/*.md 파일명과 일치
MODEL="${MODELS[$PANE_IDX]}"
AGENT_HOME="/home/claude/agents/${HOMES[$PANE_IDX]}"

wait_for_pane() {
  local pane="$1" pattern="$2" timeout="${3:-30}" waited=0
  while [ $waited -lt $timeout ]; do
    tmux capture-pane -t "$pane" -p 2>/dev/null | grep -q "$pattern" && return 0
    sleep 1; waited=$((waited + 1))
  done
  return 1
}

# 역할 전용 CLAUDE.md 재구성 (공통 + roles/{name}.md) — 최신 내용으로 항상 갱신
mkdir -p "$AGENT_HOME/.claude"
cat /workspace/config/claude/CLAUDE.md "/workspace/config/claude/roles/${HOMES[$PANE_IDX]}.md" \
  > "$AGENT_HOME/.claude/CLAUDE.md"

PANE="${SESSION}:0.${PANE_IDX}"
# Ctrl+C는 Claude Code가 대기(idle) 상태일 때는 무시된다(생성 중일 때만 취소 동작) —
# 그러면 앱이 안 꺼진 채로 다음 재시작 명령어가 셸이 아니라 기존 Claude 채팅창에
# 그대로 텍스트로 입력돼버린다(실전에서 재현됨). /exit로 확실히 종료시킨다.
# 이미 bash 상태인 파인에 보내도 "No such file or directory"만 뜨고 무해하다.
tmux send-keys -t "$PANE" Escape 2>/dev/null; sleep 0.2
tmux send-keys -t "$PANE" C-c 2>/dev/null; sleep 0.3
tmux send-keys -t "$PANE" C-u 2>/dev/null; sleep 0.2
tmux send-keys -t "$PANE" '/exit' Enter; sleep 1

if [[ "$PANE_IDX" -eq 0 ]]; then
  tmux send-keys -t "$PANE" \
    "cd /workspace && unset CLAUDECODE && HOME=$AGENT_HOME claude remote-control --name '팀장-진서' --spawn session --permission-mode default --verbose" Enter
else
  claude_bin="$(command -v claude)"
  tmux send-keys -t "$PANE" \
    "cd /workspace && unset CLAUDECODE && HOME=$AGENT_HOME $claude_bin --model $MODEL --dangerously-skip-permissions" Enter
fi

# 다이얼로그 0: 테마 선택 화면 (최초 실행 시) → Enter
wait_for_pane "$PANE" "Syntax theme" 15 && {
  tmux send-keys -t "$PANE" Enter; sleep 1
}
# 다이얼로그 0.5: API 키 사용 확인 (기본값 No) → Up + Enter
wait_for_pane "$PANE" "Do you want to use this API key" 15 && {
  tmux send-keys -t "$PANE" Up; sleep 0.3
  tmux send-keys -t "$PANE" Enter; sleep 1
}
# 다이얼로그 0.7: 보안 안내 화면 → Enter
wait_for_pane "$PANE" "Press Enter to continue" 15 && {
  tmux send-keys -t "$PANE" Enter; sleep 1
}
# 다이얼로그 1: trust folder → Enter
wait_for_pane "$PANE" "trust this folder" 20 && {
  tmux send-keys -t "$PANE" Enter; sleep 1
}
# 다이얼로그 2: Bypass Permissions 동의 (기본값 No, exit) → Down + Enter
wait_for_pane "$PANE" "I accept" 20 && {
  tmux send-keys -t "$PANE" Down; sleep 0.5
  tmux send-keys -t "$PANE" Enter; sleep 1
}

if [[ "$PANE_IDX" -eq 0 ]]; then
  # Remote-Control은 OAuth 없이 즉시 실패한다 — 그 경우 일반 모드로 대체 실행
  wait_for_pane "$PANE" "must be logged in" 5 && {
    claude_bin="$(command -v claude)"
    tmux send-keys -t "$PANE" C-c 2>/dev/null; sleep 0.3
    tmux send-keys -t "$PANE" \
      "cd /workspace && unset CLAUDECODE && HOME=$AGENT_HOME $claude_bin --model $MODEL --dangerously-skip-permissions" Enter
    wait_for_pane "$PANE" "trust this folder" 20 && {
      tmux send-keys -t "$PANE" Enter; sleep 1
    }
    wait_for_pane "$PANE" "I accept" 20 && {
      tmux send-keys -t "$PANE" Down; sleep 0.5
      tmux send-keys -t "$PANE" Enter; sleep 1
    }
  }
fi

# 실제 프롬프트 기호는 "❯"(유니코드)라 ">"와 매치되지 않아 항상 타임아웃하던 버그.
# team-recover.sh가 이 exit code로 성공/실패를 판정하므로, 정확한 문구로 교체.
# 입력창 힌트 'Try "..."'로 판정 — 파인이 작아 릴리스 노트 팝업 등이 뜨면 그 아래
# 상태줄("for shortcuts")은 화면 밖으로 밀려날 수 있지만 입력창 자체는 항상 보인다.
wait_for_pane "$PANE" 'Try "' 30
