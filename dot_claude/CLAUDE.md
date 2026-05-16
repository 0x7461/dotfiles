# Global Preferences
<!-- Last updated: 2026-05-09 -->

## System
- Void Linux (glibc), Hyprland, runit (not systemd). PipeWire audio. Catppuccin Macchiato theme.
- Custom packages: `~/void-packages` + `xi`. Official: `sudo xbps-install`.
- User runs all sudo commands themselves.

## Critical Rules
- **Monthly CC cleanup:** prune MEMORY.md scratchpad, review settings.json for stale flags, check CLAUDE.md is under 200 lines.

- **NEVER alter or delete files in ~/archive without explicit user permission.** No exceptions.
- IDEAS.md is **index only** — status + one-liner + link. No research blobs.
- This file: **soft limit 200 lines.** Be comprehensive on rules I've actually had to enforce — under-specified rules invite rationalization. Cut hedges, examples, and "for instance" padding ruthlessly. Quarterly trim pass.
- MEMORY.md: disposable scratchpad, 200-line hard truncation.
- **No `project_*.md` files in memory.** Memory is for behavior + cross-project reference only. Project-specific content goes to that project's PLAN.md.
- **No INSIGHTS.md / research.md / notes.md files anywhere.** They drift into stale shadow-docs. Deep internals: PLAN.md `## Internals` (narrative) or `agent_docs/<topic>.md` (imperative agent reference when AGENTS.md overflows). Per-project doc layout: see `## Documentation`.

## Documentation
- `~/projects/IDEAS.md` — project index (slim entries only)
- **Per-project doc tiers** (canonical spec: `~/projects/agent-docs/PLAN.md`):
  - `AGENTS.md` — agent-imperative. Setup, commands, layout, Boundaries (Always/Never/Ask first/Untested), workflows. Aim <150 lines, hard <300. Cross-tool standard.
  - `CLAUDE.md` — one-line `@AGENTS.md` shim. Always create alongside AGENTS.md.
  - `PLAN.md` — narrative. Status, Backlog, Decisions, Internals, Research, History. `Updated: YYYY-MM-DD` header. Soft limit ~300 lines, trim-on-done.
  - `README.md` — optional end-user docs. Skip for personal-use tools.
  - `agent_docs/<topic>.md` — only when imperative content overflows AGENTS.md.
- `~/obsidian-vault/system/*.md` — system knowledge | `dev/*.md` — dev knowledge
- `~/.claude/housekeeping-checklist.md` — trigger-based doc hygiene checklist

**Drift rule:** PLAN canonical for narrative/scope; AGENTS canonical for imperative rules. On overlap (same content needed in both): narrative wins, imperative becomes one-line pointer.

**On project resume:** skim PLAN.md, flag stale items.
**After tasks:** `/housekeeping` saves learnings + checks consistency.
**Trim-on-done:** when a roadmap item ships, collapse its detail block into one History line. Don't accumulate ✅-done blocks.
**Quality bar:** non-obvious only. Procedural steps. `⚠ untested` when applicable.

## Coding Behavior

**Before implementing:**
- State assumptions explicitly. If interpretations differ, present them — don't pick silently.
- If unclear or the approach seems wrong, stop and ask. Push back when warranted.
- Multi-step tasks: state a brief plan with verifiable steps before executing.

**While implementing:**
- Ask: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify first.
- Remove imports/vars/functions YOUR changes made unused. Pre-existing dead code: mention it, don't touch it.
- Every changed line should trace to the user's request. No drive-by improvements.

**Anti-rationalization** — when the urge to do one of these arises, the rebuttal is the rule:

