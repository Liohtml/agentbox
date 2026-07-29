/**
 * agentbox — docker module.
 *
 * Owns: image build, container run/exec, and host-mount preparation.
 * Implements the `DockerModule` contract from ../types.ts using only
 * node:child_process + node:fs (no external dependencies).
 *
 * CRITICAL: Claude Code OAuth fails inside Docker. Credentials come ONLY from
 * the host bind mounts (~/.claude dir + ~/.claude.json file). Auth is NEVER
 * baked into the image. The container runs as the non-root user `agent`.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AgentboxConfig,
  type DockerModule,
  type TtySize,
  CACHE_VOLUMES,
  CONTAINER_WORKSPACE,
  CONTAINER_CLAUDE_DIR,
  CONTAINER_CLAUDE_JSON,
  CONTAINER_ENTRY,
  CONTAINER_GH_CONFIG,
  CONTAINER_GITCONFIG,
  CONTAINER_OBSERVER,
} from "../types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Low-level spawn helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `docker <args>` capturing stdout/stderr. Never rejects: a spawn error
 * (e.g. docker not installed) resolves with code 127 so callers can treat it
 * as a benign "false" rather than throwing.
 */
function capture(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ code: 127, stdout: "", stderr: "" });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", () => {
      resolve({ code: 127, stdout, stderr });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Run `docker <args>` with the parent's stdio inherited so the user sees output
 * (build logs) and can interact (TTY). Resolves with the exit code; rejects only
 * if the process fails to spawn at all.
 */
