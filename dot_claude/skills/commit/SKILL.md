---
name: commit
description: Smart git commit — stages relevant files, drafts a commit message from the diff, and commits. Handles the full workflow so you don't have to.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

Create a git commit for the current repository. Optionally accepts a message hint or scope (e.g. `/commit fix login bug` or just `/commit`).

## Steps

### 1. Check repo state

```sh
git -C <cwd> status --short
git -C <cwd> diff HEAD
```

If there are no changes (clean tree), tell the user and stop.

### 2. Review what's changed

Read the diff carefully. Categorize the changes:
- **feat** — new feature or capability
- **fix** — bug fix
- **docs** — documentation only
- **chore** — build, config, deps, tooling, non-functional changes
- **refactor** — restructuring without behavior change
- **style** — formatting, whitespace
- **test** — adding or updating tests

### 3. Stage files

Stage all modified and new tracked files. Do NOT use `git add -A` blindly — check for files that should NOT be committed:
- `.env`, `*.secret`, `*credentials*`, `*.key` — warn and skip
- Large binaries or build artifacts — skip unless they're clearly intentional
- Files unrelated to the current change set — ask before including

```sh
git add <specific files>
```

### 4. Draft the commit message

Format: `<type>: <short summary>` (under 72 chars)

- Use present tense imperative ("add", "fix", "update", not "added", "fixing")
- Summary should complete the sentence "this commit will..."
- If the user provided a hint, use it to guide the summary but rewrite it cleanly

If the change is significant and touches multiple areas, add a body paragraph after a blank line explaining the "why".

### 5. Commit

```sh
git commit -m "$(cat <<'EOF'
<type>: <summary>

[optional body]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### 6. Confirm

Show the commit hash and one-line summary after success:
```sh
git log -1 --oneline
```

## Rules

- NEVER amend a commit unless the user explicitly asks
- NEVER use `--no-verify`
- NEVER push — commit only
- If a pre-commit hook fails, fix the issue and create a NEW commit
- If unsure which files to stage, show the list and ask before committing
- For monorepos or multi-project dirs, confirm the correct `git` root first
