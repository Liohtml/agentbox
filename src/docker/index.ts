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
  CONTAINER_WORKSPACE,
  CONTAINER_CLAUDE_DIR,
  CONTAINER_CLAUDE_JSON,
  CONTAINER_ENTRY,
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
    // `rm -f` stops + removes. Ignore "no such container" (benign / idempotent).
    await capture(["rm", "-f", name]);
  },

  async ensureHostMounts(config: AgentboxConfig): Promise<void> {
    // workspace + claudeDir must be directories.
    fs.mkdirSync(config.workspace, { recursive: true });
    fs.mkdirSync(config.claudeDir, { recursive: true });

    // claudeJson must be a FILE so Docker bind-mounts a file (not a dir).
    // Edge case: a prior bad mount may have created it as a directory — leave
    // that alone (can't safely rm), but ensure a file exists if nothing does.
    let needsTouch = true;
    try {
      const st = fs.statSync(config.claudeJson);
      if (st.isFile()) needsTouch = false;
      // If it's a directory we cannot turn it into a file here; leave as-is.
      else if (st.isDirectory()) needsTouch = false;
    } catch {
      // Does not exist yet → create it below.
    }
    if (needsTouch) {
      fs.mkdirSync(path.dirname(config.claudeJson), { recursive: true });
      // Create an empty JSON object so Claude Code reads valid JSON.
      fs.writeFileSync(config.claudeJson, "{}\n", { flag: "wx" });
    }
  },

  async runContainer(config: AgentboxConfig, tty: TtySize): Promise<number> {
    const args = [
      "run",
      "-it",
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
      // ── published observer port ─────────────────────────────────────────
      "-p",
      `${config.observerPort}:${config.observerPort}`,
      // ── resource limits ─────────────────────────────────────────────────
      "--memory",
      config.memory,
      "--cpus",
      config.cpus,
      // ── env ─────────────────────────────────────────────────────────────
      "-e",
      `OBSERVER_PORT=${config.observerPort}`,
      "-e",
      `COLUMNS=${tty.cols}`,
      "-e",
      `LINES=${tty.rows}`,
    ];
    args.push(
      config.image,
      // Launch via bash so a missing execute bit never blocks startup.
      "bash",
      CONTAINER_ENTRY,
    );
    return inherit(args);
  },

  async execAttach(config: AgentboxConfig, command?: string[]): Promise<number> {
    const cmd =
      command ?? ["bash", "-lc", `tmux attach -t ${config.sessionName}`];
    const args = ["exec", "-it", config.containerName, ...cmd];
    return inherit(args);
  },
};
