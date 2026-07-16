FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl ca-certificates git tmux redis-tools locales \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && locale-gen en_US.UTF-8 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 한글(멀티바이트 UTF-8) 표시를 위한 로케일 설정 — 없으면 tmux에서 한글이 밑줄로 깨져 보임
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Claude Code는 root 권한에서 --dangerously-skip-permissions 사용을 거부하므로 비-root 사용자로 실행
RUN useradd -m -s /bin/bash claude
USER claude

WORKDIR /workspace

CMD ["bash"]
