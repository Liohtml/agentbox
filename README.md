# agentbox

> One command. A Docker-isolated agentic coding sandbox that auto-starts tmux +
> Claude Code (Agent Teams) and a web Observer.

`agentbox` boots a disposable Ubuntu container with Node 22, Python 3, Rust, and
Claude Code preinstalled, bind-mounts your project and your *host* Claude
credentials into it, and drops you into a tmux session where the Claude lead runs
on the left, its teammates spawn on the right, and a live Observer dashboard runs
in its own window — reachable from your browser on the host.

```
┌─ tmux: agentbox ────────────────────────────────────────────┐
│ window: main                          │ window: observer     │
│  ┌─────────────┬──────────────────┐   │  http://localhost:   │
│  │ Claude lead │ teammate  teammate│   │     4317             │
│  │  (left)     │ (right, split via │   │  live agent-team     │
│  │             │  C-b t)           │   │  activity            │
│  └─────────────┴──────────────────┘   │                      │
└──────────────────────────────────────┴──────────────────────┘
```

---

## Quick start

```bash
# from your project directory
npx tsx /path/to/agentbox/src/index.ts up
# or, if linked on PATH:
agentbox            # 'up' is the default command
```

First run builds the image (a few minutes); later runs reuse it and start
instantly. When you exit, the container is removed (`--rm`) but your work and
credentials persist on the host because they're bind-mounted.

