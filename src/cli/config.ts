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
    dockerfile: path.join(REPO_ROOT, "assets", "Dockerfile"),
    buildContext: path.join(REPO_ROOT, "assets"),
    observerAsset: path.join(REPO_ROOT, "assets", "observer.mjs"),
    entryScriptPath: path.join(os.tmpdir(), "agentbox-entry.sh"),
  };
}
