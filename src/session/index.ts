/**
 * agentbox — session module.
 *
 * Owns tmux entry-script generation + TTY sizing. Implements the
 * `SessionModule` contract from ../types.ts. No external deps; uses only
 * node:child_process and node:fs.
 *
 * Import style: ESM with explicit `.ts` extensions.
 */
import { execSync } from "node:child_process";
import { writeFileSync, chmodSync, mkdirSync, lstatSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import {
  CONTAINER_OBSERVER,
  DEFAULT_TTY,
  type AgentboxConfig,
  type SessionModule,
  type TtySize,
} from "../types.ts";

/**
 * Single-quote a string for safe embedding inside a bash double-quoted or
 * bare context. Wraps in single quotes and escapes any embedded single quote
 * via the classic `'\''` trick.
 */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Read the real terminal size via `stty size`, reading from the controlling
 * terminal (stdin inherited). Falls back to DEFAULT_TTY on any failure or
 * non-positive/NaN values.
 */
function readTtySize(): TtySize {
  try {
    const out = execSync("stty size", {
      stdio: ["inherit", "pipe", "pipe"],
      encoding: "utf8",
    }).trim();
    // `stty size` prints "<rows> <cols>".
    const parts = out.split(/\s+/);
    const rows = Number(parts[0]);
    const cols = Number(parts[1]);
    if (
      Number.isFinite(rows) &&
      Number.isFinite(cols) &&
      rows > 0 &&
      cols > 0
    ) {
      return { cols, rows };
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_TTY };
}

/**
 * Build the bash entry script that runs INSIDE the container as PID 1.
 *
 * CRITICAL lifecycle fact: the tmux *client* must never be the container's
 * main process. If it were (the old `exec tmux attach` design), a plain
 * `C-b d` detach would exit PID 1, tear down the whole PID namespace (lead,
 * teammates, Observer) and — with `--rm` — delete the container. Instead this
 * script sets the session up detached and then idles while the tmux SERVER
 * has the session; clients attach via `docker exec` (see cli/docker modules).
 * Detach only ends the exec'd client; ending the tmux session ends PID 1 and
 * therefore the container.
 */
function buildEntryScript(config: AgentboxConfig, tty: TtySize): string {
  const session = config.sessionName;
  const sessionQ = shSingleQuote(session);
  const cols = Math.trunc(tty.cols) || DEFAULT_TTY.cols;
  const rows = Math.trunc(tty.rows) || DEFAULT_TTY.rows;
  const observerPort = config.observerPort;

  // Command run in the `main` window: enable Agent Teams, launch Claude lead.
  // `--teammate-mode tmux` is required for teammates to appear as split
  // panes: since Claude Code v2.1.179 the default teammateMode is
  // "in-process", which silently disables the split-pane layout agentbox is
  // built around.
  const leadCmd =
    "export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; claude --teammate-mode tmux";
  // Command run in the `observer` window: the dashboard web server.
  const observerCmd = `OBSERVER_PORT=${observerPort} node ${shSingleQuote(
    CONTAINER_OBSERVER,
  )}`;

  return `#!/usr/bin/env bash
# agentbox entry script — generated; run via: bash /agentbox/entry.sh
# Runs as container PID 1: sets the tmux session up, then idles while the
# session exists. Attach happens via 'docker exec … tmux attach'.
set -euo pipefail

SESSION=${sessionQ}

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  # Create a new detached session sized to the real TTY. Window 'main' will
  # host the Claude lead (Agent Teams enabled).
  tmux new-session -d -s "$SESSION" -n main -x ${cols} -y ${rows}

  # Launch the Claude lead in the 'main' window with Agent Teams enabled.
  tmux send-keys -t "$SESSION":main ${shSingleQuote(leadCmd)} C-m

  # Observer dashboard in its OWN window (NEVER a pane in main: teammateMode
  # tmux only splits panes if the lead window is otherwise empty). Keep the
  # window around if the server crashes so the error output stays readable.
  tmux new-window -t "$SESSION" -n observer ${shSingleQuote(observerCmd)}
  tmux set-option -w -t "$SESSION":observer remain-on-exit on

  # C-b t → main-vertical layout (lead left, teammates right).
  tmux bind-key -T prefix t select-layout main-vertical

  # Land the user on the Claude lead.
  tmux select-window -t "$SESSION":main
fi

# Keep PID 1 alive for as long as the tmux session lives. When the user ends
# the session (kills the last window / 'tmux kill-session'), this loop exits
# and '--rm' removes the container.
while tmux has-session -t "$SESSION" 2>/dev/null; do
  sleep 2
done
`;
}

/**
 * Write the entry script to config.entryScriptPath and return that path.
 * The parent directory is created user-only (0700) — see cli/config.ts for
 * why the script must not live at a fixed path in the shared temp dir.
 */
function writeEntryScript(config: AgentboxConfig, tty: TtySize): string {
  const script = buildEntryScript(config, tty);
  mkdirSync(dirname(config.entryScriptPath), { recursive: true, mode: 0o700 });
  // Never write through a pre-existing symlink at the target path.
  try {
    if (lstatSync(config.entryScriptPath).isSymbolicLink()) {
      rmSync(config.entryScriptPath);
    }
  } catch {
    // does not exist — fine
  }
  writeFileSync(config.entryScriptPath, script, { encoding: "utf8" });
  try {
    // World-readable so the in-container 'agent' user (uid 1000) can read the
    // bind-mounted file even when the host uid differs; the 0700 parent dir
    // keeps other host users out. Execute bit irrelevant (launched via bash).
    chmodSync(config.entryScriptPath, 0o644);
  } catch {
    // non-fatal
  }
  return config.entryScriptPath;
}

/**
 * The argv to attach to the in-container tmux session (via docker exec).
 */
function attachCommand(config: AgentboxConfig): string[] {
  return ["bash", "-lc", `tmux attach -t ${shSingleQuote(config.sessionName)}`];
}

export const session: SessionModule = {
  readTtySize,
  buildEntryScript,
  writeEntryScript,
  attachCommand,
};
