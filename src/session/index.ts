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
import { writeFileSync, chmodSync } from "node:fs";

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
 * Build the bash entry script that runs INSIDE the container.
 */
function buildEntryScript(config: AgentboxConfig, tty: TtySize): string {
  const session = config.sessionName;
  const sessionQ = shSingleQuote(session);
  const cols = Math.trunc(tty.cols) || DEFAULT_TTY.cols;
  const rows = Math.trunc(tty.rows) || DEFAULT_TTY.rows;
  const observerPort = config.observerPort;

  // Command run in the `main` window: enable Agent Teams, launch Claude lead.
  const leadCmd = "export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; claude";
  // Command run in the `observer` window: the dashboard web server.
  const observerCmd = `OBSERVER_PORT=${observerPort} node ${shSingleQuote(
    CONTAINER_OBSERVER,
  )}`;

  return `#!/usr/bin/env bash
# agentbox entry script — generated; run via: bash /agentbox/entry.sh
set -euo pipefail

SESSION=${sessionQ}

# Reattach if the session already exists.
if tmux has-session -t "$SESSION" 2>/dev/null; then
  exec tmux attach -t "$SESSION"
fi

# Create a new detached session sized to the real TTY. Window 'main' will host
# the Claude lead (Agent Teams enabled).
tmux new-session -d -s "$SESSION" -n main -x ${cols} -y ${rows}

# Launch the Claude lead in the 'main' window with Agent Teams enabled.
tmux send-keys -t "$SESSION":main ${shSingleQuote(leadCmd)} C-m

# Observer dashboard in its OWN window (NEVER a pane in main: teammateMode tmux
# only splits panes if the lead window is otherwise empty).
tmux new-window -t "$SESSION" -n observer ${shSingleQuote(observerCmd)}

# C-b t → main-vertical layout (lead left, teammates right).
tmux bind-key -T prefix t select-layout main-vertical

# Land the user on the Claude lead.
tmux select-window -t "$SESSION":main

# Attach.
exec tmux attach -t "$SESSION"
`;
}

/**
 * Write the entry script to config.entryScriptPath and return that path.
 */
function writeEntryScript(config: AgentboxConfig, tty: TtySize): string {
  const script = buildEntryScript(config, tty);
  writeFileSync(config.entryScriptPath, script, { encoding: "utf8" });
  try {
    // Execute bit is irrelevant (launched via `bash`), but harmless.
    chmodSync(config.entryScriptPath, 0o755);
  } catch {
    // non-fatal
  }
  return config.entryScriptPath;
}

/**
 * The argv to reattach an existing in-container tmux session.
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
