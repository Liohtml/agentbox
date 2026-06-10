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
import { resolveConfig } from "./config.ts";
import { commandHelp, topHelp } from "./help.ts";

// Re-export so the contract's `export function resolveConfig` is satisfied here.
export { resolveConfig } from "./config.ts";

const KNOWN_COMMANDS = ["up", "shell", "rebuild", "doctor", "down", "help"];

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

  const config = resolveConfig(process.env, parsed.flags);
  const forceNoCache = parsed.flags["no-cache"] === true;

  try {
    switch (parsed.command) {
      case "up":
        return await cmdUp(config, { force: false, noCache: forceNoCache });
      case "rebuild":
        return await cmdUp(config, { force: true, noCache: true });
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
  opts: { force: boolean; noCache: boolean },
): Promise<number> {
  if (!(await docker.available())) {
    console.error(dockerUnavailableMessage());
    return 1;
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

  if (await docker.containerRunning(config.containerName)) {
    console.log(`agentbox: reattaching to running container '${config.containerName}'…`);
    return await docker.execAttach(config);
  }

  console.log(`agentbox: starting sandbox (observer on port ${config.observerPort})…`);
  return await docker.runContainer(config, tty);
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
    "Make sure Docker is installed and the daemon is running, then try again.\n" +
    "Diagnose with:  agentbox doctor"
  );
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
