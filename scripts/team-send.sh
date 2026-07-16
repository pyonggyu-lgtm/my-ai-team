# team-send.sh — source this file to get the team-send helper
# Usage: source scripts/team-send.sh
#        team-send 4 "로그인 버그 수정해줘"   # 진오(Pane 4)에게 전달

team-send() {
  local pane=$1
  shift
  tmux send-keys -t team1:0.$pane "$*" Enter
}
