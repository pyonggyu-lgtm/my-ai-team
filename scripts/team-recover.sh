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

declare -A ROLE=([0]="쭌" [1]="민준" [2]="지훈" [3]="수아" [4]="서연" [5]="태양")

DEAD_PANES=()
for PANE_IDX in 0 1 2 3 4 5; do
  LAST=$(tmux capture-pane -t "${SESSION}:0.${PANE_IDX}" -p 2>/dev/null | tail -3)
  if echo "$LAST" | grep -qE '❯\s*$|>\s*$|claude>|\$\s*$'; then
    ok "Pane ${PANE_IDX} (${ROLE[$PANE_IDX]}): 활성"
  else
    warn "Pane ${PANE_IDX} (${ROLE[$PANE_IDX]}): 응답 없음 — 재기동 대상"
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

# ── 5단계: 역할 정체성 재주입 ─────────────────────────
# /workspace의 CLAUDE.md는 팀 공통 규칙만 담고 있어 개별 역할을 모른다 (config/claude/roles/*.md 참고).
# 재기동 직후 역할을 다시 알려줘야 팀원으로서 정상 동작한다.
echo "▶ 5단계: 재기동된 파인에 역할 정체성 주입 중..."
sleep 3

declare -A IDENTITY_MSGS=(
  [0]="너는 쭌(팀장)이야. Pane 0. config/claude/roles/jun.md 참고. 직접 코딩하지 않고 민준에게 위임."
  [1]="너는 민준(PM·아키텍트)이야. Pane 1. config/claude/roles/minjun.md 참고. 팀원 지시·Phase 관리 담당."
  [2]="너는 지훈(리서쳐)이야. Pane 2. config/claude/roles/jihun.md 참고. 기술 조사 담당."
  [3]="너는 수아(UI/UX 디자이너)야. Pane 3. config/claude/roles/sua.md 참고. 화면 설계 담당."
  [4]="너는 서연(개발자)이야. Pane 4. config/claude/roles/seoyeon.md 참고. 구현 담당."
  [5]="너는 태양(리뷰어)이야. Pane 5. config/claude/roles/taeyang.md 참고. 코드 리뷰 담당."
)

for PANE_IDX in "${DEAD_PANES[@]}"; do
  MSG="${IDENTITY_MSGS[$PANE_IDX]}"
  tmux send-keys -t "${SESSION}:0.${PANE_IDX}" "$MSG" Enter
  sleep 0.3
  ok "Pane ${PANE_IDX} 정체성 주입 완료"
done

echo ""
ok "═══ 자동복구 완료 ═══"
echo "  재기동된 파인: ${DEAD_PANES[*]:-없음}"
echo "  세션 확인: tmux attach -t $SESSION"
