FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl ca-certificates git tmux redis-tools \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Claude Code는 root 권한에서 --dangerously-skip-permissions 사용을 거부하므로 비-root 사용자로 실행
RUN useradd -m -s /bin/bash claude
USER claude

WORKDIR /workspace

CMD ["bash"]
