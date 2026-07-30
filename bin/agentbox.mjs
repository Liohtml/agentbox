#!/usr/bin/env node
/**
 * agentbox launcher. Runs the TypeScript CLI through tsx without a build step.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "index.ts");

// Locate tsx's cli entry via Node's real module resolution (createRequire),
// not a hand-constructed path: npm may hoist tsx to the CONSUMER project's
// top-level node_modules instead of nesting it under agentbox's own
// node_modules (e.g. `npm install <agentbox tarball>` in another project),
// so `<here>/../node_modules/tsx/...` doesn't always exist even though tsx
// is installed. require.resolve() walks up node_modules the same way Node
// itself does, so it finds tsx wherever it actually landed. Resolving
// "tsx/package.json" (not "tsx/dist/cli.mjs") because tsx's `exports` map
// only allows that subpath — deep-importing dist/cli.mjs by specifier would
// throw ERR_PACKAGE_PATH_NOT_EXPORTED even though the file exists on disk.
const require = createRequire(import.meta.url);
let localTsxCli;
try {
  localTsxCli = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
} catch {
  localTsxCli = undefined;
}

if (!localTsxCli) {
  // tsx is a runtime dependency of agentbox (package.json), so this should
  // always be resolvable after install. No shell-based global-PATH fallback:
  // that used to run `tsx` via a shell (required for the Windows .cmd shim),
  // which forwarded raw argv through cmd.exe with no metacharacter escaping.
  console.error(
    "agentbox: could not resolve 'tsx' (a runtime dependency of agentbox).\n" +
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
