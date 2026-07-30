/**
 * Tests for src/session/index.ts — buildEntryScript output. Asserts the script
 * creates the `main` and `observer` windows, enables Agent Teams, binds
 * `C-b t` to `select-layout main-vertical`, keeps the observer in its OWN
 * window, and shell-quotes safely. Pure, Docker-free logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { session } from "../src/session/index.ts";
import {
  CONTAINER_OBSERVER,
  DEFAULT_TTY,
  type AgentboxConfig,
} from "../src/types.ts";

function baseConfig(over: Partial<AgentboxConfig> = {}): AgentboxConfig {
  return {
    workspace: "/workspace",
    claudeDir: "/home/u/.claude",
    claudeJson: "/home/u/.claude.json",
    image: "agentbox:latest",
    containerName: "agentbox",
    sessionName: "agentbox",
    observerPort: 4317,
    memory: "4g",
    cpus: "4",
    yolo: false,
    gitconfigPath: "/home/u/.gitconfig",
    ghConfigDir: "/home/u/.config/gh",
    dockerfile: "/repo/assets/Dockerfile",
    buildContext: "/repo/assets",
    observerAsset: "/repo/assets/observer.mjs",
    entryScriptPath: "/tmp/agentbox-entry.sh",
    ...over,
  };
}

const TTY = { cols: 200, rows: 50 };

test("creates a session with a 'main' window sized to the tty", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /tmux new-session -d -s "\$SESSION" -n main -x 200 -y 50/);
});

test("enables CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in the main window", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1/);
  // It is sent to the 'main' window and launches claude.
  assert.match(s, /send-keys -t "\$SESSION":main .*claude/);
});

test("launches the lead with --teammate-mode tmux (split panes are no longer the upstream default)", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /claude --teammate-mode tmux/);
});

test("--yolo adds --dangerously-skip-permissions to the lead; default does not", () => {
  const on = session.buildEntryScript(baseConfig({ yolo: true }), TTY);
  assert.match(on, /--dangerously-skip-permissions/);
  const off = session.buildEntryScript(baseConfig(), TTY);
  assert.doesNotMatch(off, /--dangerously-skip-permissions/);
});

test("creates the observer in its OWN window (not a pane in main)", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  // A dedicated `new-window -n observer` — never `split-window`.
  assert.match(s, /tmux new-window -t "\$SESSION" -n observer/);
  assert.doesNotMatch(s, /split-window/);
});

test("observer window runs node on the bundled observer asset", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  // The observer command (`... node '<path>'`) is itself single-quoted for the
  // `tmux new-window` argument, so the inner quotes around the path become the
  // classic `'\''` escape. Assert the container observer path is present and
  // that `node` runs it on the new-window line.
  assert.ok(s.includes(CONTAINER_OBSERVER), "container observer path must appear");
  const observerLine = s.split("\n").find((l) => l.includes("new-window"));
  assert.ok(observerLine, "expected a new-window line");
  assert.match(observerLine!, /node .*observer\.mjs/);
});

test("passes the observer port through to the observer command", () => {
  const s = session.buildEntryScript(baseConfig({ observerPort: 5050 }), TTY);
  assert.match(s, /OBSERVER_PORT=5050 node/);
});

test("binds C-b t to select-layout main-vertical", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /tmux bind-key -T prefix t select-layout main-vertical/);
});

test("skips setup when the session already exists (idempotent re-run)", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /if ! tmux has-session -t "\$SESSION"/);
});

test("PID 1 idles while the session lives — NEVER 'exec tmux attach' (a detach would kill the sandbox)", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.doesNotMatch(s, /exec tmux attach/);
  // Keep-alive loop bound to the tmux session's lifetime.
  assert.match(s, /while tmux has-session -t "\$SESSION"/);
});

test("observer window keeps its output readable after a crash (remain-on-exit)", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /set-option -w -t "\$SESSION":observer remain-on-exit on/);
});

test("uses a bash shebang and strict mode", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /^#!\/usr\/bin\/env bash/);
  assert.match(s, /set -euo pipefail/);
});

test("shell-quotes the session name safely against injection", () => {
  // A hostile session name must be single-quoted, neutralizing the `;`.
  const evil = "agentbox'; rm -rf /; echo '";
  const s = session.buildEntryScript(baseConfig({ sessionName: evil }), TTY);
  // The raw injection sequence must NOT appear unquoted as `; rm -rf /`.
  assert.ok(
    s.includes(`SESSION='agentbox'\\''; rm -rf /; echo '\\'''`),
    "session name must be single-quoted with the '\\'' escape trick",
  );
});

test("non-finite / zero tty dimensions fall back to defaults", () => {
  const s = session.buildEntryScript(baseConfig(), { cols: 0, rows: NaN });
  assert.match(s, new RegExp(`-x ${DEFAULT_TTY.cols} -y ${DEFAULT_TTY.rows}`));
});

test("attachCommand reattaches the configured session via bash -lc", () => {
  const cmd = session.attachCommand(baseConfig({ sessionName: "agentbox" }));
  assert.deepEqual(cmd, ["bash", "-lc", "tmux attach -t 'agentbox'"]);
});

test("main window is selected last so the user lands on the lead", () => {
  const s = session.buildEntryScript(baseConfig(), TTY);
  assert.match(s, /tmux select-window -t "\$SESSION":main/);
  // select-window appears after new-window observer.
  assert.ok(
    s.indexOf("new-window") < s.indexOf("select-window"),
    "observer window is created before selecting main",
  );
});

// ── writeEntryScript: temp-dir ownership/permission hardening ──────────────
// mkdirSync's `mode` only applies when it CREATES the directory; if another
// local process pre-created it (predictable path: agentbox-<uid>), the mode
// is silently ignored. writeEntryScript must verify ownership/permissions
// itself rather than trusting a pre-existing directory. POSIX-only (no
// process.getuid on Windows).
const posixOnly = typeof process.getuid === "function" ? test : test.skip;

posixOnly("writeEntryScript succeeds when it creates the temp dir itself", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-test-"));
  fs.rmSync(dir, { recursive: true, force: true }); // let writeEntryScript create it fresh
  const scriptPath = path.join(dir, "entry.sh");
  const written = session.writeEntryScript(baseConfig({ entryScriptPath: scriptPath }), TTY);
  assert.equal(written, scriptPath);
  assert.ok(fs.existsSync(scriptPath));
  fs.rmSync(dir, { recursive: true, force: true });
});

posixOnly("writeEntryScript refuses a pre-existing world-writable temp dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-test-"));
  fs.chmodSync(dir, 0o777); // simulate another local user's permissive pre-created dir
  const scriptPath = path.join(dir, "entry.sh");
  assert.throws(
    () => session.writeEntryScript(baseConfig({ entryScriptPath: scriptPath }), TTY),
    /refusing to write the entry script/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
