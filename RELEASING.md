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

6. The `release.yml` workflow runs on the `v*` tag: it re-runs all checks and
   publishes to npm with `--provenance --access public`.
7. **Create a GitHub Release** from the tag, pasting the changelog section.

## npm notes

- The package is published **scoped** as `@liohtml/agentbox` (the bare name
  `agentbox` is an npm security placeholder and cannot be claimed). The
  installed command is still `agentbox`.
- Publishing requires the `NPM_TOKEN` repository secret (or npm Trusted
  Publishing configured for this repo), plus `id-token: write` for provenance.
- `prepublishOnly` re-runs typecheck + tests as a local safety net.
