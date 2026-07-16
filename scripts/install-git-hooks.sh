#!/bin/bash
# install-git-hooks.sh — hooks/ 아래 스크립트를 .git/hooks/에 설치
# 사용: bash scripts/install-git-hooks.sh (클론 후 한 번만 실행)

REPO_ROOT="$(git rev-parse --show-toplevel)"

for hook in "$REPO_ROOT"/hooks/*; do
  name="$(basename "$hook")"
  cp "$hook" "$REPO_ROOT/.git/hooks/$name"
  chmod +x "$REPO_ROOT/.git/hooks/$name"
  echo "설치됨: .git/hooks/$name"
done
