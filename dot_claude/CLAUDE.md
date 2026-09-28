# Global Preferences
<!-- Last updated: 2026-05-24 -->

## System
- Void Linux (glibc), niri (Wayland, scrollable-tiling, KDL config), runit (not systemd). PipeWire audio. Catppuccin Macchiato theme. hyprlock kept as lock screen.
- Custom packages: `~/void-packages` + `xi`. Official: `sudo xbps-install`.
- User runs all sudo commands themselves.

## Critical Rules
- **Monthly CC cleanup:** run `~/.claude/scripts/memcheck.py` (index/name/link integrity), review settings.json for stale flags, check CLAUDE.md is under 200 lines (Anthropic's documented target — longer reduces adherence).

- **NEVER alter or delete files in ~/archive without explicit user permission.** No exceptions.
- IDEAS.md is **index only** — status + one-liner + link. No research blobs.
- This file: **soft limit 200 lines.** Be comprehensive on rules I've actually had to enforce — under-specified rules invite rationalization. Cut hedges, examples, and "for instance" padding ruthlessly.
- MEMORY.md is **index only** — one line per memory (`- [Title](file.md) — hook`). Memory bodies live in their own file; never park content in the index. **Hard cap: 200 lines OR 25KB, whichever hits first** — CC loads only that much and silently drops the rest at session start, so overflow = lost memories, no error. At ~169 bytes/entry the **byte limit binds first (~148 entries)**, well before 200 lines. `maint-watch` checks both. Don't mirror harness-supplied facts (model IDs, tool names) there — they only go stale.
- **No `project_*.md` files in memory.** Memory is for behavior + cross-project reference only. Project-specific content goes to that project's PLAN.md.
- **No INSIGHTS.md / research.md / notes.md files anywhere.** They drift into stale shadow-docs. Deep internals: PLAN.md `## Internals` (narrative) or `agent_docs/<topic>.md` (imperative agent reference when AGENTS.md overflows). Per-project doc layout: see `## Documentation`.
- **Glossary / aliases (#56):** public terms (codenames, tools, abbrevs) load globally via `~/.claude/rules/glossary.md` (→ synced vault `system/glossary.md`). **PII aliases** (people/places/real identities) live ONLY in local, un-synced `~/.claude/pii-aliases.local.md` — read it **on-demand** to resolve a real name/place, **only on private-tier models** (Anthropic/CC or local Ollama); **never read or surface it on DeepSeek/non-private backends** (they train on data), and never add it to chezmoi or the vault.

## Documentation
- `~/projects/IDEAS.md` — project index (slim entries only)
- **Per-project doc tiers** (canonical spec: `~/projects/agent-docs/PLAN.md`):
  - `AGENTS.md` — agent-imperative. Setup, commands, layout, Boundaries (Always/Never/Ask first/Untested), workflows. Aim <150 lines, hard <300. Cross-tool standard.
  - `CLAUDE.md` — one-line `@AGENTS.md` shim. Always create alongside AGENTS.md.
  - `PLAN.md` — narrative. Status, Backlog, Decisions, Internals, Research. `Updated: YYYY-MM-DD` header. **Soft limit 24,000 chars** (~6,150 tokens) — chars not lines, because lines hide dense tables; trim-on-done. **Backlog items are `- [ ]` checkboxes** (one per top-level item; sub-bullets plain; shipped items removed → HISTORY.md, never `- [x]`).
  - `HISTORY.md` — PLAN.md's `## History`, split out once it passes ~3,000 chars or PLAN.md passes 22,000. **No size cap; grep it, never Read it whole** (same rule as `history.jsonl`). One dated bullet per entry, newest first; leave a `## History` stub in PLAN.md. Not a shadow-doc — one owner, one copy.
  - `README.md` — optional end-user docs. Skip for personal-use tools.
  - `agent_docs/<topic>.md` — only when imperative content overflows AGENTS.md.
- `~/obsidian-vault/system/*.md` — system knowledge | `dev/*.md` — dev knowledge
- `~/.claude/housekeeping-checklist.md` — trigger-based doc hygiene checklist

**Drift rule:** PLAN canonical for narrative/scope; AGENTS canonical for imperative rules. On overlap (same content needed in both): narrative wins, imperative becomes one-line pointer.

**On project resume:** skim PLAN.md, flag stale items.
**After tasks:** `/housekeeping` saves learnings + checks consistency.
**Trim-on-done:** when a roadmap item ships, collapse its detail block into one History line. Don't accumulate ✅-done blocks.
**Quality bar:** non-obvious only. Procedural steps. `⚠ untested` when applicable.

## Workflow
Portable rules (Coding Behavior, the rest of Workflow, Output Format) live in `~/.claude/rules/behaviour.md`, loaded globally. This section keeps the parts tied to this machine and its project layout.

**Before non-trivial tasks:** read PLAN.md first. Ask approach (skip for ops tasks). Research-heavy work goes in PLAN.md `## Research` section, not a separate file. **Also: glance at `git status` — if the repo has dirty/untracked work from a prior session, surface it and ask whether to commit before starting; don't pile a new feature onto stale uncommitted work.**

**While working:**
- **Commands the user must run themselves** (sudo, interactive): tee output to a file in the session scratchpad (fish: `cmd &| tee $out/name.txt`) and read it. Tee, not plain redirect — silent commands look hung. Never ask them to paste long output back.
- **Git commits:** commit proactively when a logical unit is done (completed feature/fix; before a rebase, feature-switch, or `/housekeeping`) — **don't wait to be asked.** Push only when asked; branch first if on the default branch. Trailer `Co-Authored-By: <model-code-name>` (e.g. `Opus`) — code name only, no version, no email.

**Learning projects (no-agent zone):** For learning-tagged ideas (#48–53 and similar in IDEAS.md), pair-write rather than generate. Explain trade-offs aloud; don't accept generated code without modifying it. These exist precisely to keep the writing-code muscle alive — agentic mode defeats their purpose.

## Toolchain
- **mise** manages Go + Node (global pins `~/.config/mise/config.toml`, per-project `mise.toml`) — never system package manager. npm globals install to `~/.local` (`~/.npmrc` prefix) so they survive Node upgrades.
- **uv** owns all Python: interpreters (`python-preference = "only-managed"`), venvs, tools — never pip/venv/mise. Pin a minor version per project in a tracked `.python-version`; default latest stable. uv itself is the xbps package. **rustup** for Rust (not mise).

## Known Gotchas
- **SSH key:** `~/.ssh/id_ed25519_gh`. Always `git@github.com:` URLs. Handled by `~/.ssh/config` — no `GIT_SSH_COMMAND` needed.
- **Never `ssh -t host 'sudo cmd' > file`.** `-t` merges the remote's stderr into the pty, so the redirect swallows the sudo prompt: it hangs with no output, reading as a network fault rather than a password prompt you can't see. To pull a root-owned remote file, copy it first, then fetch: `ssh -t host 'sudo install -m 600 -o ta -g ta /path/secret /tmp/x'` → `scp host:/tmp/x ./dest` → `ssh host 'rm -f /tmp/x'`.
- **chezmoi secret detection:** exit 1 but file IS added. Edit `.tmpl` to replace secret with `{{ .varName }}`, store in `chezmoi.toml [data]`.
- **chezmoi mode bits:** can't represent group-writable per-file ([#769](https://github.com/twpayne/chezmoi/issues/769)); `umask = 0o002` in `chezmoi.toml` is the only workaround — `re-add` can't fix it, source can't express 664. **Verify the line exists** before believing a mode-drift report: it was silently absent 2026-07-30, making 196 group-writable files show as phantom drift. `chezmoi status` paths are $HOME-relative — prefix them or `chezmoi diff` returns empty and misreports content drift as mode-only.
- **Skills:** canonical home `~/.agents/skills/<name>/SKILL.md` (AAIF standard; pi/opencode read it natively, CC reads via the `~/.claude/skills` symlink — same files either way). Must `ToolSearch select:<ToolName>` before calling deferred tools. Aim ≤100 lines; split overflow to `REFERENCE.md` / topic files. (Anthropic's own ceiling is 500 lines — ≤100 is a deliberately stricter house rule, cheap to keep since skill bodies load on demand.) Skill `description` format: "What it does. Use when [triggers]."
- **settings.local.json:** Edit tool fails mid-edit — always use Write tool.
- **History lookups:** `history.jsonl` is 9MB+ — never Read it. Filter via `Bash python3 -c` or recap.py.
- **A service's code comes from one of two places, and they go stale differently.** Interpreted services (`uv run python -m <pkg>`) execute the **working tree**, so the checked-out branch decides behavior and unmerged work silently changes what runs. Compiled ones (`exec .../bin/<bot>`) run a **pre-built binary** — a branch switch changes nothing, only a rebuild does. Don't apply one mitigation to the other: `git merge` fixes the first, `go build` + `sv restart` the second. Check the `run` script before reasoning about either.
- **runit user services:** `~/service/`, not `/var/service/`. `SVDIR=~/service sv <cmd>`. Creating a service dir = runsv discovers it and starts immediately; the `down` sentinel file only blocks auto-start at *next boot*, not first discovery. To stage without running: create files, then `sv down <name>`.
- **`claude -p` subprocess:** unset `CLAUDECODE` env, set `cmd.Dir=/tmp`, `--allowedTools ""` for chat mode. `--bare` skips CLAUDE.md/settings *and* auth discovery — only use it when the caller manages auth itself (e.g. `ANTHROPIC_API_KEY` env), otherwise expect "Not logged in · Please run /login". For pro-plan sessions, drop `--bare`.
- **CC repo (anthropics/claude-code):** closed-source — only CHANGELOG.md exists, no source code. Don't search it for internals; use the binary at `~/.local/share/claude/versions/`.
- **Not in chezmoi — restore manually after reinstall:** `~/.claude/settings.json`, `~/.claude.json` (MCP servers), `~/.config/chezmoi/chezmoi.toml` (secrets in `[data]` **and** the `umask = 0o002` line). (`statusline.sh` IS in chezmoi.)
