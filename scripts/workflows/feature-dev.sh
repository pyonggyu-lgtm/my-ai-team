#!/bin/bash
# feature-dev.sh — 기능 개발 워크플로우 Phase 1 (조사 + UI 설계 병렬 시작)
# Usage: bash scripts/workflows/feature-dev.sh "기능 이름"
# 사전 조건: scripts/team-send.sh 를 source 한 상태 (team-send 함수 필요)

FEATURE_NAME="$1"

team-send 2 "[$FEATURE_NAME] 기술 조사 시작해줘"
team-send 3 "[$FEATURE_NAME] UI 설계 시작해줘"
echo "Phase 1 시작: 조사(진삼) + 디자인(진사) 병렬 진행"
