/**
 * Tests for src/cli/resolveConfig — precedence (flag > env > default), port
 * parsing, and path defaults. Pure, Docker-free logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { resolveConfig, validateConfig } from "../src/cli/config.ts";
import { DEFAULTS } from "../src/types.ts";

/** A clean env with none of the agentbox override vars set. */
function emptyEnv(): NodeJS.ProcessEnv {
  return {};
}

test("defaults apply when no flags or env are set", () => {
  const c = resolveConfig(emptyEnv(), {});
  assert.equal(c.image, DEFAULTS.image);
  assert.equal(c.containerName, DEFAULTS.containerName);
  assert.equal(c.sessionName, DEFAULTS.sessionName);
  assert.equal(c.observerPort, DEFAULTS.observerPort);
  assert.equal(c.memory, DEFAULTS.memory);
  assert.equal(c.cpus, DEFAULTS.cpus);
});

test("workspace defaults to cwd (resolved absolute)", () => {
  const c = resolveConfig(emptyEnv(), {});
  assert.equal(c.workspace, path.resolve(process.cwd()));
});

test("env overrides default", () => {
  const c = resolveConfig({ MEM: "8g", CPUS: "2" }, {});
  assert.equal(c.memory, "8g");
  assert.equal(c.cpus, "2");
});

test("flag overrides env (and default)", () => {
  const c = resolveConfig({ MEM: "8g" }, { memory: "16g" });
  assert.equal(c.memory, "16g");
});

test("workspace precedence: flag > env > cwd", () => {
  const flagWins = resolveConfig({ WORKSPACE: "/from/env" }, { workspace: "/from/flag" });
  assert.equal(flagWins.workspace, path.resolve("/from/flag"));

  const envWins = resolveConfig({ WORKSPACE: "/from/env" }, {});
  assert.equal(envWins.workspace, path.resolve("/from/env"));
});

test("workspace is always resolved to an absolute path", () => {
  const c = resolveConfig(emptyEnv(), { workspace: "relative/dir" });
  assert.ok(path.isAbsolute(c.workspace));
  assert.equal(c.workspace, path.resolve("relative/dir"));
});

test("port flag is parsed to a number", () => {
  const c = resolveConfig(emptyEnv(), { port: "5000" });
  assert.equal(c.observerPort, 5000);
  assert.equal(typeof c.observerPort, "number");
});

test("port defaults to 4317 when no flag is given", () => {
  const c = resolveConfig(emptyEnv(), {});
  assert.equal(c.observerPort, 4317);
});

test("boolean presence of a value flag is ignored (not coerced to a string)", () => {
  // parser yields `true` when a value flag is missing its value; config's str()
  // helper must treat that as absent and fall through to env/default.
  const c = resolveConfig({ MEM: "8g" }, { memory: true });
  assert.equal(c.memory, "8g");
});

test("buildNetwork: flag > env, unset → undefined", () => {
  assert.equal(resolveConfig(emptyEnv(), {}).buildNetwork, undefined);
  assert.equal(resolveConfig({ DOCKER_NETWORK: "host" }, {}).buildNetwork, "host");
  assert.equal(
    resolveConfig({ DOCKER_NETWORK: "bridge" }, { network: "host" }).buildNetwork,
    "host",
  );
});

test("yolo is opt-in only (boolean flag), gpus passes through", () => {
  assert.equal(resolveConfig(emptyEnv(), {}).yolo, false);
  assert.equal(resolveConfig(emptyEnv(), { yolo: true }).yolo, true);
  assert.equal(resolveConfig(emptyEnv(), {}).gpus, undefined);
  assert.equal(resolveConfig(emptyEnv(), { gpus: "all" }).gpus, "all");
});

test("git identity / gh auth candidate paths default under home", () => {
  const home = os.homedir();
  const c = resolveConfig(emptyEnv(), {});
  assert.equal(c.gitconfigPath, path.join(home, ".gitconfig"));
  assert.equal(c.ghConfigDir, path.join(home, ".config", "gh"));
});

test("claude paths default under the home directory", () => {
  const home = os.homedir();
  const c = resolveConfig(emptyEnv(), {});
  assert.equal(c.claudeDir, path.join(home, ".claude"));
  assert.equal(c.claudeJson, path.join(home, ".claude.json"));
});

test("asset paths point at the repo's assets dir and Dockerfile", () => {
  const c = resolveConfig(emptyEnv(), {});
  assert.ok(path.isAbsolute(c.dockerfile));
  assert.equal(path.basename(c.dockerfile), "Dockerfile");
  assert.equal(path.basename(c.buildContext), "assets");
  assert.equal(path.basename(c.observerAsset), "observer.mjs");
});

test("entryScriptPath lives in a per-user subdir of the OS temp dir (not a fixed shared path)", () => {
  const c = resolveConfig(emptyEnv(), {});
  const dir = path.dirname(c.entryScriptPath);
  assert.equal(path.dirname(dir), os.tmpdir());
  assert.match(path.basename(dir), /^agentbox-/);
  assert.equal(path.basename(c.entryScriptPath), "entry.sh");
  // Must not be the old world-shared fixed path.
  assert.notEqual(c.entryScriptPath, path.join(os.tmpdir(), "agentbox-entry.sh"));
});

// ── validateConfig ──────────────────────────────────────────────────────────

test("validateConfig passes a default config", () => {
  assert.deepEqual(validateConfig(resolveConfig(emptyEnv(), {})), []);
});

test("validateConfig rejects a non-numeric port", () => {
  const problems = validateConfig(resolveConfig(emptyEnv(), { port: "abc" }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /--port/);
});

test("validateConfig rejects out-of-range ports", () => {
  assert.equal(validateConfig(resolveConfig(emptyEnv(), { port: "0" })).length, 1);
  assert.equal(validateConfig(resolveConfig(emptyEnv(), { port: "70000" })).length, 1);
  assert.equal(validateConfig(resolveConfig(emptyEnv(), { port: "4317.5" })).length, 1);
});

test("validateConfig rejects malformed --memory and --cpus", () => {
  assert.match(validateConfig(resolveConfig(emptyEnv(), { memory: "banana" }))[0], /--memory/);
  assert.match(validateConfig(resolveConfig(emptyEnv(), { cpus: "four" }))[0], /--cpus/);
});

test("validateConfig accepts common docker resource formats", () => {
  for (const memory of ["4g", "512m", "1024K", "2000000"]) {
    assert.deepEqual(validateConfig(resolveConfig(emptyEnv(), { memory })), [], memory);
  }
  for (const cpus of ["4", "1.5", "0.5"]) {
    assert.deepEqual(validateConfig(resolveConfig(emptyEnv(), { cpus })), [], cpus);
  }
});

test("validateConfig rejects ':' in mount source paths (docker -v delimiter)", () => {
  const problems = validateConfig(
    resolveConfig(emptyEnv(), { workspace: "/home/u/proj:v2" }),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /workspace/);
});