Before your first run, make sure you've logged into Claude Code **on the host**
(`claude` once, complete the OAuth in your browser). agentbox reuses those host
credentials — see [Why credentials come from the host](#why-credentials-come-from-the-host).

---

## Install

Requires **Node 22+**, **tsx**, and **Docker**.

```bash
cd agentbox
npm install            # dev deps (tsx, typescript, @types/node)
node bin/agentbox.mjs doctor   # verify your setup
```

Optionally expose it as `agentbox` on your PATH:

```bash
npm link               # provides the `agentbox` bin (bin/agentbox.mjs)
agentbox doctor
```

---

## Commands

| Command           | What it does                                                                 |
|-------------------|------------------------------------------------------------------------------|
| `agentbox up`     | **(default)** Build the image if missing → prepare host mounts → write the tmux entry script → run the container (or reattach if it's already up). |
| `agentbox shell`  | Open an interactive `bash` shell in the running box (no tmux). Run `up` first. |
| `agentbox rebuild`| Force a clean `--no-cache` image build, then behave like `up`.               |
| `agentbox doctor` | Smoke test: check Docker, the image, host mount sources, the port, and print the resolved config. Exits non-zero on a hard failure. |
| `agentbox down`   | Stop and remove the sandbox container.                                       |

### Flags

```
-h, --help            Show usage (top-level or 'agentbox help <command>').
    --workspace <dir> Host directory mounted as /workspace   (env: WORKSPACE)
    --memory <val>    Docker --memory limit, e.g. 4g          (env: MEM)
    --cpus <val>      Docker --cpus limit, e.g. 4             (env: CPUS)
    --port <n>        Observer web port (default 4317)
    --no-cache        Force a clean image build (up / rebuild).
```

### Env overrides

Precedence is **flag > env var > default**:

| Env         | Overrides        | Default             |
|-------------|------------------|---------------------|
| `WORKSPACE` | `/workspace` mount | current directory |
| `MEM`       | `--memory` limit | `4g`                |
| `CPUS`      | `--cpus` limit   | `4`                 |

```bash
WORKSPACE=~/code/myapp MEM=8g CPUS=6 agentbox up --port 5000
```

---

## How it works

`agentbox up` runs entirely from the host and orchestrates three modules:

1. **cli** (`src/cli/`) — parses args, resolves config (flags + env + defaults),
   routes to the command.
2. **docker** (`src/docker/`) — builds the image from `assets/Dockerfile` if it's
   missing, ensures the host mount sources exist, then `docker run -it` with all
   bind mounts, the published Observer port, and `--memory`/`--cpus` limits. The
   container is launched with **`bash /agentbox/entry.sh`** (via `bash`, so a
   missing execute bit can never block startup).
3. **session** (`src/session/`) — reads your real terminal size via `stty size`
   and generates that entry script: it creates the tmux session (sized correctly,
   not stuck at 80×24), runs the Claude lead in window `main` with
   `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, runs the Observer in window
   `observer`, binds `C-b t`, and attaches — or reattaches if a session already
   exists.

### Bind mounts (host → container)

| Host                | Container                   | Why                                        |
|---------------------|-----------------------------|--------------------------------------------|
| workspace (cwd)     | `/workspace`                | the code you edit                          |
| `~/.claude`         | `/home/agent/.claude`       | Claude config + **credentials**            |
| `~/.claude.json`    | `/home/agent/.claude.json`  | Claude config file (touched first so Docker mounts a *file*, not a dir) |
| generated entry.sh  | `/agentbox/entry.sh`        | the tmux bootstrap, run via `bash`         |
| `assets/observer.mjs` | `/agentbox/observer.mjs`  | the dashboard                              |

The image runs as the non-root user **`agent`** and never contains credentials.

---

## The Observer

A tiny zero-dependency Node server (`assets/observer.mjs`) that runs in the
`observer` tmux window and serves a live dashboard of agent-team activity (it
tails `~/.claude/projects`). Open **http://localhost:4317** on the host.

> **It binds `0.0.0.0`, not `127.0.0.1`.** Docker only forwards a published port
> to a process listening on all interfaces — a server bound to loopback inside the
> container is unreachable from the host browser.

---

## tmux cheatsheet

| Keys      | Action                                                       |
|-----------|--------------------------------------------------------------|
| `C-b t`   | `select-layout main-vertical` — Claude lead left, teammates right |
| `C-b w`   | List/switch windows (`main` ↔ `observer`)                    |
| `C-b d`   | Detach (the box keeps running; `agentbox up` reattaches)     |

Run `agentbox up` again any time to reattach to a running box; `agentbox down`
tears it down.

---

## Design notes (hard-won correctness facts)

These are baked into the implementation and the [contract](CONTRACT.md):

1. **Why credentials come from the host.** Claude Code's OAuth login fails inside
   Docker, so auth is *never* baked into the image — it's bind-mounted from
   `~/.claude` and `~/.claude.json` on the host. Log in once on the host first.
2. **Observer binds `0.0.0.0`** or the published port is unreachable from the host.
3. **The Observer lives in its own window**, never a pane in `main`. Claude's
   `tmux` teammate mode only splits the lead's window into panes if that window is
   otherwise empty — a second pane there would break the team layout.
4. **The entry script is launched via `bash`**, so a missing execute bit can't
   block startup.
5. **TTY size is read with `stty size`** so tmux opens at your real terminal
   dimensions instead of the 80×24 default.

---

## Project layout

```
agentbox/
├── CONTRACT.md            # the locked shared contract (CLI surface, config, modules)
├── bin/agentbox.mjs       # launcher (spawns tsx; no build step)
├── assets/
│   ├── Dockerfile         # Ubuntu 24.04 + Node 22 + Python 3 + Rust + Claude Code + tsx
│   └── observer.mjs       # the Observer web server (binds 0.0.0.0)
└── src/
    ├── types.ts           # shared interfaces + constants (the contract, in code)
    ├── index.ts           # thin entry → cli.run()
    ├── cli/               # arg parsing, --help, config, command router
    ├── docker/            # image build + container run/exec + host-mount prep
    └── session/           # tmux entry-script generation + TTY sizing
```

---

## Status & limitations

Built and validated as an agent team — each module owns one directory against a
locked contract (`CONTRACT.md` + `src/types.ts`). Validated here:

- `npx tsc --noEmit` is clean across all modules.
- `agentbox --help`, per-command help, and unknown-command handling work.
- `agentbox doctor` prints its checklist and exits non-zero on a hard failure.
- Config precedence (flag > env > default) is verified.
- The generated entry script passes `bash -n` and contains every required line
  (reattach guard, sized `new-session`, Agent Teams env, separate `observer`
  window, the `C-b t` layout bind, `exec tmux attach`).
- The Observer boots, binds `0.0.0.0:4317`, and serves `/`, `/healthz`, and
  `/api/sessions`.

**Not yet exercised:** a real `docker build` and full container run — the
development environment had no Docker daemon. Run `agentbox doctor` and then
`agentbox up` on a machine with Docker to validate the image build end-to-end.
The Dockerfile is hand-reviewed but unbuilt.
