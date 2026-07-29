/**
 * Tests for assets/observer.mjs — the critical correctness invariant is that
 * the server binds 0.0.0.0 (NOT 127.0.0.1), or Docker's published port is
 * unreachable from the host browser.
 *
 * observer.mjs starts an HTTP server on import (top-level listen), so we assert
 * via static source analysis rather than importing it (which would bind a port).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OBSERVER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "observer.mjs",
);
const src = readFileSync(OBSERVER, "utf8");

test("binds 0.0.0.0 (all interfaces), not loopback", () => {
  assert.match(src, /const HOST\s*=\s*["']0\.0\.0\.0["']/);
});

test("does NOT bind 127.0.0.1 / localhost as the listen host", () => {
  // The HOST constant must not be loopback. (localhost may appear in a log
  // hint for the user, but never as the bound interface.)
  assert.doesNotMatch(src, /const HOST\s*=\s*["']127\.0\.0\.1["']/);
  assert.doesNotMatch(src, /const HOST\s*=\s*["']localhost["']/);
});

test("listen() is called with PORT and the HOST interface", () => {
  assert.match(src, /server\.listen\(\s*PORT\s*,\s*HOST/);
});

test("reads the port from OBSERVER_PORT with a 4317 default", () => {
  assert.match(src, /process\.env\.OBSERVER_PORT\s*\|\|\s*4317/);
});

test("exposes a /healthz endpoint", () => {
  assert.match(src, /["']\/healthz["']/);
});

test("HTML-escapes project and session names before innerHTML (stored-XSS guard)", () => {
  // The client script must define an escaper and route both interpolated
  // fields through it — project/session names are attacker-influencable
  // filesystem names from inside the container.
  assert.match(src, /const esc\s*=/);
  assert.match(src, /esc\(s\.project\)/);
  assert.match(src, /esc\(s\.session/);
});

test("handles server 'error' events instead of dying with an unhandled exception", () => {
  assert.match(src, /server\.on\(\s*["']error["']/);
  assert.match(src, /EADDRINUSE/);
});

test("falls back to the default port when OBSERVER_PORT is not a valid port", () => {
  assert.match(src, /Number\.isInteger\(RAW_PORT\)/);
});
