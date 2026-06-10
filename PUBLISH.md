# Publishing `agentbox` to GitHub

Step-by-step to publish this directory as the **public** repo
`Liohtml/agentbox`. Run everything from the repo root:

```bash
cd ~/sandbox/workspace/agentbox
```

Requirements: `git`, and the GitHub CLI `gh` (v2.87+) authenticated as
`Liohtml` (`gh auth status` should show ✓ Logged in). All these tools are
already present and authenticated on this machine.

---

## 0. Prerequisite: git identity (only if unset)

The publish creates a commit, so git needs a name and email. Check, and set if
blank:

```bash
git config user.name   # if empty, set it:
git config user.email  # if empty, set it:

git config user.name  "Lio"
git config user.email "lionel.machire@googlemail.com"
```

(Use `--global` instead of bare flags if you want it applied for all repos.)

---

## 1. Publish (primary path)

### 1a. If this is NOT yet a git repo

```bash
git init -b main
git add -A
git commit -m "Initial commit: agentbox CLI"
```

### 1b. If it IS already a git repo

This directory is already initialized (branch `master`, with an initial
commit). Just rename the branch to `main` and capture any uncommitted work:

```bash
git branch -M main
git add -A
git commit -m "Add project metadata: license, CI, contributing, gitignore" || echo "nothing to commit"
```

### 1c. Create the remote repo and push (one command)

```bash
gh repo create Liohtml/agentbox \
  --public \
  --source=. \
  --remote=origin \
  --description "One-command, Docker-isolated agentic coding sandbox: tmux + Claude Code (Agent Teams) + web Observer." \
  --push
```

This creates `github.com/Liohtml/agentbox`, wires it up as the `origin`
remote, and pushes the current branch in a single step.

---

## 2. Fallback (if `gh repo create --push` fails partway)

Create the empty repo, then add the remote and push manually:

```bash
# Create the empty public repo (no push):
gh repo create Liohtml/agentbox \
  --public \
  --description "One-command, Docker-isolated agentic coding sandbox: tmux + Claude Code (Agent Teams) + web Observer."

# Wire up origin (only if it isn't already set):
git remote add origin https://github.com/Liohtml/agentbox.git
# If origin already exists, update it instead:
#   git remote set-url origin https://github.com/Liohtml/agentbox.git

# Push and set upstream:
git push -u origin main
```

---

## 3. Verify

```bash
git remote -v                 # origin → github.com/Liohtml/agentbox
git log --oneline -1          # the commit you just pushed
gh repo view Liohtml/agentbox # repo summary in the terminal
gh repo view --web            # open the repo in a browser
```

You should see the public repo at <https://github.com/Liohtml/agentbox> with
`node_modules/` excluded (via `.gitignore`) and `package-lock.json` tracked.
