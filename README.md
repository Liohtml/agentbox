# agentbox

> One command spins up a Docker-isolated agentic coding sandbox — tmux + Claude Code (Agent Teams) + a live web Observer.

`agentbox up` boots a disposable Ubuntu container preloaded with Node 22, Python 3, Rust, and Claude Code, bind-mounts your project **and your host Claude login** into it, and drops you into a tmux session: the Claude **lead** runs on the left, its **teammates** spawn on the right, and a live **Observer** dashboard runs in its own window — reachable from your host browser at <http://localhost:4317>.

**Why?** You get a throwaway, resource-capped box where a Claude Code lead can spawn a whole team of agents to work on your code — fully isolated from your host, but reusing your existing Claude auth and editing your real project files. Exit and the container is gone; your work and credentials stay on the host because they're bind-mounted, never baked in.

```
┌─ tmux: agentbox ────────────────────────────────────────────┐
│ window: main                          │ window: observer     │
│  ┌─────────────┬──────────────────┐   │  http://localhost:   │
│  │ Claude lead │ teammate  teammate│   │     4317             │
│  │  (left)     │ (right, split via │   │  live agent-team     │
│  │             │  Ctrl+b t)        │   │  activity            │
│  └─────────────┴──────────────────┘   │                      │
└──────────────────────────────────────┴──────────────────────┘
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Docker** | Docker Engine, or **Docker Desktop with WSL integration enabled** on Windows. The `docker` CLI must work from the shell you run `agentbox` in. |
| **Node.js ≥ 22** | agentbox runs via `tsx` with no build step. |
| **A Linux / WSL / macOS shell** | Host paths are passed straight to `docker -v`. On Windows, run agentbox **from inside WSL** — native Windows paths (`C:\…`) don't translate and the mounts will fail. |
| **A Claude Code login on the host** | Run `claude` once on the host and complete the OAuth in your browser. agentbox reuses those credentials — OAuth **cannot** complete inside Docker. See [Why credentials come from the host](#why-credentials-come-from-the-host). |

---

## Quick start

```bash
git clone https://github.com/Liohtml/agentbox.git
cd agentbox
npm install                 # installs tsx + typescript (dev deps)

# verify your setup first
node bin/agentbox.mjs doctor

# then, from any project directory you want to work on:
node bin/agentbox.mjs up --workspace ~/code/myapp
```

First run builds the image (a few minutes). Later runs reuse it and start instantly. When you exit, the container is removed (`--rm`); your work and credentials persist on the host.

### Install it on your PATH (recommended)

```bash
npm link            # exposes the `agentbox` command globally
agentbox doctor
cd ~/code/myapp
agentbox            # 'up' is the default command — runs in the current dir
```

> Heads up: `agentbox` needs `tsx` available. `npm install` provides it locally; if you run the linked `agentbox` from elsewhere and see *"'tsx' not found on PATH"*, install it globally with `npm i -g tsx`.

You can also invoke it without linking via `npx`:

```bash
npx agentbox up          # from within the cloned repo
```

---

## Commands

| Command            | What it does                                                                                                                |
|--------------------|----------------------------------------------------------------------------------------------------------------------------|
| `agentbox up`      | **(default)** Build the image if missing → prepare host mounts → write the tmux entry script → run the container (or reattach if it's already up). |
| `agentbox shell`   | Open an interactive `bash` shell in the running box (no tmux). Run `up` first.                                              |
| `agentbox rebuild` | Force a clean `--no-cache` image build, then behave like `up`.                                                              |
| `agentbox doctor`  | Smoke test: check Docker, the image, host mount sources, the port, and print the resolved config. Exits non-zero on a hard failure. |
| `agentbox down`    | Stop and remove the sandbox container.                                                                                      |

Run `agentbox help <command>` for details on any command.

### Flags

| Flag                | Description                                            | Env              |
|---------------------|-------------------------------------------------------|------------------|
| `-h`, `--help`      | Show usage (top-level or `agentbox help <command>`).  | —                |
| `--workspace <dir>` | Host directory mounted as `/workspace`.               | `WORKSPACE`      |
| `--memory <val>`    | Docker `--memory` limit, e.g. `4g`.                   | `MEM`            |
| `--cpus <val>`      | Docker `--cpus` limit, e.g. `4`.                      | `CPUS`           |
| `--port <n>`        | Observer web port (default `4317`).                   | —                |
| `--network <mode>`  | `docker build --network` mode, e.g. `host`.           | `DOCKER_NETWORK` |
| `--no-cache`        | Force a clean image build (`up` / `rebuild`).         | —                |

### Env overrides

Precedence is **flag > env var > default**:

| Env              | Overrides             | Default                  |
|------------------|-----------------------|--------------------------|
| `WORKSPACE`      | `/workspace` mount    | current directory        |
| `MEM`            | `--memory` limit      | `4g`                     |
| `CPUS`           | `--cpus` limit        | `4`                      |
| `DOCKER_NETWORK` | `--network` build mode| Docker's default bridge  |

```bash
WORKSPACE=~/code/myapp MEM=8g CPUS=6 agentbox up --port 5000
```

---

## How it works

`agentbox up` runs entirely from the host and does four things:

1. **Builds the image** from `assets/Dockerfile` if it's missing — Ubuntu 24.04 with Node 22, Python 3, Rust (rustup), git, tmux, and Claude Code + `tsx` installed globally. It runs as the non-root user **`agent`** and never contains credentials.
2. **Prepares the host bind mounts** (below), touching `~/.claude.json` first so Docker mounts a *file*, not a directory.
3. **Generates a tmux entry script** sized to your real terminal (read via `stty size`, so tmux isn't stuck at 80×24).
4. **Runs the container** (`docker run -it`, with `--memory`/`--cpus` limits and the Observer port published), launching the entry script via **`bash /agentbox/entry.sh`** — using `bash` so a missing execute bit can never block startup. If the container is already running, it reattaches instead of starting a second session.

### Bind mounts (host → container)

| Host                  | Container                  | Why                                                            |
|-----------------------|----------------------------|----------------------------------------------------------------|
| workspace (cwd)       | `/workspace`               | the code you edit                                              |
| `~/.claude`           | `/home/agent/.claude`      | Claude config + **credentials** (auth reuse)                  |
| `~/.claude.json`      | `/home/agent/.claude.json` | Claude config file (touched first so Docker mounts a file)     |
| generated `entry.sh`  | `/agentbox/entry.sh`       | the tmux bootstrap, run via `bash`                            |
| `assets/observer.mjs` | `/agentbox/observer.mjs`   | the Observer dashboard                                         |

### The tmux layout

Two windows:

- **`main`** — the Claude Code lead, launched with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Teammates the lead spawns appear as panes here.
- **`observer`** — the Observer web server (its own window, never a pane in `main`).

| Keys      | Action                                                              |
|-----------|--------------------------------------------------------------------|
| `Ctrl+b t`| `main-vertical` layout — Claude lead left, teammates right         |
| `Ctrl+b w`| List / switch windows (`main` ↔ `observer`)                        |
| `Ctrl+b d`| Detach (the box keeps running; `agentbox up` reattaches)           |

### The Observer (`http://localhost:4317`)

