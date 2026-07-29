# agentbox image — Docker-isolated agentic coding sandbox.
#
# Provides: Node 22, Python 3, Rust (rustup), git, tmux, build tools, plus
# Claude Code + tsx installed globally. Runs as the NON-ROOT user `agent`.
#
# CRITICAL: never bake auth into this image. Claude Code OAuth fails inside
# Docker; credentials are supplied at runtime via host bind mounts
# (~/.claude → /home/agent/.claude, ~/.claude.json → /home/agent/.claude.json).
# The run command (bash /agentbox/entry.sh) is supplied at `docker run` time,
# so there is intentionally NO ENTRYPOINT/CMD that assumes auth.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# ── Base system packages (single layer, cleaned up for cache efficiency) ──────
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        tmux \
        build-essential \
        python3 \
        python3-pip \
        python3-venv \
        gnupg \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 22 via NodeSource ─────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && npm --version

# ── GitHub CLI (auth is NEVER baked in — ~/.config/gh is bind-mounted ro) ─────
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* \
    && gh --version

# ── Global npm tools: Claude Code + tsx ───────────────────────────────────────
# No auth baked in. Versions overridable for reproducible builds:
#   docker build --build-arg CLAUDE_CODE_VERSION=2.1.180 --build-arg TSX_VERSION=4.19.2 …
ARG CLAUDE_CODE_VERSION=latest
ARG TSX_VERSION=latest
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "tsx@${TSX_VERSION}" \
    && npm cache clean --force

# ── Non-root user `agent` ─────────────────────────────────────────────────────
# Ubuntu 24.04 ships a default uid-1000 `ubuntu` user; remove it so `agent`
# can own uid 1000 cleanly (matches the typical host uid for bind-mount perms).
RUN userdel -r ubuntu 2>/dev/null || true \
    && useradd --create-home --shell /bin/bash --uid 1000 agent \
    && mkdir -p /agentbox /workspace \
    # Pre-create the cache-volume mount points OWNED BY agent — a named
    # volume materializing a missing dir would otherwise be root-owned and
    # break npm/cargo/pip inside the box.
    && mkdir -p /home/agent/.npm /home/agent/.cargo/registry /home/agent/.cache/pip /home/agent/.config \
    && chown -R agent:agent /home/agent /agentbox /workspace \
    && chmod 755 /agentbox

# ── Rust toolchain (installed AS the agent user so cargo is on agent's PATH) ──
USER agent
ENV HOME=/home/agent
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
        | sh -s -- -y --no-modify-path --profile minimal \
    && /home/agent/.cargo/bin/rustc --version
ENV PATH=/home/agent/.cargo/bin:$PATH

# ── Workdir + default shell ───────────────────────────────────────────────────
# No ENTRYPOINT: the launcher runs `bash /agentbox/entry.sh` at `docker run`.
WORKDIR /workspace
CMD ["bash"]
