---
name: agent-docs-init
description: Scaffold the per-project doc tier (AGENTS.md + @AGENTS.md CLAUDE.md shim + PLAN.md) from the canonical spec at ~/projects/agent-docs/PLAN.md. Use when starting a new project under ~/projects/, when an idea graduates from IDEAS.md to a real project, or when an existing project needs the agent-docs tier added.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

Scaffold per-project agent docs (`AGENTS.md` + `CLAUDE.md` shim + `PLAN.md`) according to the canonical spec.

## Steps

### 1. Locate the project

Resolve the target project dir:

- If args given: `/agent-docs-init <project-slug>` → `~/projects/<slug>/`.
- If no args: use current working dir, but only if it's under `~/projects/`. Otherwise ask.

```sh
[ -d "$PROJECT_DIR" ] || { echo "no such dir"; exit 1; }
ls "$PROJECT_DIR"/{AGENTS.md,CLAUDE.md,PLAN.md} 2>/dev/null
```

**Gate:** if any of the three exist, list them and stop. Do not clobber. Ask the user whether to skip existing / overwrite / abort.

### 2. Read the canonical spec

Read `~/projects/agent-docs/PLAN.md` sections `## The doc tiers (canonical spec)` — this is the single source of truth for what each file should contain. Do not invent structure; mirror the spec.

### 3. Gather project context

Detect signals to fill placeholders intelligently:

```sh
# Language detection
ls "$PROJECT_DIR"/*.{go,py,rs,ts,js} "$PROJECT_DIR"/{Cargo.toml,go.mod,pyproject.toml,package.json} 2>/dev/null

# Git age
git -C "$PROJECT_DIR" log -1 --format=%cs 2>/dev/null   # last commit date
git -C "$PROJECT_DIR" log --reverse --format=%cs 2>/dev/null | head -1   # first commit

# Existing IDEAS.md entry
grep -A 3 "^## .*$(basename $PROJECT_DIR)" ~/projects/IDEAS.md 2>/dev/null
```

Use detected language to pick example commands (uv/cargo/go/bun); use git dates for `Created:` / `Updated:`.

### 4. Generate the three files

For each file, mirror the canonical sections from the spec. Where project-specific content is unknown, use `<!-- TODO: ... -->` markers — explicit holes the user will fill, not invented placeholders that read as real.

**`AGENTS.md` skeleton** (sections from spec):
- Title + `Updated:` + 1-paragraph overview *(TODO)*
- Audience pointer block (README/PLAN/agent_docs)
- Setup *(infer from detected language)*
- Commands *(infer test/build/lint per language)*
- Project layout *(scan top-level dirs and annotate)*
- Boundaries & gotchas (Always/Never/Ask first/Untested) — pre-populate one Never item, rest are TODO blocks:
  - **Never:** rewrite existing content from memory. Copy verbatim, make targeted edits, self-review for unauthorized mutations. Escalate to the user only when uncertain whether a change is intentional.
- **Services** *(only if the project owns runit services)* — one `` - `name`: state — note `` bullet per service; `persistent` = up and survives reboot (reconciled by `maint-watch doctor`; see spec)
- **Teardown** *(when the project has runtime/installed state to remove)* — scaffold the frame from the spec: *local* removal (stop/remove service, data paths), *de-declare* the Services block, *portfolio* retirement (IDEAS → Archived, PLAN History line, cross-ref sweep), *dependents*. Generic boilerplate ships ready; italic per-project slots (service name, data paths, dependents) are TODO.
- Where to look — pointers to README/PLAN

**`CLAUDE.md`** — exactly one line:
```
@AGENTS.md
```

**`PLAN.md` skeleton** (sections from spec):
- Title + `Created:` + `Updated:` *(from git or today)*
- 1-paragraph blurb + audience pointer block *(TODO blurb)*
- `## Status` *(TODO)*
- `## Backlog` *(empty)*
- `## Internals` *(TODO)*
- `## Decisions` *(empty)*
- `## History` *(empty; one starter line: "YYYY-MM-DD — Project scaffolded")*

### 5. Show + confirm

Print all three files for review before writing. Ask: "Write these to `<PROJECT_DIR>`?" Wait for confirmation.

### 6. Write + next steps

Write the three files. Then tell the user:

- Fill the `<!-- TODO -->` markers in AGENTS.md (the Boundaries section is the load-bearing one)
- If this is a graduating idea, update its IDEAS.md entry: status → `Implement`, add `**PLAN:**` link to the new PLAN.md
- If it's a code-bearing repo, also consider `git add` + commit the three new files together

## Notes

- The canonical spec lives in `~/projects/agent-docs/PLAN.md`. **Always read it fresh** at step 2 — never cache the structure in this skill, since the spec evolves.
- For non-code projects (knowledge bases, idea-only dirs), AGENTS.md is usually overkill. Suggest skipping it unless the user explicitly wants the full tier.
- For private/personal repos where PLAN.md will be gitignored, AGENTS.md must be self-sufficient — note this in step 5 before writing.
