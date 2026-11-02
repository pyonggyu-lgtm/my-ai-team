#!/bin/bash
# pro-token-setup.sh — Claude Pro 구독 토큰(1년짜리)을 만들고 안전하게 저장 (2026-11-02, 개정 4)
# 상자(claude-env) 안에서 실행:
#   bash scripts/pro-token-setup.sh           → 발급 + 자동 저장 + 실제 시험 (복사 필요 없음)
#   bash scripts/pro-token-setup.sh --paste   → 토큰을 직접 붙여넣어 저장 (자동이 안 될 때)
#   bash scripts/pro-token-setup.sh --check   → 저장된 토큰을 실제로 시험
DIR="/home/claude/.secrets"; FILE="$DIR/pro-token.secret"
mkdir -p "$DIR"; chmod 700 "$DIR"

# 토큰이 실제로 통하는지 가장 가벼운 모델로 한 번 시험 (Pro 사용량 아주 조금)
test_token() {
  local t="$1" out
  out=$(CLAUDE_CODE_OAUTH_TOKEN="$t" env -u ANTHROPIC_API_KEY timeout 90 claude -p "Reply with exactly: OK" --model claude-haiku-5-5 2>&1)
  if printf '%s' "$out" | grep -q "OK" && ! printf '%s' "$out" | grep -qiE "401|invalid|failed to authenticate"; then
    echo "  ✅ 시험 통과: 토큰이 정상 작동합니다."; return 0
  fi
  echo "  ❌ 시험 실패: $(printf '%s' "$out" | tail -1 | cut -c1-120)"; return 1
}

save_token() { printf '%s' "$1" > "$FILE"; chmod 600 "$FILE"; echo "  💾 저장 완료 ($FILE)"; }

if [ "$1" = "--check" ]; then
  [ -s "$FILE" ] || { echo "❌ 저장된 토큰이 없습니다."; exit 1; }
  echo "  길이: $(tr -d '\n' < "$FILE" | wc -c)자 / 시작: $(head -c 10 "$FILE")…"
  test_token "$(cat "$FILE")"; exit $?
fi

if [ "$1" = "--paste" ]; then
  echo " 토큰을 붙여넣고 Enter를 두 번 누르세요 (여러 줄 가능, 화면에 안 보임)."
  T=""; while IFS= read -rs line; do [ -z "$line" ] && [ -n "$T" ] && break; T="$T$line"; done
  T="$(printf '%s' "$T" | tr -d '[:space:]')"
  [ -n "$T" ] || { echo "❌ 입력이 없습니다."; exit 1; }
  test_token "$T" && save_token "$T" && echo " 이제 bash setup-team.sh 로 팀을 다시 띄우세요."
  unset T line; exit 0
fi

command -v script >/dev/null || { echo "❌ 'script' 명령이 없어 자동 저장을 못 합니다. --paste 방식을 쓰세요."; exit 1; }
echo "──────────────────────────────────────────────"
echo " 1) 로그인 주소가 나오면 PC 브라우저에 붙여넣고 Claude(Pro) 계정으로 승인하세요."
echo " 2) 브라우저에 코드가 나오면 그 코드를 여기에 붙여넣고 Enter."
echo " 3) 토큰은 복사하지 않아도 됩니다. 자동으로 잡아서 시험 후 저장합니다."
echo "──────────────────────────────────────────────"
LOG="$DIR/.setup-token.log"; : > "$LOG"; chmod 600 "$LOG"
# 화면 폭을 넓혀 토큰이 한 줄에 나오게 한 뒤, 출력 전체를 파일로 받아 토큰만 골라낸다
script -q -c "stty cols 500 2>/dev/null; env -u ANTHROPIC_API_KEY claude setup-token" "$LOG"
# 화면 제어문자를 꼼꼼히 지운 뒤 토큰 후보를 모은다 (제어문자 찌꺼기가 끝에 붙는 경우 대비)
CANDS=$(perl -pe 's/\e\[[0-9;?<>=]*[ -\/]*[@-~]//g; s/\e\][^\a\e]*(\a|\e\\)//g; s/\e[()][A-Za-z0-9]//g; s/\e.//g; s/\r//g' "$LOG" \
  | grep -oE 'sk-ant-oat01-[A-Za-z0-9_-]{40,}' \
  | perl -ne 'chomp; my $t=$_; my @c; while($t=~/AA/g){ my $p=substr($t,0,pos($t)); push @c,$p if length($p)>=90 } print "$_\n" for (reverse(@c), $t);' \
  | awk '!seen[$0]++' | head -6)
: > "$LOG"
# 토큰이 화면(스크롤 기록 포함)에 남지 않도록 지운다
printf '\033[H\033[2J\033[3J'
if [ -z "$CANDS" ]; then echo "❌ 출력에서 토큰을 찾지 못했습니다. 승인이 끝났는지 확인하고 다시 실행하세요."; exit 1; fi
echo " 토큰을 시험합니다 (후보 $(printf '%s\n' "$CANDS" | wc -l)개, 하나당 10~30초)…"
OKT=""
while IFS= read -r T; do
  echo "  · 후보 ${#T}자 시험 중"
  if test_token "$T"; then OKT="$T"; break; fi
done <<< "$CANDS"
if [ -n "$OKT" ]; then save_token "$OKT"; echo " 이제 bash setup-team.sh 로 팀을 다시 띄우세요."
else echo " 토큰이 통하지 않습니다. 브라우저 승인 계정이 Pro인지 확인하고 다시 실행하세요."; fi
unset T OKT CANDS
