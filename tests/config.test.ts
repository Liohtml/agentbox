/**
 * Tests for src/cli/resolveConfig — precedence (flag > env > default), port
 * parsing, and path defaults. Pure, Docker-free logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/cli/config.ts";
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

test("entryScriptPath lives under the OS temp dir", () => {
  const c = resolveConfig(emptyEnv(), {});
  assert.equal(c.entryScriptPath, path.join(os.tmpdir(), "agentbox-entry.sh"));
});