A tiny zero-dependency Node server (`assets/observer.mjs`) running in the `observer` window. It tails `~/.claude/projects` and serves a live dashboard of agent-team activity. Inside the container it binds **`0.0.0.0`** (required for Docker to forward the port); on the host the port is published to **`127.0.0.1` only**, so the dashboard is reachable from your browser but never from the LAN. Override the port with `--port`.

---

## Using Agent Teams

The `main` window starts the Claude Code lead with Agent Teams enabled. Just talk to the lead as you normally would — when a task benefits from parallelism, ask it to spin up teammates (e.g. *"split this into a backend dev, a test writer, and a reviewer and run them in parallel"*). Each teammate appears as a pane to the right of the lead; press **`Ctrl+b t`** to tidy them into the lead-left / teammates-right layout. Watch the live roster and per-session activity in the Observer at <http://localhost:4317>.

---

## Security & trust

agentbox isolates **resources** (CPU/memory caps, a throwaway `--rm` container, a non-root `agent` user) — but it is **not a security sandbox for untrusted code**. Two things to be clear about:

- **Your host Claude credentials are mounted read-write.** `~/.claude` and `~/.claude.json` carry your OAuth token, the list of every project path you've opened, and full session transcripts under `~/.claude/projects`. Anything running inside the box can read or modify them. Only run workloads you trust.
- **The container is a workbench, not a jail.** Treat it as a clean, disposable, resource-capped place for *your own* agentic workflows — not as a barrier against malicious code. (The Observer is published to `127.0.0.1` only, so its unauthenticated dashboard never leaks to the LAN.)

---

## Troubleshooting

**Docker not found / "Docker is not available."**
Make sure Docker is installed and the daemon is running. On Windows, open Docker Desktop → Settings → Resources → WSL Integration and enable it for your distro, then re-open your shell so `docker` is on PATH. Diagnose with `agentbox doctor`.

**Observer not reachable in the browser.**
The Observer must listen on `0.0.0.0` for Docker to forward the published port — agentbox already does this. Confirm the container is up, that you opened the right port (default `4317`, or whatever you passed to `--port`), and that nothing else on the host is already using that port.

**Auth errors / Claude won't log in inside the box.**
Claude Code's OAuth can't complete inside Docker. Log in **on the host** first (`claude`, finish the browser flow), then run `agentbox up`. Your `~/.claude` and `~/.claude.json` are bind-mounted in. `agentbox doctor` flags a missing Claude dir or config file.

**A box from another project is still running.**
The container is named `agentbox` and is shared: if one is already up, `agentbox up` reattaches to it and ignores a different `--workspace`/`--port`/`--memory`. Run `agentbox down` first to start a fresh box for another project.

**Anything else.**
Run `agentbox doctor` — it prints a ✓/✗ checklist (Docker, image, mount sources, port) plus the fully resolved config, and exits non-zero on a hard failure.

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

## Design notes (hard-won correctness facts)

Baked into the implementation and the [contract](CONTRACT.md):

1. <a id="why-credentials-come-from-the-host"></a>**Why credentials come from the host.** Claude Code's OAuth login fails inside Docker, so auth is *never* baked into the image — it's bind-mounted from `~/.claude` and `~/.claude.json`. Log in once on the host first.
2. **The Observer binds `0.0.0.0` inside the container** (or Docker can't forward the port), while the host port is published to `127.0.0.1` only — reachable from your browser, not the LAN.
3. **The Observer lives in its own window**, never a pane in `main` — Claude's tmux teammate mode only splits the lead's window into panes if that window is otherwise empty.
4. **The entry script is launched via `bash`**, so a missing execute bit can't block startup.
5. **TTY size is read with `stty size`** so tmux opens at your real terminal dimensions instead of the 80×24 default.

---

_Scaffolded by a Claude Code agent team — each module (`cli`, `docker`, `session`) built in parallel against a locked [contract](CONTRACT.md)._
