# Roadmap

Prioritized improvement backlog, curated from ecosystem research
(comparable sandboxes: textcortex/claude-code-sandbox, claude-pod, ai-pod,
claudeman; Anthropic's devcontainer reference; Agent Teams docs, 2026-07).
Ordered by impact-to-effort. PRs welcome — please open an issue first for
anything marked M/L effort.

## Now (small effort, high impact)

1. **Force split-pane teammate mode** *(S, high — bug-level)* —
   Since Claude Code v2.1.179 the default `teammateMode` is `in-process`,
   so teammates no longer appear as tmux panes — agentbox's signature
   layout. Launch the lead with `--teammate-mode tmux`.
2. **`--yolo` flag** *(S, high)* — opt-in
   `--dangerously-skip-permissions` for the lead (teammates inherit it). A
   disposable, resource-capped container is exactly the environment this
   flag exists for; teammate permission prompts otherwise bubble up to the
   lead and multiply friction.
3. **Persistent tool-cache volumes** *(S, high)* — named Docker volumes
   for `~/.npm`, `~/.cargo/registry`, and pip's cache. The box stays
   `--rm`-disposable; only caches survive, killing the cold-start tax.
4. **Git identity + `gh` auth forwarding** *(S, high)* — mount
   `~/.gitconfig` (read-only) and forward `gh` auth so agents can commit
   and open PRs. Same philosophy as Claude auth reuse: borrow host
   identity, never store it.

## Next (medium effort)

5. **Named boxes / one container per project** *(M, high)* — derive
   container name, tmux session, and Observer port from the workspace path
   (plus `--name` override) so two projects never share/steal one box.
   Removes the biggest documented footgun.
6. **Credential isolation** *(M, high)* — mount only
   `.credentials.json` + a minimal `.claude.json` into a per-box dir
   instead of all of `~/.claude` (which carries transcripts and every
   project path). Also fixes the Observer showing other projects'
   sessions.
7. **Per-project config** *(M, high)* — optional `agentbox.json` (extra
   apt packages, setup commands, env, mounts, resource defaults) or a
   custom Dockerfile `FROM agentbox:latest`. Explicitly *not* full
   devcontainer.json compatibility.
8. **Session git-branch safety net** *(M, med-high)* — opt-in: create
   `agentbox/<timestamp>` branch on `up`, print a diff summary on `down`.
9. **Podman support** *(M, med)* — detect `podman` when `docker` is
   absent; rootless-by-default strengthens the isolation story.
10. **Headless mode: `agentbox run "<prompt>"`** *(M, med)* — run
    `claude -p` in the box without tmux/TTY, stream output, exit with
    Claude's status. Makes agentbox scriptable for cron/CI.

## Later

11. **Opt-in egress firewall (`--restrict-network`)** *(M-L, med-high)* —
    port Anthropic's devcontainer `init-firewall.sh` (default-deny outbound,
    allowlist api.anthropic.com/npm/GitHub; `NET_ADMIN` for init, then drop).
12. **Observer: Agent-Teams hook feed** *(M, med)* — register
    `TeammateIdle`/`TaskCreated`/`TaskCompleted` hooks that POST to the
    Observer for an authoritative live task board instead of inferred
    JSONL activity.
13. **ARM64 / Apple Silicon polish** *(S, med)* — `doctor` reports host
    arch, `up` warns on image/host arch mismatch (qemu emulation is slow),
    `--platform` pass-through.
14. **`doctor`/`down` polish** *(S, low-med)* — sweep orphaned tmux
    sessions on `down`; auto-pick the next free Observer port on `up`.
15. **`--gpus` pass-through** *(S, low)* — thin mapping to
    `docker run --gpus` (Linux/NVIDIA), consistent with `--memory`/`--cpus`.

## Non-goals

- Full devcontainer.json compatibility (enterprise-bloat path).
- Being a security jail — see SECURITY.md; the egress firewall is
  hardening, not a sandbox guarantee.
- Baking credentials or per-user state into the image. Ever.
