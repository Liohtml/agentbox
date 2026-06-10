#!/usr/bin/env node
/**
 * agentbox launcher. Runs the TypeScript CLI through tsx without a build step.
 * Works whether tsx is installed locally (node_modules) or globally on PATH.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "index.ts");

const child = spawn("tsx", [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (err) => {
  if (err && err.code === "ENOENT") {
    console.error("agentbox: 'tsx' not found on PATH. Install it: npm i -g tsx");
    process.exit(127);
  }
  console.error("agentbox:", err.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
