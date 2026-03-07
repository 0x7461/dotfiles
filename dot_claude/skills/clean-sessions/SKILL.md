---
name: clean-sessions
description: Clean old Claude Code session files, keeping only the most recently active session and the memory/ directory.
user-invocable: true
allowed-tools:
  - Bash
---

Clean old Claude Code session files for `~/.claude/projects/-home-ta/`, keeping only the most recently modified session (assumed active) and the `memory/` directory.

## Steps

### 1. Dry run — show what would be deleted

```sh
bash ~/.local/bin/claude-clean-sessions --dry-run
```

Show the output to the user.

### 2. Confirm

Ask the user: "Delete these sessions?" (yes/no).

### 3. If confirmed — delete

```sh
bash ~/.local/bin/claude-clean-sessions
```

Report how many sessions were removed.

### 4. If declined

Tell the user nothing was deleted.

## Notes

- The script accepts an optional path argument for a different project directory.
- `--dry-run` previews without deleting.
- Always keep `memory/` — it holds persistent notes across sessions.
