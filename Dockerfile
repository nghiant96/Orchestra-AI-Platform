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

COPY package.json README.md ./
COPY ai-system ./ai-system
COPY docs ./docs
COPY docker ./docker

RUN chmod +x /opt/ai-coding-system/docker/entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/ai-coding-system/docker/entrypoint.sh"]
CMD ["--help"]
