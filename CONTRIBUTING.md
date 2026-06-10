# Contributing to agentbox

Thanks for your interest in improving **agentbox** — a one-command,
Docker-isolated agentic coding sandbox (tmux + Claude Code Agent Teams + a web
Observer on `:4317`).

## Project constraints (read first)

agentbox is a TypeScript CLI run directly with [`tsx`](https://github.com/privatenumber/tsx) — there is **no build step**.

- **No build / no bundling.** Source runs as-is via `tsx`. Do not add a compile
  step or commit compiled output.
- **ESM only.** `package.json` has `"type": "module"`. Use `import`/`export`,
  not `require`.
- **Explicit `.ts` extensions on relative imports.** e.g.
  `import { docker } from "../docker/index.ts";` — this is required for the
  tsx/ESM resolver. Always include the extension.
- **Node `>=22`.** The CI runs on Node 22; please develop against it.

## Running locally

```bash
npm install            # install dev deps (tsx, typescript, @types/node)

# Run the CLI (default command is `up`):
node bin/agentbox.mjs up
# or via the package script:
npm run agentbox -- up

# Quick environment smoke test (no Docker daemon needed for most checks):
node bin/agentbox.mjs doctor

npm run typecheck      # tsc --noEmit
npm test               # run the test suite
```

`npm run typecheck` and `npm test` must both pass before opening a PR — these
are exactly what CI enforces on every push and pull request.

## Module ownership

This repo is built in parallel against the locked contract in
[`CONTRACT.md`](CONTRACT.md) and [`src/types.ts`](src/types.ts). Respect the
boundaries below — do not edit another module's files in a PR that isn't about
that module.

| Path                  | Responsibility                                            |
|-----------------------|-----------------------------------------------------------|
| `src/types.ts`        | Shared types & constants. Change-request only.            |
| `src/index.ts`        | Thin entry → `cli.run()`.                                 |
| `bin/agentbox.mjs`    | Launcher (spawns tsx).                                     |
| `assets/observer.mjs` | Bundled Observer web server.                              |
| `src/cli/`            | Arg parsing, `--help`, config resolution, command router. |
| `src/docker/`         | Image build, container run/exec, host-mount prep.         |
| `assets/Dockerfile`   | The image definition.                                     |
| `src/session/`        | tmux entry-script generation, TTY sizing.                 |
| `README.md`           | User-facing docs.                                         |

Dependency rule: `cli` imports `{ docker }` and `{ session }`; `docker` and
`session` must **not** import `cli` (no cycles). They may import `../types.ts`
only.

## Pull requests

1. Branch off `main`.
2. Keep the change scoped to one module/concern where possible.
3. Ensure `npm run typecheck` and `npm test` pass locally.
4. Describe what works, what's stubbed, and any contract friction in the PR
   description.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
