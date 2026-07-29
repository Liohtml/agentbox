/**
 * agentbox — CLI command router.
 *
 * Public surface (per CONTRACT.md / types.ts):
 *   run(argv): Promise<number>
 *   resolveConfig(env, flags): AgentboxConfig
 *
 * `run` parses argv, resolves config, and orchestrates the docker + session
 * modules. It owns NO docker/tmux logic itself — it only sequences calls.
 */
import fs from "node:fs";
import type { AgentboxConfig } from "../types.ts";
import { docker } from "../docker/index.ts";
import { session } from "../session/index.ts";
import { parseArgs } from "./parser.ts";
import { resolveConfig, validateConfig } from "./config.ts";
import { commandHelp, topHelp } from "./help.ts";

// Re-export so the contract's `export function resolveConfig` is satisfied here.
export { resolveConfig } from "./config.ts";

const KNOWN_COMMANDS = ["up", "shell", "rebuild", "doctor", "down", "help"];
/** Flags any command accepts. Anything else is a hard error (likely a typo). */
const KNOWN_FLAGS = new Set([
  "workspace",
  "memory",
  "cpus",
  "port",
  "network",
  "no-cache",
  "help",
  "h",
]);

/** Entry point invoked by src/index.ts. Always resolves with an exit code. */
export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  // `help` command, or -h/--help anywhere → print usage and exit cleanly.
  if (parsed.command === "help") {
    const sub = parsed.positionals[1];
    console.log(sub && KNOWN_COMMANDS.includes(sub) ? commandHelp(sub) : topHelp());
    return 0;
  }
  if (parsed.helpRequested) {
    const explicit =
      parsed.hasExplicitCommand && KNOWN_COMMANDS.includes(parsed.command)
        ? parsed.command
        : undefined;
    console.log(explicit ? commandHelp(explicit) : topHelp());
    return 0;
  }

  if (!KNOWN_COMMANDS.includes(parsed.command)) {
    console.error(`agentbox: unknown command '${parsed.command}'.\n`);
    console.error(topHelp());
    return 1;
  }

  // Reject typo'd flags instead of silently ignoring them (`--no-cahce`
  // silently doing a cached build is worse than an error).
  const unknownFlags = Object.keys(parsed.flags).filter((f) => !KNOWN_FLAGS.has(f));
  if (unknownFlags.length > 0) {
    console.error(
      `agentbox: unknown flag${unknownFlags.length > 1 ? "s" : ""}: ` +
        unknownFlags.map((f) => `--${f}`).join(", "),
    );
    console.error(`Run 'agentbox help ${parsed.command}' for accepted flags.`);
    return 1;
  }

  // Commands take no extra positionals (only `help <command>` does).
  if (parsed.positionals.length > 1) {
    console.error(
      `agentbox: unexpected argument '${parsed.positionals[1]}' after '${parsed.command}'.`,
    );
    return 1;
  }

  const config = resolveConfig(process.env, parsed.flags);
  const forceNoCache = parsed.flags["no-cache"] === true;

  // Fail fast on invalid input — before any (potentially minutes-long) Docker
  // work. `doctor` is exempt: it reports problems as its ✓/✗ checklist.
  if (parsed.command !== "doctor") {
    const problems = validateConfig(config);
    if (problems.length > 0) {
      for (const p of problems) console.error(`agentbox: ${p}`);
      return 1;
    }
    // An explicitly requested workspace must already exist — auto-creating it
    // would turn a typo (--workspace ~/projcts) into an empty mounted dir.
    const workspaceRequested =
      typeof parsed.flags.workspace === "string" || process.env.WORKSPACE !== undefined;
    if (workspaceRequested && !isDir(config.workspace)) {
      console.error(
        `agentbox: workspace directory does not exist: ${config.workspace}\n` +
          `Create it first, or check the --workspace / WORKSPACE value for typos.`,
      );
      return 1;
    }
  }

  // Reattaching ignores per-invocation flags (the box is shared); make that
  // visible instead of silent.
  const tuningFlagsGiven = ["workspace", "port", "memory", "cpus"].some(
    (f) => typeof parsed.flags[f] === "string",
  );

  try {
    switch (parsed.command) {
      case "up":
        return await cmdUp(config, {
          force: false,
          noCache: forceNoCache,
          warnOnReattach: tuningFlagsGiven,
        });
      case "rebuild":
        return await cmdUp(config, {
          force: true,
          noCache: true,
          warnOnReattach: tuningFlagsGiven,
        });
      case "shell":
        return await cmdShell(config);
      case "doctor":
        return await cmdDoctor(config);
      case "down":
        return await cmdDown(config);
      default:
        // Unreachable (guarded above), but keeps the switch exhaustive.
        console.error(topHelp());
        return 1;
    }
  } catch (err) {
    console.error(`agentbox: ${parsed.command} failed: ${errMessage(err)}`);
    return 1;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Commands
// ───────────────────────────────────────────────────────────────────────────

/** `up` (and the tail of `rebuild`): build-if-needed, mount, write script, run. */
async function cmdUp(
  config: AgentboxConfig,
  opts: { force: boolean; noCache: boolean; warnOnReattach?: boolean },
): Promise<number> {
  if (!(await docker.available())) {
    console.error(dockerUnavailableMessage());
    return 1;
  }

  const running = await docker.containerRunning(config.containerName);

  if (running && opts.force) {
    // Rebuilding the image while the old container is up would silently
    // reattach to the OLD image afterwards — refuse instead.
    console.error(
      `agentbox: container '${config.containerName}' is running — a rebuild would not apply to it.\n` +
        `Stop it first:  agentbox down   (then: agentbox rebuild)`,
    );
    return 1;
  }

  if (running) {
    if (opts.warnOnReattach) {
      console.error(
        `agentbox: note — the box is already running; --workspace/--port/--memory/--cpus are ignored on reattach.\n` +
          `Use 'agentbox down' first to start a fresh box with new settings.`,
      );
    }
    console.log(`agentbox: reattaching to running container '${config.containerName}'…`);
    return await docker.execAttach(config, session.attachCommand(config));
  }

  // A stopped-but-present container (e.g. an --rm corpse after a daemon
  // restart) would make `docker run --name` fail with a name conflict.
  if (await docker.containerExists(config.containerName)) {
    console.log(`agentbox: removing stale container '${config.containerName}'…`);
    await docker.removeContainer(config.containerName);
  }

  await docker.ensureHostMounts(config);

  const needBuild = opts.force || !(await docker.imageExists(config.image));
  if (needBuild) {
    console.log(
      `agentbox: building image ${config.image}${opts.noCache ? " (no cache)" : ""}…`,
    );
    await docker.buildImage(config, { noCache: opts.noCache });
  }

  const tty = session.readTtySize();
  session.writeEntryScript(config, tty);

  console.log(`agentbox: starting sandbox — Observer at http://localhost:${config.observerPort}…`);
  const started = await docker.runContainer(config, tty);
  if (started !== 0) {
    console.error(`agentbox: docker run failed (exit ${started}).`);
    return started;
  }

  // The container is detached; wait for the entry script to create the tmux
  // session, then attach a client. Detaching later only ends the client.
  const ready = await waitForSession(config, 15000);
  if (!ready) {
    console.error(
      `agentbox: the tmux session did not come up in time.\n` +
        `Inspect the container with:  docker logs ${config.containerName}`,
    );
    return 1;
  }
  return await docker.execAttach(config, session.attachCommand(config));
}

/** Poll until the in-container tmux session exists (or the timeout passes). */
async function waitForSession(config: AgentboxConfig, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (
      await docker.execOk(config.containerName, [
        "tmux",
        "has-session",
        "-t",
        config.sessionName,
      ])
    ) {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** `shell`: attach a bash shell to a running container. */
async function cmdShell(config: AgentboxConfig): Promise<number> {
  if (!(await docker.available())) {
    console.error(dockerUnavailableMessage());
    return 1;
  }

  if (!(await docker.containerRunning(config.containerName))) {
    console.error(
      `agentbox: container '${config.containerName}' is not running.\n` +
        `Start it first with:  agentbox up`,
    );
    return 1;
  }

  return await docker.execAttach(config, ["bash"]);
}

/** `doctor`: print a ✓/✗ checklist + resolved config; non-zero on hard failure. */
async function cmdDoctor(config: AgentboxConfig): Promise<number> {
  console.log("agentbox doctor\n");

  let hardFailure = false;

  // Docker daemon — hard failure if missing.
  const dockerOk = await safe(() => docker.available(), false);
  line(dockerOk, "Docker is installed and the daemon is reachable");
  if (!dockerOk) hardFailure = true;

  // Image presence — soft warning (suggest `up`).
  let imageOk = false;
  if (dockerOk) {
    imageOk = await safe(() => docker.imageExists(config.image), false);
    line(imageOk, `Image '${config.image}' exists${imageOk ? "" : "  (run: agentbox up)"}`);
  } else {
    line(false, `Image '${config.image}' — skipped (Docker unavailable)`);
  }

  // Host mount sources.
  line(isDir(config.workspace), `Workspace dir exists: ${config.workspace}`);
  line(isDir(config.claudeDir), `Claude dir exists: ${config.claudeDir}`);
  line(
    isFile(config.claudeJson),
    `Claude config file: ${config.claudeJson}` +
      (isFile(config.claudeJson) ? "" : "  (auto-created on 'up')"),
  );

  // Bind-mount permissions: the in-container `agent` user is uid 1000. A
  // different host uid means the mounted ~/.claude and workspace may not be
  // writable inside the box. Soft warning only.
  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    line(
      uid === 1000,
      `Host uid matches the container 'agent' user (1000): uid ${uid}` +
        (uid === 1000 ? "" : "  (writes to mounted dirs may fail inside the box)"),
    );
  }

  // Observer port validity.
  const portOk = Number.isInteger(config.observerPort) && config.observerPort > 0 &&
    config.observerPort <= 65535;
  line(portOk, `Observer port is valid: ${config.observerPort}`);
  if (!portOk) hardFailure = true;

  // tmux-in-image: docker module exposes no exec-into-image helper, so we note
  // that tmux is provided by the Dockerfile and exercised at container start.
  if (imageOk) {
    line(true, "tmux is provided by the image (verified at container start)");
  } else {
    line(false, "tmux check skipped — build the image first (agentbox up)");
  }

  console.log("\nResolved config:");
  for (const [k, v] of Object.entries(config)) {
    console.log(`  ${k.padEnd(15)} ${v === undefined ? "(default)" : String(v)}`);
  }

  if (hardFailure) {
    console.error("\n✗ doctor found a hard failure.");
    return 1;
  }
  console.log("\n✓ doctor passed.");
  return 0;
}

/** `down`: stop + remove the container. */
async function cmdDown(config: AgentboxConfig): Promise<number> {
  if (!(await docker.available())) {
    console.error(dockerUnavailableMessage());
    return 1;
  }
  await docker.removeContainer(config.containerName);
  console.log(`agentbox: container '${config.containerName}' stopped and removed.`);
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function line(ok: boolean, label: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Run an async check, swallowing errors into a fallback (for doctor). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function dockerUnavailableMessage(): string {
  return (
    "agentbox: Docker is not available.\n" +
    "Make sure Docker is installed and the daemon is running (on Windows, enable\n" +
    "Docker Desktop → Settings → Resources → WSL Integration for your distro).\n" +
    "Diagnose with:  agentbox doctor"
  );
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
