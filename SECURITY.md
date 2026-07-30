# Security Policy

## Supported versions

Only the latest release (and `main`) receive security fixes.

## Reporting a vulnerability

Please report vulnerabilities **privately** via
[GitHub Security Advisories](https://github.com/Liohtml/agentbox/security/advisories/new)
— do not open a public issue for security-sensitive reports. You should
receive a response within a few days.

## Threat model — read before reporting

agentbox is a **workbench, not a jail**. By design:

- Your host `~/.claude` directory and `~/.claude.json` are bind-mounted
  **read-write** into the container. They contain your OAuth token, the list
  of project paths you've opened, and full session transcripts. Anything
  running inside the box can read or modify them — including
  `~/.claude/settings.json` and hooks, which your **host** Claude Code
  executes. In other words, for untrusted workloads this mount is a
  container-to-host escape channel. Only run workloads you trust.
  (Narrowing the mount to just credentials is on the roadmap.)
- The container isolates *resources* (CPU/memory caps, a disposable
  container, non-root `agent` user) — it is **not** a security boundary
  against malicious code.
- `~/.gitconfig` and `~/.config/gh` are bind-mounted **read-only** when
  present so agents can commit and open PRs as you. Read-only stops the
  container from *modifying* them, but anything inside can still *read*
  your `gh` token and use it — same trust model as the Claude credentials.
- `--yolo` runs the lead (and every teammate) with
  `--dangerously-skip-permissions` — no human checkpoint before an agent
  acts. Combined with the mounts above, that means an agent can do anything
  you can. Opt-in per invocation; never the default.
- The Observer dashboard is unauthenticated by design; its port is published
  to `127.0.0.1` **only** and must never be exposed to the LAN.

Reports that reduce to "code inside the container can access the mounted
credentials" describe documented, intended behavior. Reports we absolutely
want: anything that breaks the documented guarantees above — e.g. the
Observer becoming reachable from non-loopback interfaces, container escape
paths agentbox introduces, injection via agentbox's own CLI/entry-script
generation, or credential exposure *beyond* the documented mounts.
