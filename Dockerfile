FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl ca-certificates git tmux redis-tools locales \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && locale-gen en_US.UTF-8 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 한글(멀티바이트 UTF-8) 표시를 위한 로케일 설정 — 없으면 tmux에서 한글이 밑줄로 깨져 보임
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Claude Code는 root 권한에서 --dangerously-skip-permissions 사용을 거부하므로 비-root 사용자로 실행
RUN useradd -m -s /bin/bash claude

# npm 기본 전역 설치 위치(/usr/lib/node_modules, /usr/bin)는 root 소유라 non-root
# claude 사용자가 자기 자신을 self-update할 수 없다(업데이트는 /usr/bin/claude 심볼릭
# 링크를 rename해야 하는데 /usr/bin 디렉터리 자체에 쓰기 권한이 없어 EACCES 발생 —
# 단순히 설치된 파일들의 소유권만 옮기는 걸로는 해결 안 됨, 확인됨).
# claude 계정이 소유하는 별도 경로로 npm 전역 prefix를 옮겨서 근본 해결한다.
ENV NPM_CONFIG_PREFIX=/opt/claude-npm-global
ENV PATH=/opt/claude-npm-global/bin:$PATH
RUN mkdir -p /opt/claude-npm-global && chown claude:claude /opt/claude-npm-global

USER claude
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /workspace

CMD ["bash"]
