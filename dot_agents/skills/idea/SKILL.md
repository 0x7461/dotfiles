---
name: idea
description: Add a new entry to ~/projects/IDEAS.md or update an existing one. Use when the user says "add this to the idea bank" or wants to update an idea's status/details.
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Glob
---

Add or update an entry in `~/projects/IDEAS.md`.

Usage examples:
- `/idea phone mirroring - use phone from laptop` — add new idea
- `/idea update #6 status Maintain` — update an existing idea's status
- `/idea #13 add note: pocket-tts daemon is faster than expected` — append a note to an idea

## Principle (read before drafting)

IDEAS.md is an **index**, not a research repository. Per `~/.claude/CLAUDE.md`:

> IDEAS.md is **index only** — status + one-liner + link. No research blobs.

Before writing the entry, classify what the user gave you:

- **Index-worthy** — title + 1–2 sentence hook + status + (optional) PLAN.md link. Goes in the entry.
- **Project-worthy** — research notes, design rationale, candidate libs with deep notes, code sketches. Goes in the project's `PLAN.md` (or `~/projects/<slug>/PLAN.md` if scaffolded), not IDEAS.md.
- **Vault-worthy** — system/dev knowledge that outlives the idea. Goes in `~/obsidian-vault/system/` or `dev/`.

If the user dumped a long brain-dump, **acknowledge what's worth keeping where**, then write only the index-worthy slice into IDEAS.md.

## Steps

### 1. Read the ideas file

Always read `~/projects/IDEAS.md` first to understand the current structure, highest ID, and relevant context.

### 2. Determine the action

**Adding new idea:**
- Assign the next sequential ID (highest existing ID + 1)
- Pick the appropriate status: usually `Idea` for new entries
- Format: `## <N>. <Title>`

**Updating existing idea:**
- Find the correct entry by ID or title keyword
- If the entry has a `**PLAN:**` link, read that file first — the PLAN may already reflect the change the user is asking about, or contradict it
- Apply the requested change (status, note, details, etc.)

### 3. Write the entry

**New idea format:**
```markdown
## <N>. <Title>

**Status:** Idea | **Language:** TBD | **Type:** <type>

<One or two sentence description of the idea and why it's interesting.>

**Candidates to research:** (if applicable)
- [tool](url) — brief note

*Details: Not started*
```

**Status values:** `Idea → Research → Implement → Maintain → Archived`

**Type examples:** CLI Tool, TUI Application, System Integration, Web Application, Mobile Application, Config/Tooling, Library/Framework, Knowledge Base, Learning/Fun

### 4. Place the entry correctly

- New ideas go before the `## Tools to Watch` section (after the last numbered `##` entry)
- Keep the `---` separator between entries
- Do NOT modify the Prioritization, Clusters, or Tools to Watch sections unless explicitly asked

### 5. Confirm

Tell the user what was added/updated and the ID assigned.

## Notes

- Keep `short_desc` under one line — save details for `*Details:*` pointer or project PLAN.md
- For tools that are just "worth watching" (no active project intent), add to the `## Tools to Watch` section instead of a numbered entry
- Do not add duplicate ideas — scan existing entries first
