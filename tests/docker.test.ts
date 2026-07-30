/**
 * Tests for src/docker/index.ts — buildRunArgs, the pure `docker run` argv
 * builder. Host-filesystem facts (gitconfig / gh config presence) are
 * injected, so these tests need no Docker daemon and no real files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunArgs } from "../src/docker/index.ts";
import {
  CACHE_VOLUMES,
  CONTAINER_ENTRY,
  CONTAINER_GH_CONFIG,
  CONTAINER_GITCONFIG,
  CONTAINER_OBSERVER,
  CONTAINER_WORKSPACE,
  LABEL_YOLO,
  type AgentboxConfig,
  type TtySize,
} from "../src/types.ts";

function baseConfig(over: Partial<AgentboxConfig> = {}): AgentboxConfig {
  return {
    workspace: "/home/u/proj",
    claudeDir: "/home/u/.claude",
    claudeJson: "/home/u/.claude.json",
    image: "agentbox:latest",
    containerName: "agentbox",
    sessionName: "agentbox",
    observerPort: 4317,
    memory: "4g",
    cpus: "4",
    yolo: false,
    gitconfigPath: "/home/u/.gitconfig",
    ghConfigDir: "/home/u/.config/gh",
    dockerfile: "/repo/assets/Dockerfile",
    buildContext: "/repo/assets",
    observerAsset: "/repo/assets/observer.mjs",
    entryScriptPath: "/tmp/agentbox-1000/entry.sh",
    ...over,
  };
}

const TTY: TtySize = { cols: 120, rows: 40 };
const NONE = { gitconfig: false, ghConfig: false };

/** The value following a given -v/-p/... occurrence of `flag`. */
function valuesOf(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag) out.push(args[i + 1]);
  }
  return out;
}

test("runs detached (-d), never interactive: the entry script must be PID 1", () => {
  const args = buildRunArgs(baseConfig(), TTY, NONE);
  assert.ok(args.includes("-d"));
  assert.ok(!args.includes("-it"));
});

test("does NOT use --rm: a container that exits early must stay inspectable via docker logs", () => {
  const args = buildRunArgs(baseConfig(), TTY, NONE);
  assert.ok(!args.includes("--rm"));
});

test("mounts workspace, claude dir/json, entry script and observer", () => {
  const mounts = valuesOf(buildRunArgs(baseConfig(), TTY, NONE), "-v");
  assert.ok(mounts.includes(`/home/u/proj:${CONTAINER_WORKSPACE}`));
  assert.ok(mounts.includes("/home/u/.claude:/home/agent/.claude"));
  assert.ok(mounts.includes("/home/u/.claude.json:/home/agent/.claude.json"));
  assert.ok(mounts.includes(`/tmp/agentbox-1000/entry.sh:${CONTAINER_ENTRY}`));
  assert.ok(mounts.includes(`/repo/assets/observer.mjs:${CONTAINER_OBSERVER}`));
});

test("labels the container with its --yolo startup state (for accurate reattach reporting)", () => {
  const off = valuesOf(buildRunArgs(baseConfig(), TTY, NONE), "--label");
  assert.deepEqual(off, [`${LABEL_YOLO}=false`]);
  const on = valuesOf(buildRunArgs(baseConfig({ yolo: true }), TTY, NONE), "--label");
  assert.deepEqual(on, [`${LABEL_YOLO}=true`]);
});

test("publishes the observer port on loopback ONLY", () => {
  const ports = valuesOf(buildRunArgs(baseConfig({ observerPort: 5000 }), TTY, NONE), "-p");
  assert.deepEqual(ports, ["127.0.0.1:5000:5000"]);
});

test("mounts the tool-cache named volumes", () => {
  const mounts = valuesOf(buildRunArgs(baseConfig(), TTY, NONE), "-v");
  for (const [volume, target] of CACHE_VOLUMES) {
    assert.ok(mounts.includes(`${volume}:${target}`), `${volume} must be mounted`);
  }
});

test("mounts git identity and gh auth READ-ONLY, and only when present", () => {
  const none = valuesOf(buildRunArgs(baseConfig(), TTY, NONE), "-v");
  assert.ok(!none.some((m) => m.includes(".gitconfig")));
  assert.ok(!none.some((m) => m.includes("/gh")));

  const both = valuesOf(
    buildRunArgs(baseConfig(), TTY, { gitconfig: true, ghConfig: true }),
    "-v",
  );
  assert.ok(both.includes(`/home/u/.gitconfig:${CONTAINER_GITCONFIG}:ro`));
  assert.ok(both.includes(`/home/u/.config/gh:${CONTAINER_GH_CONFIG}:ro`));
});

test("applies resource limits and env", () => {
  const args = buildRunArgs(baseConfig({ memory: "8g", cpus: "2" }), TTY, NONE);
  assert.deepEqual(valuesOf(args, "--memory"), ["8g"]);
  assert.deepEqual(valuesOf(args, "--cpus"), ["2"]);
  const env = valuesOf(args, "-e");
  assert.ok(env.includes("OBSERVER_PORT=4317"));
  assert.ok(env.includes("COLUMNS=120"));
  assert.ok(env.includes("LINES=40"));
});

test("--gpus is passed through only when set", () => {
  assert.deepEqual(valuesOf(buildRunArgs(baseConfig(), TTY, NONE), "--gpus"), []);
  assert.deepEqual(
    valuesOf(buildRunArgs(baseConfig({ gpus: "all" }), TTY, NONE), "--gpus"),
    ["all"],
  );
});

test("image and entry command come last: … <image> bash /agentbox/entry.sh", () => {
  const args = buildRunArgs(baseConfig(), TTY, NONE);
  assert.deepEqual(args.slice(-3), ["agentbox:latest", "bash", CONTAINER_ENTRY]);
});
