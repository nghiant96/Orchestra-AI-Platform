# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — compiles TypeScript to dist/ with the full dependency set.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

WORKDIR /build

# Manifests first so a source-only change reuses the cached install layer.
# The lockfile is mandatory: installing without it resolves versions no other
# environment has ever tested.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY dashboard/package.json ./dashboard/package.json
RUN pnpm install --frozen-lockfile --filter .

COPY tsconfig.json tsconfig.build.json ./
COPY ai-system ./ai-system
COPY scripts ./scripts
RUN pnpm run build

# ---------------------------------------------------------------------------
# Runtime stage — production dependencies and compiled output only.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV AI_SYSTEM_WORKDIR=/workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

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

RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

# The CLI providers this project orchestrates.
#
# Only publicly published packages belong in the default. `agy-cli`
# (Antigravity) is not on the public registry — it used to be listed here and
# made the image unbuildable, which went unnoticed because nothing ever built
# it. Supply it through this build argument if you have access:
#
#   docker build --build-arg PROVIDER_CLI_PACKAGES="@openai/codex agy-cli" .
ARG PROVIDER_CLI_PACKAGES="@openai/codex @anthropic-ai/claude-code"
RUN npm install -g ${PROVIDER_CLI_PACKAGES} \
  && npm cache clean --force

WORKDIR /opt/ai-coding-system

# `--prod --filter .` keeps the image to the three runtime dependencies and
# leaves the dashboard workspace out entirely.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY dashboard/package.json ./dashboard/package.json
RUN pnpm install --frozen-lockfile --prod --filter . \
  && pnpm store prune

COPY --from=build /build/dist ./dist
COPY bin ./bin
COPY docker ./docker

RUN chmod +x ./docker/entrypoint.sh ./docker/healthcheck.sh ./bin/ai.js ./bin/ai-system.js

# Run unprivileged. The state directories are created here so that named
# volumes mounted over them inherit `node` ownership — Docker seeds a volume
# from the image path, and a missing path is created as root instead.
RUN mkdir -p /workspace/.ai-system-server /workspace/.ai-system-artifacts /home/node/.provider-config \
  && chown -R node:node /workspace /home/node/.provider-config /opt/ai-coding-system
USER node

EXPOSE 3927

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/opt/ai-coding-system/docker/healthcheck.sh"]

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/ai-coding-system/docker/entrypoint.sh"]
CMD []
