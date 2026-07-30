# Releasing

How to cut a release of `@liohtml/agentbox`. npm publishing is intended to be
done from CI via the tag-triggered release workflow — not from a laptop.

## Checklist

1. **Ensure `main` is green.** CI (typecheck, tests, pack smoke test) must pass.
2. **Bump the version** in `package.json` (semver) and update the lockfile:

   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```

3. **Update `CHANGELOG.md`:** move entries from *Unreleased* into a new
   `## [x.y.z] — YYYY-MM-DD` section.
4. **Commit and push** the version bump + changelog on `main` (via PR).
5. **Tag and push the tag:**

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

6. The `release.yml` workflow runs on the `v*` tag: it verifies the tag matches
   `package.json`'s version, re-runs typecheck/test, runs the `npm pack`
   tarball smoke test, then publishes to npm with
   `--provenance --access public`. Any of those failing blocks the publish.
7. **Create a GitHub Release** from the tag, pasting the changelog section.

## npm notes

- The package is published **scoped** as `@liohtml/agentbox` (the bare name
  `agentbox` is an npm security placeholder and cannot be claimed). The
  installed command is still `agentbox`.
- Publishing authenticates with the `NPM_TOKEN` repository secret
  (`NODE_AUTH_TOKEN` in the workflow), plus `id-token: write` for provenance.
  Migrating to npm Trusted Publishing (OIDC, no long-lived token) is a good
  follow-up but isn't configured yet — don't assume it's active.
- `prepublishOnly` re-runs typecheck + tests as a local safety net.
- Dependency caching is deliberately **off** in the release workflow (unlike
  CI): a compromised or poisoned npm/GitHub Actions cache must never be able
  to influence what gets published.
