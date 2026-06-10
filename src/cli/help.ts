/**
 * agentbox — usage / help text (top-level and per-command). Never throws.
 */

const TOP = `agentbox — one-command, Docker-isolated agentic coding sandbox
            (tmux + Claude Code Agent Teams + web Observer)

USAGE
  agentbox [command] [flags]

  With no command, 'up' runs by default.

COMMANDS
  up         Build the image if missing, prepare host mounts, write the tmux
             entry script, then run (or reattach to) the sandbox container.
  shell      Open an interactive bash shell in a running box (no tmux).
  rebuild    Force a clean image build (--no-cache), then behave like 'up'.
  doctor     Smoke test: check Docker, image, host mounts, port, and config.
  down       Stop and remove the sandbox container.
  help       Show this help. 'agentbox help <command>' for command details.

FLAGS
  -h, --help            Show usage and exit.
      --workspace <dir> Host directory mounted as /workspace   (env: WORKSPACE)
      --memory <val>    Docker --memory limit, e.g. 4g          (env: MEM)
      --cpus <val>      Docker --cpus limit, e.g. 4             (env: CPUS)
      --port <n>        Observer web port (default 4317)
      --network <mode>  docker build --network (e.g. host)     (env: DOCKER_NETWORK)
      --no-cache        Force a clean image build (up / rebuild).

ENV OVERRIDES (precedence: flag > env > default)
  WORKSPACE      → workspace mount (default: current directory)
  MEM            → memory limit    (default: 4g)
  CPUS           → cpu limit       (default: 4)
  DOCKER_NETWORK → build network   (default: Docker's default bridge)

EXAMPLES
  agentbox                       # up, in the current directory
  agentbox up --workspace ~/proj --port 5000
  agentbox doctor                # diagnose your setup
  agentbox down                  # tear the box down`;

const PER_COMMAND: Record<string, string> = {
  up: `agentbox up — start (or reattach to) the sandbox

USAGE
  agentbox up [--workspace <dir>] [--memory <val>] [--cpus <val>]
              [--port <n>] [--network <mode>] [--no-cache]

Builds the image if it is missing, ensures the host mount sources exist,
writes the tmux entry script, and runs the container interactively. If the
container is already running, it reattaches to the existing tmux session
instead of starting a second one. Pass --no-cache to force a clean rebuild.
Pass --network host if the build can't reach the internet on the default
bridge (runs build steps in the host network namespace).`,

  shell: `agentbox shell — open a bash shell in the running box

USAGE
  agentbox shell

Attaches an interactive 'bash' shell to the running sandbox container (no
tmux). If the container is not running, start it first with 'agentbox up'.`,

  rebuild: `agentbox rebuild — clean rebuild, then up

USAGE
  agentbox rebuild [--network <mode>] [flags]

Runs 'docker build --no-cache' to rebuild the image from scratch, then
behaves exactly like 'agentbox up'. Pass --network host if build steps
can't reach the internet on the default bridge.`,

  doctor: `agentbox doctor — diagnose your setup

USAGE
  agentbox doctor

Prints a ✓/✗ checklist: Docker availability, image presence, host mount
sources, observer port validity, and the fully resolved configuration.
Exits non-zero on a hard failure (Docker unavailable). Missing image is a
soft warning — run 'agentbox up' to build it.`,

  down: `agentbox down — tear down the sandbox

USAGE
  agentbox down

Stops and removes the sandbox container. No error if it does not exist.`,
};

export function topHelp(): string {
  return TOP;
}

export function commandHelp(command: string): string {
  return PER_COMMAND[command] ?? TOP;
}
