---
name: save-learnings
description: Save key insights from the current session to the right files. Combines technical insights (project PLAN.md) and workflow patterns (CLAUDE.md/memory). Auto-triggered at session end.
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
---

Review the current session and save anything worth keeping. Called automatically at session end, or manually with `/save-learnings`.

## Doc map — route findings here

| What | Where |
|------|-------|
| Non-obvious tool/build behavior, error+fix, arch decision | `~/projects/<proj>/PLAN.md` or `TECHNICAL_INSIGHTS.md` |
| System knowledge (audio, hyprland, packages, shell, networking) | `~/obsidian-vault/system/<topic>.md` |
| Dev knowledge (patterns, algorithms, encodings, frameworks) | `~/obsidian-vault/dev/<topic>.md` |
| Project status changed (phase done, new project, archived) | `~/projects/IDEAS.md` |
| Cross-project rule or gotcha for all future sessions | `~/.claude/CLAUDE.md` |

## Threshold — only save if:
- Something non-obvious was discovered (not "edited foo.py")
- It would save time or prevent confusion in a future session
- It isn't already documented

**Skip entirely if:** nothing technically interesting happened, it's already documented, or it's session-specific context with no future value.

## Steps

### 1. Review the session

Scan the conversation for:
- Errors encountered and how they were resolved
- Surprising behavior from tools, compilers, or packages
- Decisions made with non-obvious reasoning
- Patterns or rules that came up

### 2. Categorize

For each finding, route it using the doc map above. Key distinctions:
- System-level knowledge (OS, audio, display, packages) → obsidian-vault/system/
- Dev knowledge that applies beyond one project → obsidian-vault/dev/
- Project-specific → PLAN.md or TECHNICAL_INSIGHTS.md
- Universal cross-session rule → CLAUDE.md
- Not worth saving → skip

### 3. Write

- One-liners preferred — link to external docs if more detail needed
- Append to existing sections, don't restructure the whole file
- For CLAUDE.md: keep it under 50 new lines total — if adding something, consider removing something stale

### 4. Report

Tell the user what was saved and where. If nothing was worth saving, say so briefly.

## Examples of what to save

- "rustfmt not found → install via `rustup component add rustfmt`, not xbps"
- "pocket-tts cold start is ~9s, daemon amortizes this — keep daemon always running"
- "xbps-src checksum mismatch: trust the error output checksum, not locally computed one"
- "wob FIFO blocks if no reader — always use timeout wrapper"

## Examples of what NOT to save

- "edited foo.py to add feature X" — not a reusable insight
- "ran git commit" — not worth logging
- Already in CLAUDE.md or PLAN.md
