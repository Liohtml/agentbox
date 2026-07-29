/**
 * Tests for src/cli/index.ts — run()'s input rejection paths. All of these
 * return before any docker call, so they are Docker-free by construction:
 * help, unknown commands, unknown flags, stray positionals, and invalid
 * config values must fail fast with exit code 1 (0 for help).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/index.ts";

/** Capture console output while running argv through the router. */
async function runCapture(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  console.error = (...a: unknown[]) => errs.push(a.join(" "));
  try {
    const code = await run(argv);
    return { code, out: logs.join("\n"), err: errs.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

test("--help exits 0 and prints usage", async () => {
  const { code, out } = await runCapture(["--help"]);
  assert.equal(code, 0);
  assert.match(out, /agentbox/);
});

test("help <command> exits 0", async () => {
  const { code, out } = await runCapture(["help", "up"]);
  assert.equal(code, 0);
  assert.match(out, /up/);
});

test("unknown command exits 1 with a message", async () => {
  const { code, err } = await runCapture(["frobnicate"]);
  assert.equal(code, 1);
  assert.match(err, /unknown command 'frobnicate'/);
});

test("a typo'd flag is a hard error, not silently ignored", async () => {
  const { code, err } = await runCapture(["rebuild", "--no-cahce"]);
  assert.equal(code, 1);
  assert.match(err, /unknown flag/);
  assert.match(err, /--no-cahce/);
});

test("stray positionals after the command are rejected", async () => {
  const { code, err } = await runCapture(["up", "extra"]);
  assert.equal(code, 1);
  assert.match(err, /unexpected argument 'extra'/);
});

test("an invalid --port fails fast before any docker work", async () => {
  const { code, err } = await runCapture(["up", "--port", "abc"]);
  assert.equal(code, 1);
  assert.match(err, /--port must be an integer/);
});

test("an invalid --memory fails fast before any docker work", async () => {
  const { code, err } = await runCapture(["up", "--memory", "banana"]);
  assert.equal(code, 1);
  assert.match(err, /--memory/);
});

test("an explicitly requested workspace that does not exist is rejected", async () => {
  const { code, err } = await runCapture([
    "up",
    "--workspace",
    "/nonexistent/agentbox-test-dir-che3aihe",
  ]);
  assert.equal(code, 1);
  assert.match(err, /workspace directory does not exist/);
});
