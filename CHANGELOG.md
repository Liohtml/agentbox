# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
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
