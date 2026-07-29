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

// Prefer the locally-installed tsx so a fresh clone (or the published
// package, where tsx is a runtime dependency) works with no global tsx.
// Invoke tsx's JS entry with the current node binary instead of the .bin
// shim: no shell involved, so paths with spaces and cmd.exe metacharacters
// can never break or inject (the .cmd shim needed shell:true on Windows).
const isWin = process.platform === "win32";
const localTsxCli = resolve(here, "..", "node_modules", "tsx", "dist", "cli.mjs");
const useLocal = existsSync(localTsxCli);

const child = useLocal
  ? spawn(process.execPath, [localTsxCli, entry, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
    })
  : spawn("tsx", [entry, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
      shell: isWin, // PATH fallback: a global tsx is a .cmd shim on Windows
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
