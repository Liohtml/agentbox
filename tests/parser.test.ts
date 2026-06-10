/**
 * Tests for src/cli/parser.ts — arg/flag/positional parsing, help detection,
 * and the default command. Pure, Docker-free logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli/parser.ts";

test("defaults to 'up' when only flags are present", () => {
  const p = parseArgs(["--port", "5000"]);
  assert.equal(p.command, "up");
  assert.equal(p.hasExplicitCommand, false);
  assert.equal(p.flags.port, "5000");
});

test("defaults to 'up' on empty argv", () => {
  const p = parseArgs([]);
  assert.equal(p.command, "up");
  assert.equal(p.hasExplicitCommand, false);
  assert.deepEqual(p.positionals, []);
});

test("first positional is the command", () => {
  const p = parseArgs(["doctor"]);
  assert.equal(p.command, "doctor");
  assert.equal(p.hasExplicitCommand, true);
  assert.deepEqual(p.positionals, ["doctor"]);
});

test("--flag value form consumes the next token", () => {
  const p = parseArgs(["up", "--workspace", "/tmp/proj"]);
  assert.equal(p.command, "up");
  assert.equal(p.flags.workspace, "/tmp/proj");
});

test("--flag=value form is parsed inline", () => {
  const p = parseArgs(["up", "--workspace=/tmp/proj", "--port=9000"]);
  assert.equal(p.flags.workspace, "/tmp/proj");
  assert.equal(p.flags.port, "9000");
});

test("boolean flags take no value", () => {
  const p = parseArgs(["rebuild", "--no-cache"]);
  assert.equal(p.command, "rebuild");
  assert.equal(p.flags["no-cache"], true);
});

test("a value flag missing its value records boolean presence", () => {
  // --workspace at the end with no following token.
  const p = parseArgs(["up", "--workspace"]);
  assert.equal(p.flags.workspace, true);
});

test("a value flag followed by another flag does not consume it", () => {
  const p = parseArgs(["up", "--workspace", "--port", "4000"]);
  // workspace had no real value (next token is a flag) → boolean presence.
  assert.equal(p.flags.workspace, true);
  assert.equal(p.flags.port, "4000");
});

test("-h sets help and helpRequested", () => {
  const p = parseArgs(["-h"]);
  assert.equal(p.flags.help, true);
  assert.equal(p.helpRequested, true);
});

test("--help anywhere sets helpRequested", () => {
  const p = parseArgs(["up", "--help"]);
  assert.equal(p.helpRequested, true);
});

test("no help flag → helpRequested false", () => {
  const p = parseArgs(["up"]);
  assert.equal(p.helpRequested, false);
});

test("bare -- ends flag parsing; rest is positional", () => {
  const p = parseArgs(["up", "--", "--port", "extra"]);
  assert.equal(p.command, "up");
  assert.deepEqual(p.positionals, ["up", "--port", "extra"]);
  // --port after -- is NOT a flag.
  assert.equal(p.flags.port, undefined);
});

test("unknown short flag is recorded so the router can complain", () => {
  const p = parseArgs(["up", "-x"]);
  assert.equal(p.flags.x, true);
});

test("multiple positionals preserve order (e.g. help <command>)", () => {
  const p = parseArgs(["help", "doctor"]);
  assert.equal(p.command, "help");
  assert.deepEqual(p.positionals, ["help", "doctor"]);
});

test("network flag value is captured", () => {
  const p = parseArgs(["up", "--network", "host"]);
  assert.equal(p.flags.network, "host");
});
