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
    tmux capture-pane -t "$pane" -p 2>/dev/null | grep -qE "$pattern" && return 0
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
  # 컨테이너 전체에 ANTHROPIC_API_KEY가 걸려 있으면 OAuth 로그인이 돼 있어도
  # Remote-Control이 "API 키가 설정되어 있음" 에러를 낸다. env -u로 claude 프로세스에만
  # 안 보이게 해서 unset하고(파인의 셸 자체에는 남겨둬야 아래 폴백이 API 키를 쓸 수 있다).
  tmux send-keys -t "$PANE" \
    "cd /workspace && unset CLAUDECODE && HOME=$AGENT_HOME env -u ANTHROPIC_API_KEY claude remote-control --name '팀장-진서' --spawn session --permission-mode default --verbose" Enter
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

# 여러 파인을 연달아 재기동할 때(team-recover.sh) 이전 send-keys의 일부(재시작
# 명령어 등)가 클로드 입력창에 텍스트로 남아있는 채 발견되는 경우가 실전에서
# 재현됐다(Ctrl+U 두 번으로 지워지는 것까지 확인). 최종 판정 전에 방어적으로
# 입력창을 비운다 — 이미 비어 있으면 아무 영향 없다.
tmux send-keys -t "$PANE" C-u 2>/dev/null; sleep 0.2
tmux send-keys -t "$PANE" C-u 2>/dev/null; sleep 0.2

# 실제 프롬프트 기호는 "❯"(유니코드)라 ">"와 매치되지 않아 항상 타임아웃하던 버그.
# team-recover.sh가 이 exit code로 성공/실패를 판정하므로, 정확한 문구로 교체.
# 입력창 힌트 'Try "..."'로 판정 — 파인이 작아 릴리스 노트 팝업 등이 뜨면 그 아래
# 상태줄("for shortcuts")은 화면 밖으로 밀려날 수 있지만 입력창 자체는 항상 보인다.
# 단, 진서(pane 0)가 Remote Control 모드로 뜬 경우 'Try "...'는 절대 나오지 않고
# "Code anywhere with the Claude mobile app" 문구로 준비 완료를 알린다.
READY_PATTERN='Try "'
[[ "$PANE_IDX" -eq 0 ]] && READY_PATTERN='Try "|Code anywhere with the Claude mobile app'
wait_for_pane "$PANE" "$READY_PATTERN" 30
