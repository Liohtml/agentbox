# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **Detaching no longer destroys the sandbox.** The container now runs
  detached with the entry script as PID 1 and your terminal attaches via
  `docker exec`, so `Ctrl+b d` behaves as documented (box keeps running).
  Previously the tmux attach client was PID 1: detach killed every agent and
  `--rm` deleted the container.
- **Teammates appear as tmux panes again.** The lead is launched with
  `--teammate-mode tmux`; since Claude Code v2.1.179 the upstream default is
  `in-process`, which silently disabled agentbox's split-pane layout.
- Observer: project/session names are HTML-escaped before rendering
  (stored-XSS guard), the server handles bind errors (`EADDRINUSE`) with a
  readable message, the observer tmux window keeps crash output visible
  (`remain-on-exit`), and dead code was removed.
- CLI: invalid `--port`/`--memory`/`--cpus` values, unknown flags, stray
  positionals, and `:` in mount paths fail fast with clear errors instead of
  surfacing as cryptic Docker failures after a minutes-long build; a
  `--workspace` typo no longer silently creates and mounts an empty
  directory.
- `rebuild` refuses to run while the box is up (it used to rebuild the image
  and then silently reattach to the old container); reattaching with tuning
  flags now warns that they are ignored; stale stopped containers are removed
  before `docker run` instead of causing a name-conflict error.
- `down` no longer reports success when `docker rm -f` actually failed.
- `~/.claude.json` edge cases: a directory there is now a clear error (was: a
  broken mount), and symlinked configs (dotfile managers) are followed
  correctly.
- The generated entry script lives in a per-user `0700` temp subdirectory
  instead of a fixed world-shared `/tmp` path (tamper/TOCTOU + collision).
- Launcher: local `tsx` is invoked via `node` directly — no shell, so paths
  with spaces work and `cmd.exe` metacharacters can't inject on Windows.
- `doctor` warns when the host uid differs from the container's `agent`
  (1000), which breaks writes to the bind mounts.

### Changed
- Dockerfile: `@anthropic-ai/claude-code` and `tsx` versions are overridable
  via build args (`CLAUDE_CODE_VERSION`, `TSX_VERSION`) for reproducible
  builds.
- Package renamed to the scoped **`@liohtml/agentbox`** for npm publishing
  (the bare name `agentbox` is an npm security placeholder). The installed
  command is still `agentbox`.
- `tsx` moved from devDependencies to dependencies so the published package
  runs via `npx`/global install without extra setup.
- CI: Node 22 + 24 matrix, plus an `npm pack` smoke test that installs the
  tarball and runs the CLI as an end user would.

### Added
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, PR template, issue-template config,
  Dependabot config, `RELEASING.md`, this changelog.
- Tag-triggered release workflow with npm provenance.

### Removed
- `PUBLISH.md` (one-time bootstrap doc) — replaced by `RELEASING.md`.

## [0.1.0] — 2026-07-29

### Added
- Initial release: `agentbox up | shell | rebuild | doctor | down`.
- Docker image (Ubuntu 24.04 + Node 22 + Python 3 + Rust + Claude Code + tsx),
  non-root `agent` user, no baked-in credentials.
- Host bind mounts for workspace + Claude auth reuse (`~/.claude`,
  `~/.claude.json`).
- tmux session with Claude lead (Agent Teams) + Observer dashboard window.
- Zero-dependency Observer web server on `127.0.0.1:4317`.
