---
name: housekeeping
description: End-of-session doc hygiene — save learnings, check consistency, flag stale docs. Merges save-learnings + consistency checking.
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
---

Review the session, save findings, and verify doc/config/service consistency. Replaces `/save-learnings`.

## Steps

### 1. Load required tools

Call `ToolSearch` with query `select:Bash,Edit,Write,Glob,Grep,Read` to load deferred tools.

### 2. Read the checklist

Read `~/.claude/housekeeping-checklist.md` for the current trigger-based checks.

### 3. Detect what changed this session

Scan the conversation for:
- Which projects were touched (code, config, or discussion)
- Whether system configs changed (hyprland, fish, mpv, etc.)
- Whether services were modified (runit run scripts, .env files)
- Errors encountered and how they were resolved
- Surprising behavior or non-obvious decisions

### 4. Save learnings (from save-learnings)

For each non-obvious finding, route it:

| What | Where |
|------|-------|
| Build/tool behavior, error+fix, arch decision | `~/projects/<proj>/PLAN.md` |
| Deep reverse-engineering or API internals | `~/projects/<proj>/PLAN.md` `## Internals` section (no separate INSIGHTS.md — see CLAUDE.md) |
| System knowledge (audio, hyprland, packages) | `~/obsidian-vault/system/<topic>.md` |
| Dev knowledge (patterns, algorithms, frameworks) | `~/obsidian-vault/dev/<topic>.md` |
| Project status changed | `~/projects/IDEAS.md` (index entry only — keep it slim) |
| Cross-project rule or gotcha | `~/.claude/CLAUDE.md` |

**Threshold:** only save if genuinely non-obvious and would save time in a future session. Skip if already documented or session-specific.

**Format:** procedural steps over descriptions. Mark untested: `⚠ untested`. Add/update `Updated: YYYY-MM-DD` at the bottom of modified docs.

### 5. Run relevant checklist sections

Based on what changed, run the matching sections from the checklist:

**If code changed in a project:**
- Check PLAN.md has an `Updated:` date within the last 7 days
- Check IDEAS.md status is still accurate

**If config files changed:**
- Run `chezmoi status 2>&1 | head -20` to detect unmanaged drift
- Check if the relevant obsidian-vault/system/ note exists and is current

**If services were touched:**
- Run `SVDIR=~/service sv status` on affected services
- Check log dirs exist

**If T7 Shield is mounted** (`/run/media/ta/T7 Shield/` exists):
- Run the "T7 vault inbox sweep" section from the checklist — surface stale items in `_inbox/unsorted/` (>90 days), interrupted imports in `_inbox/imports/` (>30 days), and pending cleanup backups in `_meta/` (>14 days). Don't auto-delete; report.

**Always (session end):**
- Check MEMORY.md line count (`wc -l`)
- Check if checklist itself needs review (>30 days since `Last reviewed:` date)

### 6. Report

Output a concise summary:
```
## Housekeeping Report

### Saved
- <what was saved and where, or "Nothing worth saving">

### Checked
- <what was verified, any issues found>

### Stale / Action needed
- <anything that needs attention, or "All clear">
```

### 7. Self-revision check

If the checklist's `Last reviewed:` date is >30 days old, append:
```
### Checklist review due
The housekeeping checklist hasn't been reviewed in >30 days. Run `/housekeeping` with `--review-checklist` to update it.
```

## What NOT to save

- Code patterns derivable from reading current source
- Git history (use `git log` / `git blame`)
- Debugging solutions (the fix is in the code, commit message has context)
- Anything already in CLAUDE.md or PLAN.md
- Ephemeral task details or current conversation context

## Token budget

This skill should complete in <15 tool calls. If nothing interesting happened, say so in 2 lines and stop. Don't manufacture findings.
