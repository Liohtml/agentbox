# Roadmap

Prioritized improvement backlog, curated from ecosystem research
(comparable sandboxes: textcortex/claude-code-sandbox, claude-pod, ai-pod,
claudeman; Anthropic's devcontainer reference; Agent Teams docs, 2026-07).
Ordered by impact-to-effort. PRs welcome — please open an issue first for
anything marked M/L effort.

## Done

1. ✅ **Force split-pane teammate mode** — the lead launches with
   `--teammate-mode tmux` (since Claude Code v2.1.179 the default is
   `in-process`, which silently disabled agentbox's signature layout).
2. ✅ **`--yolo` flag** — opt-in `--dangerously-skip-permissions` for the
   lead (teammates inherit it). Off by default; see README → Security.
3. ✅ **Persistent tool-cache volumes** — named volumes for `~/.npm`,
   `~/.cargo/registry`, and pip's cache. The box itself stays disposable
   (`down` / `up`'s stale-container cleanup).
4. ✅ **Git identity + `gh` auth forwarding** — `~/.gitconfig` and
   `~/.config/gh` are mounted read-only when present; `gh` is installed in
   the image. Borrow host identity, never store it.
5. ✅ **ARM64 / Apple Silicon check** — `doctor` warns on image/host arch
   mismatch (qemu emulation); `--gpus` passthrough shipped alongside.

## Next (medium effort)

6. **Named boxes / one container per project** *(M, high)* — derive
   container name, tmux session, and Observer port from the workspace path
   (plus `--name` override) so two projects never share/steal one box.
   Removes the biggest documented footgun.
7. **Credential isolation** *(M, high)* — mount only
   `.credentials.json` + a minimal `.claude.json` into a per-box dir
   instead of all of `~/.claude` (which carries transcripts and every
   project path). Also fixes the Observer showing other projects'
   sessions.
8. **Per-project config** *(M, high)* — optional `agentbox.json` (extra
   apt packages, setup commands, env, mounts, resource defaults) or a
   custom Dockerfile `FROM agentbox:latest`. Explicitly *not* full
   devcontainer.json compatibility.
9. **Session git-branch safety net** *(M, med-high)* — opt-in: create
   `agentbox/<timestamp>` branch on `up`, print a diff summary on `down`.
10. **Podman support** *(M, med)* — detect `podman` when `docker` is
    absent; rootless-by-default strengthens the isolation story.
11. **Headless mode: `agentbox run "<prompt>"`** *(M, med)* — run
    `claude -p` in the box without tmux/TTY, stream output, exit with
    Claude's status. Makes agentbox scriptable for cron/CI.

## Later

12. **Opt-in egress firewall (`--restrict-network`)** *(M-L, med-high)* —
    port Anthropic's devcontainer `init-firewall.sh` (default-deny outbound,
    allowlist api.anthropic.com/npm/GitHub; `NET_ADMIN` for init, then drop).
13. **Observer: Agent-Teams hook feed** *(M, med)* — register
    `TeammateIdle`/`TaskCreated`/`TaskCompleted` hooks that POST to the
    Observer for an authoritative live task board instead of inferred
    JSONL activity.
14. **`doctor`/`down` polish** *(S, low-med)* — auto-pick the next free
    Observer port on `up` (pairs with named boxes, #6); `--platform`
    pass-through for cross-arch builds.

## Non-goals

- Full devcontainer.json compatibility (enterprise-bloat path).
- Being a security jail — see SECURITY.md; the egress firewall is
  hardening, not a sandbox guarantee.
- Baking credentials or per-user state into the image. Ever.
