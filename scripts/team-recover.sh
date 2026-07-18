#!/usr/bin/env bash
# team-recover.sh — 팀 환경 원스톱 자동복구 스크립트
# 사용법: bash scripts/team-recover.sh [--force]
# --force : 세션이 살아있어도 파인을 전부 재기동

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SESSION="team1"
FORCE="${1:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[??]${NC} $*"; }
fail() { echo -e "${RED}[!!]${NC} $*"; }

# ── 1단계: TMUX 서버 및 세션 확인 ────────────────────
echo "▶ 1단계: TMUX 세션 확인 중..."
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  warn "세션 '$SESSION' 없음 — 새로 생성합니다."
  bash "$PROJECT_ROOT/setup-team.sh"
  ok "세션 재생성 완료"
  exit 0
fi
ok "세션 '$SESSION' 존재 확인"

# ── 2단계: 파인 수 확인 (정상 = 6개) ─────────────────
echo "▶ 2단계: 파인 개수 확인 중..."
PANE_COUNT=$(tmux list-panes -t "$SESSION" | wc -l)
if [[ "$PANE_COUNT" -lt 6 ]]; then
  fail "파인 수 부족: ${PANE_COUNT}/6 — 세션 전체 재생성합니다."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  bash "$PROJECT_ROOT/setup-team.sh"
  ok "세션 재생성 완료"
  exit 0
fi
ok "파인 수 정상: ${PANE_COUNT}개"

# ── 3단계: 각 파인 Claude 프로세스 확인 ──────────────
echo "▶ 3단계: 파인별 Claude 상태 확인 중..."

declare -A ROLE=([0]="진서" [1]="진록" [2]="진삼" [3]="진사" [4]="진오" [5]="진육")

DEAD_PANES=()
for PANE_IDX in 0 1 2 3 4 5; do
  # 화면 텍스트("❯", "$" 등) 패턴은 Claude Code 화면·bash 프롬프트 양쪽에 다 나타날 수
  # 있어 오탐이 잦았다(bash 프롬프트도 "$"로 끝나서 "활성"으로 잘못 판정됨). 대신
  # 이 파인에서 실제로 돌고 있는 프로세스가 claude인지로 판정한다(오탐 없음).
  # 주의: list-panes에 파인 타깃을 줘도 창 전체 파인이 나오므로 반드시
  # display-message로 그 파인 하나만 정확히 조회해야 한다.
  CMD=$(tmux display-message -t "${SESSION}:0.${PANE_IDX}" -p '#{pane_current_command}' 2>/dev/null)
  if [ "$CMD" = "claude" ]; then
    ok "Pane ${PANE_IDX} (${ROLE[$PANE_IDX]}): 활성 (claude 실행 중)"
  else
    warn "Pane ${PANE_IDX} (${ROLE[$PANE_IDX]}): claude 미실행(${CMD:-없음}) — 재기동 대상"
    DEAD_PANES+=("$PANE_IDX")
  fi
done

# ── 4단계: 죽은 파인 재기동 ──────────────────────────
if [[ ${#DEAD_PANES[@]} -eq 0 && -z "$FORCE" ]]; then
  ok "모든 파인 정상 — 복구 불필요"
  exit 0
fi

if [[ -n "$FORCE" ]]; then
  warn "--force 옵션: 모든 파인을 재기동합니다."
  DEAD_PANES=(0 1 2 3 4 5)
fi

echo "▶ 4단계: 비정상 파인 재기동 중... (${#DEAD_PANES[@]}개)"
for PANE_IDX in "${DEAD_PANES[@]}"; do
  echo "  → Pane ${PANE_IDX} (${ROLE[$PANE_IDX]}) 재기동..."
  bash "$SCRIPT_DIR/reboot-pane.sh" "$PANE_IDX" 2>/dev/null || {
    fail "reboot-pane.sh 실패 — 수동 확인 필요: Pane ${PANE_IDX}"
    continue
  }
  ok "Pane ${PANE_IDX} 재기동 완료"
done

echo ""
ok "═══ 자동복구 완료 ═══"
echo "  재기동된 파인: ${DEAD_PANES[*]:-없음}"
echo "  세션 확인: tmux attach -t $SESSION"
