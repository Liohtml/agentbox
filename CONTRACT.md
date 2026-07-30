# agentbox — SHARED CONTRACT (LOCKED)

This document is the single source of truth for the CLI surface, the config
schema, and the module boundaries. **Do not change anything here without telling
the lead.** The three teammate modules are built in parallel against it.

The machine-readable half of this contract lives in [`src/types.ts`](src/types.ts)
(interfaces + constants). This file is the prose half. They must agree.

---

## 1. Directory ownership (do NOT touch another owner's files)

| Path                  | Owner       | Responsibility                                         |
|-----------------------|-------------|--------------------------------------------------------|
| `src/types.ts`        | lead        | Shared types/constants. Change-request only.           |
| `src/index.ts`        | lead        | Thin entry → `cli.run()`.                              |
| `bin/agentbox.mjs`    | lead        | Launcher (spawns tsx).                                  |
| `assets/observer.mjs` | lead        | Bundled Observer web server.                            |
| `src/cli/`            | cli-dev     | Arg parsing, `--help`, config resolution, command router. |
| `src/docker/`         | docker-dev  | Image build, container run/exec, host-mount prep.       |
| `assets/Dockerfile`   | docker-dev  | The image definition.                                   |
| `src/session/`        | session-dev | tmux entry-script generation, TTY sizing.               |
| `README.md`           | lead        | Written last, from teammate reports.                    |

---

## 2. CLI command surface

Invoked as `agentbox <command> [flags]` (via `bin/agentbox.mjs` or
`tsx src/index.ts`). `up` is the **default** command when none is given.

| Command   | Behavior                                                                                  |
|-----------|-------------------------------------------------------------------------------------------|
| `up`      | (default) Build image if missing → ensure host mounts → write entry script → run/attach the container with tmux + Claude lead + Observer. |
| `shell`   | Open an interactive `bash` shell in the box (start the container if needed; no tmux).      |
| `rebuild` | Force `docker build --no-cache`, then behave like `up`.                                    |
| `doctor`  | Smoke test: check docker availability, image presence, host mount sources, tmux-in-image, port, and config. Print a checklist; exit non-zero on any hard failure. |
| `down`    | Stop + remove the container.                                                              |

### Global flags / args
- `--help`, `-h` — print usage (top-level and per-command). Never errors.
- `--workspace <path>` — override workspace mount (also env `WORKSPACE`).
- `--memory <val>` — docker memory limit, e.g. `4g` (also env `MEM`).
- `--cpus <val>` — docker cpu limit, e.g. `4` (also env `CPUS`).
- `--port <n>` — observer port (default 4317).
- `--network <mode>` — `docker build --network` mode, e.g. `host` (also env `DOCKER_NETWORK`). Unset → Docker's default build network.
- `--gpus <val>` — `docker run --gpus` passthrough, e.g. `all` (Linux/NVIDIA).
- `--yolo` — launch the lead with `--dangerously-skip-permissions` (teammates inherit it). Opt-in only; recorded as a `agentbox.yolo` container label so reattach can report the box's actual mode.
- `--no-cache` — (rebuild/up) force a clean image build.

### Env overrides (precedence: **flag > env > default**)
- `WORKSPACE` → `config.workspace`
- `MEM` → `config.memory`
- `CPUS` → `config.cpus`
- `DOCKER_NETWORK` → `config.buildNetwork`

---

## 3. Config schema

See `AgentboxConfig` in `src/types.ts`. Built by `cli.resolveConfig(env, flags)`.

Defaults (`DEFAULTS` in types):
- image `agentbox:latest`, container `agentbox`, tmux session `agentbox`
- observer port `4317`, memory `4g`, cpus `4`
- `workspace` default = `process.cwd()`
- `claudeDir` default = `~/.claude`, `claudeJson` default = `~/.claude.json`
- `dockerfile` = `assets/Dockerfile`, `buildContext` = `assets/`
- `observerAsset` = `assets/observer.mjs`
- `entryScriptPath` = a host temp path in a per-user 0700 subdir
  (`os.tmpdir()/agentbox-<uid>/entry.sh`) — never a fixed path in the shared
  temp dir (tamper/TOCTOU on multi-user hosts)