| The lie | The rebuttal |
|---|---|
| "While I'm here, let me also fix this small adjacent thing" | Not the user's request. Note in response; don't touch. Drift is how 1-line bugfixes become 200-line PRs. |
| "More error handling makes it more robust" | Only at boundaries (user input, external APIs). Internal validation is noise that hides real failures. |
| "This needs a comment to explain what it does" | Fix the names instead. Comments rot; names are enforced by usage. |
| "Let me search/read first to be safe" (when intent is clear) | Just do the task. Verification before action is a distinct request, not a default. |
| "I should match the existing pattern" | Only if the existing pattern is correct. Match-blindly propagates mistakes. Flag, don't propagate. |
| "Let me add a test for this small change" | Only if the user asked or the project has a test discipline I can see. Drive-by tests are scope creep. |
| "I'll rewrite this section from memory" | Read the source first (don't reconstruct). Default to Edit for targeted changes; reach for a Bash script only when the mutation is mechanical across many files or the script is itself the clearest spec. Self-review the diff before confirming. |

**Learning projects (no-agent zone):** For learning-tagged ideas (#48–53 and similar in IDEAS.md), pair-write rather than generate. Explain trade-offs aloud; don't accept generated code without modifying it. These exist precisely to keep the writing-code muscle alive — agentic mode defeats their purpose.

## Workflow
**Before non-trivial tasks:** read PLAN.md first. Ask approach (skip for ops tasks). Research-heavy work goes in PLAN.md `## Research` section, not a separate file. **Also: glance at `git status` — if the repo has dirty/untracked work from a prior session, surface it and ask whether to commit before starting; don't pile a new feature onto stale uncommitted work.**

**While working:**
- Bash: separate tool calls, never chain `&&` (bypasses allow list).
- Prefer Glob/Grep/Read over subagents when 2-3 calls suffice.
- **Read target file and related files before any edit.** Never edit from assumptions or memory alone.
- No sycophantic openers or closing fluff. Terse by default.
- Recommend starting a new session when switching to an unrelated task.

**Evidence as exit step:** Every implementation task ends with verifiable evidence — file path, test output, working command, or a concrete artifact. "Done" without evidence is incomplete. If the work can't be verified (e.g. UI feature, no test runner), say so explicitly rather than implying success.

**Escalate when struggling — don't grind silently.** Name the obstacle in one sentence, then suggest:
- Stronger model — if on Sonnet/Haiku/Fast, recommend switching to Opus 4.7
- Higher effort — if a skill or session lowered effort below default high, recommend bumping back
- Fresh session — if context is muddied or off-track
- Warn if the task is shaping up to need 20+ tool calls.

**Usage:** remind `/usage` at start of substantial sessions.

## Output Format

**Use HTML when** the output is a terminal artifact — read once, shared, or interacted with (reports, dashboards, design explorations, PR explainers, throwaway editors with export buttons). HTML unlocks SVG, color, tables, interactions that Markdown can't express.

**Use Markdown when** the file lives in context long-term, gets re-edited, or is version-controlled (PLAN.md, AGENTS.md, SKILL.md, log files). HTML diffs are noisy and each re-edit pass compounds document corruption.

**The test:** "Will this be re-edited?" → Markdown. "Will this be read or used once?" → HTML.

## Toolchain
- **proto** manages runtimes (Go, Python, Node, Bun, uv) — never system package manager.
- **uv** for Python (not pip/venv). **rustup** for Rust (not proto).

## Known Gotchas
- **SSH key:** `~/.ssh/id_ed25519_gh`. Always `git@github.com:` URLs. Handled by `~/.ssh/config` — no `GIT_SSH_COMMAND` needed.
- **chezmoi secret detection:** exit 1 but file IS added. Edit `.tmpl` to replace secret with `{{ .varName }}`, store in `chezmoi.toml [data]`.
- **chezmoi mode bits:** can't represent group-writable per-file ([#769](https://github.com/twpayne/chezmoi/issues/769)); the `umask` config var (currently `0o002`) is the workaround. Mode-only drift in `chezmoi status` is usually history (older CC builds / external editors writing under umask 022); `chezmoi apply` chmods to match source. Distinguish from content drift in housekeeping.
- **Skills:** `~/.claude/skills/<name>/SKILL.md`. Must `ToolSearch select:<ToolName>` before calling deferred tools. Aim ≤100 lines; split overflow to `REFERENCE.md` / topic files. Skill `description` format: "What it does. Use when [triggers]."
- **settings.local.json:** Edit tool fails mid-edit — always use Write tool.
- **History lookups:** `history.jsonl` is 9MB+ — never Read it. Filter via `Bash python3 -c` or recap.py.
- **runit user services:** `~/service/`, not `/var/service/`. `SVDIR=~/service sv <cmd>`.
- **`claude -p` subprocess:** unset `CLAUDECODE` env, set `cmd.Dir=/tmp`, `--allowedTools ""` for chat mode. Add `--bare` to skip CLAUDE.md/settings discovery (up to 10x faster for non-interactive use).
- **CC repo (anthropics/claude-code):** closed-source — only CHANGELOG.md exists, no source code. Don't search it for internals; use the binary at `~/.local/share/claude/versions/`.
- **CC settings not in chezmoi:** `~/.claude/settings.json` — add manually after reinstall. (`statusline.sh` IS in chezmoi.)
- **`summarize` fallbacks:** if a YouTube call returns empty, try `--youtube yt-dlp` then bump `--model sonnet` or `flash`. Gemini 2.5 Pro is broken (empty output); skip it. Full recovery path in `~/.claude/skills/summarize/SKILL.md`. `--markdown-mode llm` is for `--extract --format md`, not the summary call.