function inherit(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("docker", args, { stdio: "inherit" });
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** True when a captured command exited 0. */
async function ok(args: string[]): Promise<boolean> {
  const { code } = await capture(args);
  return code === 0;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build the full `docker run` argv. Exported (and pure — host-fs facts are
 * injected via `present`) so tests can assert the exact argv without Docker.
 *
 * Detached (-d): the entry script — not a tmux attach client — is PID 1, so
 * detaching a client can never tear the sandbox down. Attaching is a separate
 * `docker exec` (execAttach).
 */
export function buildRunArgs(
  config: AgentboxConfig,
  tty: TtySize,
  present: { gitconfig: boolean; ghConfig: boolean },
): string[] {
  const args = [
    "run",
    "-d",
    "--rm",
    "--name",
    config.containerName,
    // ── bind mounts ──────────────────────────────────────────────────────
    "-v",
    `${config.workspace}:${CONTAINER_WORKSPACE}`,
    "-v",
    `${config.claudeDir}:${CONTAINER_CLAUDE_DIR}`,
    "-v",
    `${config.claudeJson}:${CONTAINER_CLAUDE_JSON}`,
    "-v",
    `${config.entryScriptPath}:${CONTAINER_ENTRY}`,
    "-v",
    `${config.observerAsset}:${CONTAINER_OBSERVER}`,
  ];

  // ── host identity, read-only, only when present (git commits + gh auth) ──
  if (present.gitconfig) {
    args.push("-v", `${config.gitconfigPath}:${CONTAINER_GITCONFIG}:ro`);
  }
  if (present.ghConfig) {
    args.push("-v", `${config.ghConfigDir}:${CONTAINER_GH_CONFIG}:ro`);
  }

  // ── persistent tool caches (named volumes; the box itself stays --rm) ───
  for (const [volume, target] of CACHE_VOLUMES) {
    args.push("-v", `${volume}:${target}`);
  }

  args.push(
    // ── published observer port (loopback only — never expose to the LAN) ─
    "-p",
    `127.0.0.1:${config.observerPort}:${config.observerPort}`,
    // ── resource limits ─────────────────────────────────────────────────
    "--memory",
    config.memory,
    "--cpus",
    config.cpus,
  );

  if (config.gpus) {
    args.push("--gpus", config.gpus);
  }

  args.push(
    // ── env ─────────────────────────────────────────────────────────────
    "-e",
    `OBSERVER_PORT=${config.observerPort}`,
    "-e",
    `COLUMNS=${tty.cols}`,
    "-e",
    `LINES=${tty.rows}`,
    config.image,
    // Launch via bash so a missing execute bit never blocks startup.
    "bash",
    CONTAINER_ENTRY,
  );
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module implementation
// ─────────────────────────────────────────────────────────────────────────────

export const docker: DockerModule = {
  async available(): Promise<boolean> {
    // `docker info` requires a reachable daemon; fall back to `docker version`.
    if (await ok(["info"])) return true;
    return ok(["version"]);
  },

  async imageExists(image: string): Promise<boolean> {
    return ok(["image", "inspect", image]);
  },

  async buildImage(
    config: AgentboxConfig,
    opts?: { noCache?: boolean },
  ): Promise<void> {
    const args = ["build"];
    if (opts?.noCache) args.push("--no-cache");
    // `--network host` runs RUN steps in the host network namespace — needed on
    // hosts whose default bridge can't reach the internet during the build.
    if (config.buildNetwork) args.push("--network", config.buildNetwork);
    args.push(
      "-t",
      config.image,
      "-f",
      config.dockerfile,
      config.buildContext,
    );
    const code = await inherit(args);
    if (code !== 0) {
      throw new Error(`docker build failed (exit ${code}) for image ${config.image}`);
    }
  },

  async containerExists(name: string): Promise<boolean> {
    const { stdout } = await capture([
      "ps",
      "-a",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.Names}}",
    ]);
    return stdout.trim().length > 0;
  },

  async containerRunning(name: string): Promise<boolean> {
    const { stdout } = await capture([
      "ps",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.Names}}",
    ]);
    return stdout.trim().length > 0;
  },

  async removeContainer(name: string): Promise<void> {
    // `rm -f` stops + removes. Ignore "no such container" (benign / idempotent),
    // but surface every other failure — otherwise `down` reports success while
    // the container still exists.
    const { code, stderr } = await capture(["rm", "-f", name]);
    if (code !== 0 && !/no such container/i.test(stderr)) {
      throw new Error(
        `docker rm -f ${name} failed (exit ${code})${stderr ? `: ${stderr.trim()}` : ""}`,
      );
    }
  },

  async ensureHostMounts(config: AgentboxConfig): Promise<void> {
    // workspace + claudeDir must be directories.
    fs.mkdirSync(config.workspace, { recursive: true });
    fs.mkdirSync(config.claudeDir, { recursive: true });

    // claudeJson must be a FILE so Docker bind-mounts a file (not a dir).
    let target: fs.Stats | undefined;
    try {
      target = fs.lstatSync(config.claudeJson);
    } catch {
      // Does not exist yet → create it below.
    }

    if (target?.isDirectory()) {
      // A prior bad mount can leave a directory here; Docker would happily
      // mount it and Claude Code would fail opaquely inside the container.
      throw new Error(
        `${config.claudeJson} is a directory, but Claude Code needs a file there.\n` +
          `Remove it (rmdir '${config.claudeJson}') and run agentbox again.`,
      );
    }

    if (target?.isSymbolicLink()) {
      // Dotfile managers often symlink ~/.claude.json. Follow it: if the
      // target exists we're done; if it dangles, create the target through
      // the symlink (flag "w" — "wx" would fail with a confusing EEXIST on
      // the link itself).
      try {
        fs.statSync(config.claudeJson);
      } catch {
        fs.writeFileSync(config.claudeJson, "{}\n", { flag: "w" });
      }
      return;
    }

    if (!target) {
      fs.mkdirSync(path.dirname(config.claudeJson), { recursive: true });
      // Create an empty JSON object so Claude Code reads valid JSON. "wx" +
      // ignored EEXIST keeps a concurrent create benign.
      try {
        fs.writeFileSync(config.claudeJson, "{}\n", { flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  },

  async runContainer(config: AgentboxConfig, tty: TtySize): Promise<number> {
    const args = buildRunArgs(config, tty, {
      gitconfig: isFile(config.gitconfigPath),
      ghConfig: isDir(config.ghConfigDir),
    });
    return inherit(args);
  },

  async execAttach(config: AgentboxConfig, command?: string[]): Promise<number> {
    const cmd = command ?? [
      "bash",
      "-lc",
      // Same '\'' single-quote escaping the session module uses — keeps a
      // future configurable session name injection-safe.
      `tmux attach -t '${config.sessionName.replace(/'/g, `'\\''`)}'`,
    ];
    const args = ["exec", "-it", config.containerName, ...cmd];
    return inherit(args);
  },

  async execOk(containerName: string, command: string[]): Promise<boolean> {
    return ok(["exec", containerName, ...command]);
  },

  async imageArchitecture(image: string): Promise<string | undefined> {
    const { code, stdout } = await capture([
      "image",
      "inspect",
      "--format",
      "{{.Architecture}}",
      image,
    ]);
    const arch = stdout.trim();
    return code === 0 && arch.length > 0 ? arch : undefined;
  },
};
