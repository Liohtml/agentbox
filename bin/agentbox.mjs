#!/usr/bin/env node
/**
 * agentbox launcher. Runs the TypeScript CLI through tsx without a build step.
 * Works whether tsx is installed locally (node_modules) or globally on PATH.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "index.ts");

// Prefer the locally-installed tsx (node_modules/.bin) so a fresh clone works
// after just `npm install`, with no global tsx required. Fall back to PATH.
const isWin = process.platform === "win32";
const localTsx = resolve(
  here,
  "..",
  "node_modules",
  ".bin",
  isWin ? "tsx.cmd" : "tsx",
);
const useLocal = existsSync(localTsx);
const tsxCmd = useLocal ? localTsx : "tsx";

const child = spawn(tsxCmd, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
  shell: isWin && useLocal, // a .cmd shim needs a shell on Windows
});

child.on("error", (err) => {
  if (err && err.code === "ENOENT") {
    console.error(
      "agentbox: 'tsx' not found. Run 'npm install' in the agentbox repo, " +
        "or install it globally: npm i -g tsx",
    );
    process.exit(127);
  }
  console.error("agentbox:", err.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
