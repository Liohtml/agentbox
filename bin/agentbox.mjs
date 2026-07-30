#!/usr/bin/env node
/**
 * agentbox launcher. Runs the TypeScript CLI through tsx without a build step.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "index.ts");
const localTsxCli = resolve(here, "..", "node_modules", "tsx", "dist", "cli.mjs");

if (!existsSync(localTsxCli)) {
  // tsx is a runtime dependency of agentbox (package.json), so this should
  // always be present after install. No shell-based global-PATH fallback:
  // that used to run `tsx` via a shell (required for the Windows .cmd shim),
  // which forwarded raw argv through cmd.exe with no metacharacter escaping.
  console.error(
    "agentbox: 'tsx' is missing from node_modules (expected at " +
      `${localTsxCli}).\n` +
      "Run 'npm install' to reinstall agentbox's dependencies.",
  );
  process.exit(127);
}

// Invoke tsx's JS entry with the current node binary directly — no shell, so
// paths with spaces are safe and no shell can interpret metacharacters in
// forwarded argv.
const child = spawn(process.execPath, [localTsxCli, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (err) => {
  console.error("agentbox:", err.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
