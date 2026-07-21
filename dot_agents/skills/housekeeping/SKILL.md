---
name: housekeeping
description: End-of-session doc hygiene — review the session, save non-obvious findings, run trigger-based checks. Use when the user says /housekeeping, "save learnings", or "wrap up the session".
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
---

Review the session, save findings, and verify doc/config/service consistency.

## Steps

### 1. Load tools and checklist

`ToolSearch` query `select:Bash,Edit,Write,Glob,Grep,Read`, then read `~/.claude/housekeeping-checklist.md`.

**Gate:** do not proceed to step 2 until the checklist is in context — its trigger sections drive step 4.

### 2. Detect what changed this session

Scan the conversation for: projects touched (code/config/discussion), system configs changed, services modified, errors+resolutions, surprising or non-obvious decisions.

**Gate:** if nothing non-obvious happened, skip steps 3–4 and report "Nothing worth saving" in step 5. Don't manufacture findings.

### 3. Save learnings

For each non-obvious finding, route to the right home. **Before writing to a project's `PLAN.md` or `AGENTS.md`, skim the existing file** — match the existing section structure, terminology, and `## History` format rather than inventing a new shape.

Procedural format, mark `⚠ untested` when applicable, refresh `Updated:` dates:

| What | Where |
|------|-------|
| Build/tool behavior, error+fix, arch decision | `~/projects/<proj>/PLAN.md` |
| Deep reverse-engineering or API internals | `~/projects/<proj>/PLAN.md ## Internals` |
| Imperative agent rules | `~/projects/<proj>/AGENTS.md` |
| System knowledge | `~/obsidian-vault/system/<topic>.md` |
| Dev knowledge | `~/obsidian-vault/dev/<topic>.md` |
| Project status changed | `~/projects/IDEAS.md` (slim entry — link to PLAN.md) |
| Cross-project rule or gotcha | `~/.claude/CLAUDE.md` |
| New shared-vocab term (codename / alias / abbrev) | `~/obsidian-vault/system/glossary.md` (public) · `~/.claude/pii-aliases.local.md` (PII — never synced/always-loaded) |

**Threshold:** only save if non-obvious AND would save time in a future session. Skip if derivable from `git log`, already in CLAUDE.md/PLAN.md, or session-specific.

### 4. Run matching checklist sections

Run only the sections in `housekeeping-checklist.md` whose triggers fired this session (code-changes / config-changes / service-changes / T7-mounted / always). The checklist is canonical; do not duplicate its commands here.

**Gate:** if a check surfaces drift you can fix safely (stale `Updated:` dates, missing `@AGENTS.md` shim, mode-only chezmoi noise), fix it inline rather than just reporting. See [feedback memory](../../projects/-home-ta/memory/feedback_fix_stale_items.md).

### 5. Report

```
## Housekeeping Report

### Saved
- <what was saved and where, or "Nothing worth saving">

### Checked
- <what was verified; issues found and resolved>

### Stale / Action needed
- <anything that needs user attention, or "All clear">
```

### 6. Self-revision

If `housekeeping-checklist.md` `Last reviewed:` is >30 days old, append a "Checklist review due" line at the end of the report.

## Token budget

Should complete in <15 tool calls. Two-line response is a valid outcome when nothing happened.
