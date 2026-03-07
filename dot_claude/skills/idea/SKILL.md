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

- New ideas go before the `## Prioritization` section (after the last numbered `##` entry)
- Keep the `---` separator between entries
- Do NOT modify the Prioritization, Clusters, or Tools to Watch sections unless explicitly asked

### 5. Confirm

Tell the user what was added/updated and the ID assigned.

## Notes

- Keep `short_desc` under one line — save details for `*Details:*` pointer or project PLAN.md
- For tools that are just "worth watching" (no active project intent), add to the `## Tools to Watch` section instead of a numbered entry
- Do not add duplicate ideas — scan existing entries first
