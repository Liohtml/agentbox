/**
 * agentbox — config resolution.
 *
 * Precedence: flag > env > default. Defaults & constants come from types.ts.
 * Repo-relative asset paths are computed from this file's location (src/cli/ →
 * up two levels = repo root).
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentboxConfig, DEFAULTS } from "../types.ts";

/** Repo root = two levels up from src/cli/. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Return a flag value only if it is a real string (ignore boolean presence). */
function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Per-user temp directory for the generated entry script. A fixed path in the
 * shared, world-writable temp dir would let another local user pre-create or
 * swap the script that gets bind-mounted (and executed) inside the container;
 * a user-owned subdirectory (created 0700 by the session module) closes that.
 */
function entryScriptDir(): string {
  const info = os.userInfo();
  const who = info.uid >= 0 ? String(info.uid) : info.username.replace(/[^\w.-]/g, "_");
  return path.join(os.tmpdir(), `agentbox-${who}`);
}

export function resolveConfig(
  env: NodeJS.ProcessEnv,
  flags: Record<string, string | boolean>,
): AgentboxConfig {
  const home = os.homedir();

  const workspace = str(flags.workspace) ?? env.WORKSPACE ?? process.cwd();
  const memory = str(flags.memory) ?? env.MEM ?? DEFAULTS.memory;
  const cpus = str(flags.cpus) ?? env.CPUS ?? DEFAULTS.cpus;

  const portRaw = str(flags.port);
  const observerPort = portRaw !== undefined ? Number(portRaw) : DEFAULTS.observerPort;

  // Optional build network (e.g. "host"). Unset → Docker's default.
  const buildNetwork = str(flags.network) ?? env.DOCKER_NETWORK ?? undefined;

  // Opt-in only — never default a permission bypass on.
  const yolo = flags.yolo === true;
  const gpus = str(flags.gpus);

  return {
    workspace: path.resolve(workspace),
    claudeDir: path.join(home, ".claude"),
    claudeJson: path.join(home, ".claude.json"),
    image: DEFAULTS.image,
    containerName: DEFAULTS.containerName,
    sessionName: DEFAULTS.sessionName,
    observerPort,
    memory,
    cpus,
    buildNetwork,
    yolo,
    gpus,
    gitconfigPath: path.join(home, ".gitconfig"),
    ghConfigDir: path.join(home, ".config", "gh"),
    dockerfile: path.join(REPO_ROOT, "assets", "Dockerfile"),
    buildContext: path.join(REPO_ROOT, "assets"),
    observerAsset: path.join(REPO_ROOT, "assets", "observer.mjs"),
    entryScriptPath: path.join(entryScriptDir(), "entry.sh"),
  };
}

/**
 * Validate a resolved config before any Docker work happens, so bad input
 * fails fast with a clear message instead of surfacing as a cryptic docker
 * error after a minutes-long image build. Returns a list of problems
 * (empty = valid).
 */
export function validateConfig(config: AgentboxConfig): string[] {
  const problems: string[] = [];

  if (
    !Number.isInteger(config.observerPort) ||
    config.observerPort < 1 ||
    config.observerPort > 65535
  ) {
    problems.push(
      `--port must be an integer between 1 and 65535 (got '${config.observerPort}')`,
    );
  }

  // Docker accepts e.g. "4g", "512m", "1024k", "1000000b" or plain bytes.
  if (!/^\d+(\.\d+)?[bkmg]?$/i.test(config.memory)) {
    problems.push(`--memory must look like '4g', '512m' or a byte count (got '${config.memory}')`);
  }

  if (!/^\d+(\.\d+)?$/.test(config.cpus)) {
    problems.push(`--cpus must be a number, e.g. '4' or '1.5' (got '${config.cpus}')`);
  }

  // ':' is Docker's -v field delimiter; a mount source containing it would
  // silently produce a wrong/invalid mount spec.
  for (const [label, p] of [
    ["workspace", config.workspace],
    ["claude dir", config.claudeDir],
    ["claude config file", config.claudeJson],
  ] as const) {
    if (p.includes(":")) {
      problems.push(`${label} path must not contain ':' (Docker mount delimiter): ${p}`);
    }
  }

  return problems;
}