---

## 4. Module exports (import with explicit `.ts` extension)

```ts
// src/cli/index.ts
export function run(argv: string[]): Promise<number>;
export function resolveConfig(env: NodeJS.ProcessEnv, flags: Record<string, string | boolean>): AgentboxConfig;

// src/docker/index.ts
export const docker: DockerModule;   // see src/types.ts

// src/session/index.ts
export const session: SessionModule; // see src/types.ts
```

`cli` orchestrates: it imports `{ docker }` and `{ session }` and calls them.
`docker` and `session` MUST NOT import `cli` (no cycles). They may import
`../types.ts` only.

---

## 5. Container layout (fixed paths — constants in types.ts)

| Host source                | → Container target           | Notes                                  |
|----------------------------|------------------------------|----------------------------------------|
| `config.workspace`         | `/workspace`                 | the code you edit                      |
| `config.claudeDir` (`~/.claude`) | `/home/agent/.claude`  | **creds live here — never bake auth into the image** |
| `config.claudeJson` (`~/.claude.json`) | `/home/agent/.claude.json` | **touch first** so Docker mounts a file, not a dir |
| `config.entryScriptPath`   | `/agentbox/entry.sh`         | run via `bash` (no execute-bit reliance) |
| `config.observerAsset`     | `/agentbox/observer.mjs`     | the dashboard                          |
| `config.gitconfigPath` *(if present)* | `/home/agent/.gitconfig` | **read-only** — git identity reuse |
| `config.ghConfigDir` *(if present)*   | `/home/agent/.config/gh` | **read-only** — gh CLI auth reuse  |

Named cache volumes (`CACHE_VOLUMES` in types.ts): `agentbox-npm-cache`,
`agentbox-cargo-registry`, `agentbox-pip-cache` → the box itself stays
disposable (removed via `down`, or replaced by `up`'s stale-container
cleanup — see §6.7), only tool downloads persist. Host identity mounts are
read-only, existence-gated, and NEVER copied into the image.

- Publish `-p <observerPort>:<observerPort>`.
- Apply `--memory <config.memory>` and `--cpus <config.cpus>`.
- Run as the non-root user `agent`.

---

## 6. Hard-won correctness facts (MUST honor)

1. **Claude Code OAuth fails inside Docker** → credentials come from the host
   bind mounts (`~/.claude`, `~/.claude.json`). Never bake auth into the image.
2. **Observer must bind `0.0.0.0`** (not `127.0.0.1`) or the published port is
   unreachable from the host browser. (Handled in `assets/observer.mjs`.)
3. **teammateMode `tmux` only splits panes if the lead window is otherwise
   empty** → keep the Observer in its OWN window (`observer`), never a pane in
   `main`.
4. **Launch the entry script via `bash /agentbox/entry.sh`** so a missing
   execute bit never blocks startup.
5. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the `main` window, and
   launch the lead with `--teammate-mode tmux`: since Claude Code v2.1.179
   the default teammateMode is `in-process`, which silently disables the
   split-pane layout.
6. Read the real TTY size via `stty size` so tmux isn't stuck at 80×24.
7. **The tmux attach client must NEVER be container PID 1.** The container
   runs detached (`docker run -d`, deliberately NOT `--rm`); the entry script
   sets the session up and idles while it exists, and clients attach via
   `docker exec … tmux attach`. Otherwise `C-b d` (detach) exits PID 1 and
   kills every agent. Not using `--rm` means a container that exits early
   (entry-script crash) stays inspectable via `docker logs`; `up` removes a
   stale stopped container before starting fresh, and `down` removes it
   explicitly.

---

## 7. Build–test loop

Each teammate validates its OWN module (typecheck + a runnable smoke check that
needs no Docker daemon where possible), max 5 iterations, then reports to the
lead: what works, what's stubbed, and any contract friction. The lead synthesizes
and writes the README.
