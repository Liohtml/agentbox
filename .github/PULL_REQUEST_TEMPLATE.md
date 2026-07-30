# What & why

<!-- What does this PR change, and why? -->

## Scope

<!-- Which module does this touch? Keep PRs scoped to one module/concern
     where possible (see CONTRIBUTING.md → Module ownership). -->

- [ ] `src/cli/` — arg parsing, help, config, command router
- [ ] `src/docker/` — image build, container run/exec, mounts
- [ ] `src/session/` — tmux entry script, TTY sizing
- [ ] `assets/` — Dockerfile / Observer
- [ ] `src/types.ts` / `CONTRACT.md` — contract change (explain below!)
- [ ] Docs / CI / meta

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] No build step, no new runtime dependencies (see CONTRIBUTING.md)
- [ ] Contract friction with `CONTRACT.md` / `src/types.ts` is described below (or n/a)

## Notes

<!-- What works, what's stubbed, any contract friction. -->
