FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV AI_SYSTEM_WORKDIR=/workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    openssh-client \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/*

# Install the CLI providers this project supports by default.
RUN npm install -g \
  @google/gemini-cli \
  @openai/codex \
  @anthropic-ai/claude-code

WORKDIR /opt/ai-coding-system

RUN mkdir -p /workspace

COPY package.json tsconfig.json README.md ./
COPY bin ./bin
COPY ai-system ./ai-system
COPY docs ./docs
COPY docker ./docker

RUN npm install --include=dev

RUN chmod +x /opt/ai-coding-system/docker/entrypoint.sh
RUN chmod +x /opt/ai-coding-system/bin/ai.js /opt/ai-coding-system/bin/ai-system.js

EXPOSE 3927

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/ai-coding-system/docker/entrypoint.sh"]
CMD []
