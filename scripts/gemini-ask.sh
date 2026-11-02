#!/bin/bash
# gemini-ask.sh — Google AI Pro(Antigravity CLI)로 웹 조사 한 건 하기 (2026-11-02)
# 진삼(리서쳐)용 조사 도우미. Claude Pro 한도 대신 Google AI Pro 한도를 씁니다.
# 사용:  bash /workspace/scripts/gemini-ask.sh "조사할 질문"
# - 로그인 정보는 /home/claude 에 있으므로 HOME을 그쪽으로 맞춰 실행합니다.
# - 공장 폴더(/workspace)를 건드리지 못하도록 빈 작업 폴더에서 실행합니다.
if [ -z "$*" ]; then echo "사용법: bash /workspace/scripts/gemini-ask.sh \"질문\""; exit 1; fi
AGY="/home/claude/.local/bin/agy"
[ -x "$AGY" ] || { echo "❌ Antigravity CLI(agy)가 설치돼 있지 않습니다."; exit 1; }
SANDBOX="/home/claude/gemini-sandbox"
mkdir -p "$SANDBOX" && cd "$SANDBOX" || exit 1
PROMPT="너는 조사 도우미다. 웹 검색으로 아래 질문을 조사해 한국어로 간결하게 답하라.
파일을 만들거나 고치거나, 셸 명령을 실행하지 마라. 검색과 읽기만 한다.
답 끝에 근거가 된 출처 URL을 목록으로 붙여라.

질문: $*"
HOME=/home/claude timeout 300 "$AGY" -p "$PROMPT" < /dev/null
rc=$?
[ $rc -eq 124 ] && echo "⚠️ 5분 안에 답이 오지 않아 중단했습니다."
exit $rc
