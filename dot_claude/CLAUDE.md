# Global Preferences

## System
- Void Linux (glibc), Hyprland, runit (not systemd). PipeWire audio. Catppuccin Macchiato theme.
- Custom packages: built in ~/void-packages, installed with `xi` (sudo). Official repos: `sudo xbps-install`.

## Agreements
- User runs all sudo commands themselves
- Project ideas tracked in ~/projects/IDEAS.md

## Documentation Structure
- `~/projects/IDEAS.md` — project index + status. **Not git-tracked — never commit it.**
- `~/projects/<proj>/PLAN.md` — per-project plans + technical insights
- `~/projects/<proj>/INSIGHTS.md` — deep technical notes (where it exists)
- `~/obsidian-vault/system/*.md` — system knowledge (hyprland, audio, packages, shell…)
- `~/obsidian-vault/dev/*.md` — dev knowledge base (algorithms, patterns, tools…)
- `~/.claude/CLAUDE.md` — cross-project rules and gotchas

## Memory Management
- This file is the single source of truth. **Soft limit: 100 lines** — if limit reached, audit with user before adding: review what's stale or moveable to PLAN.md first.
- Auto memory (MEMORY.md) is disposable — 200-line hard truncation, don't rely on it.
- One-liners and pointers only. Link to PLAN.md or debugging.md for details.

## Critical Rules
- **NEVER delete files from ~/archive without explicit user permission.**

## Doc Update Rule
At task completion, silently route doc-worthy content: tool/build/errors → PLAN.md or INSIGHTS.md; system knowledge → obsidian-vault/system/; dev patterns → obsidian-vault/dev/; status → IDEAS.md; cross-project rules → CLAUDE.md.
**Threshold:** only if genuinely new/non-obvious. Append: "Updated: X in Y". `/save-learnings` for manual review.
**Quality:** procedural steps over descriptions. Mark untested: `⚠ untested`. Flag staleness before proceeding.
**Session check:** on project resume, skim PLAN.md and flag obviously stale items.

## Workflow Rules
- **Read docs before acting:** Check PLAN.md, HYPRLAND.md etc. before starting — don't rediscover.
- **Background tasks:** Only for independent work. Never background iterative fix-build-check cycles.
- **Fundamental blockers:** Stop and communicate immediately on compiler/toolchain version issues.
- **research.md pattern:** For non-trivial features, dump deep research into `research.md` before planning. File persists across sessions; avoids surface-level summaries buried in chat.
- **Think-first:** For non-trivial implementation asks, ask user's approach first, then evaluate — propose a better direction if one exists. Skip for ops tasks (installs, keybinds, lookups). "Just do it" overrides — nudge only, not a gate.
- **Don't chain Bash commands with `&&`:** Each chained call runs under one approval, bypassing the allow list. Use separate Bash tool calls for independent operations.
- **Use Write tool for file creation, not `cat` heredocs:** Write tool is transparent, avoids shebang `!` escaping issues, and is the correct dedicated tool.

## Toolchain Rules
- **proto** manages runtimes (Go, Python, Node, Bun, uv) — never use system package manager.
- **uv** for Python (not pip/venv): `uv run`, `uv sync`, `uv add`.
- **rustup** manages Rust (not proto): `rustc --version`, `cargo`.

## Known Gotchas
- **SSH key for GitHub:** key is `~/.ssh/id_ed25519_gh` (not `id_ed25519`). Always use `git@github.com:` URLs, never HTTPS. Two options: (1) inline: `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_gh" git clone git@github.com:...` (2) agent: `eval $(ssh-agent -s) && ssh-add ~/.ssh/id_ed25519_gh`. Also needed for `chezmoi git -- push`.
- **chezmoi secret detection:** blocks `chezmoi add` even with `--force` (exit 1), but the file IS added to source dir. Workaround: let it warn, then manually edit the `.tmpl` file to replace secret with `{{ .varName }}`, store value in `~/.config/chezmoi/chezmoi.toml` under `[data]`.
- **chezmoi forget in non-TTY:** requires `--force` flag (can't open `/dev/tty` for confirmation prompt).
- **chezmoi add on dirs with binaries:** very slow + false-positive secret warnings. Add specific files/subdirs rather than whole dirs when binaries are present.
- **mpv on Wayland:** Without `WAYLAND_DISPLAY` set, mpv falls back to DRM (fails with "Permission denied"). Fix: `vo=dmabuf-wayland` in `~/.config/mpv/mpv.conf`.
- **File integrity check:** `ffmpeg -v error -i file -f null - 2>&1` — no output = good file. Catches truncated downloads, HTML saved as mp4, corrupt muxes.
- **Skills:** `~/.claude/skills/<name>/SKILL.md` — not `commands/`. Frontmatter: name, description, user-invocable, allowed-tools.
- **wob FIFO:** Blocks if no reader — use `timeout` wrapper. See memory/debugging.md.
- **settings.local.json:** Edit tool fails mid-edit — always use Write tool to rewrite cleanly.
- **Hooks — Stop event:** Fires after every response turn, not session end.
- **Hooks — Notification:** `notification_type`: `permission_prompt` (contextual) vs `idle_prompt` (noise).
- **History lookups:** `history.jsonl` is 9MB+ — never use Read tool on it. Always filter via `Bash python3 -c` or recap.py. Same for session JSONLs.
- **Create file in GitHub repo:** `gh api repos/{owner}/{repo}/contents/{path} --method PUT --field message="..." --field content=""`  (content is base64; empty string = empty file)
- **gh api large content:** `--field content=<base64>` hits OS ARG_MAX for files >~50KB. Use `--input <tmpfile>` with a JSON body file instead.
- **GitHub repo edits:** Prefer local clone + `git mv/commit/push` over direct API manipulation. API = slow, token-heavy, fragile. Only use API when no local clone exists.
- **Podman on Void — image names:** No unqualified search registries configured → always use fully qualified names (`docker.io/library/mongo`, `docker.io/org/image`, `ghcr.io/org/image`).
- **Rootless Podman bind mounts:** `user: "UID:GID"` in compose maps container UID to a sub-uid on host, not the file owner. Fix: `chmod 777` on mounted dirs.
- **podman-compose `depends_on` override:** Doesn't merge cleanly — disabled services still block startup. Use a standalone `compose.yaml` instead of override files.
- **runit + dotenv CWD:** `godotenv.Load()` (and equivalents) resolves `.env` relative to CWD. runit does not set CWD to the project dir — add `cd /path/to/project` before `exec` in the run script.
- **zstd not installed by default on Void:** needed to inspect `.tar.zst` files. Install with `sudo xbps-install zstd`.
- **xbps-src .deb repack:** sandbox has no `tar` — use `bsdtar` in `do_extract`. Pattern: `ar x foo.deb && bsdtar -xf data.tar.gz`.
- **Dead code in Rust:** never use `#[allow(dead_code)]` — delete the unused code instead.
- **`cat > symlink` writes through to target:** Never write a wrapper script to a path that is currently a symlink — `cat >` follows it and corrupts the target. `rm` the symlink first, then write.
- **Shebang escaping in bash:** `echo '#!/bin/sh'` → `#\!/bin/sh` (bash escapes `!` in history). Use `printf` or Python `open().write(chr(35)+chr(33)+'/bin/sh\n...')` instead.
- **qwen3.5 via Ollama:** thinking mode is on by default — burns tokens/time silently. Use `qwen2.5` for summarization tasks (no thinking, good quality).
- **summarize CLI (steipete) npm install:** global bin lands in proto node's bin dir, not on PATH. Symlink `~/.proto/tools/node/<ver>/bin/summarize` → `~/.local/bin/summarize`. No Linux binary release — npm only.
- **`--cli claude` inside Claude Code:** blocked — nested sessions share resources and crash. Use `--model anthropic/...` with API key, or Ollama local model instead.

## Usage Guardrails
- **effortLevel default:** `"low"` in `~/.claude/settings.json` (thinking on, small budget). Use `--effort high` at session start for hard tasks.
- **`/usage`:** CC-only slash command — no programmatic access. User must run manually.
- **Usage reminder:** at the start of a substantial work session, gently ask user to run `/usage` if they haven't recently — helps avoid the dead zone (session hitting 100% near weekly reset).
- **Suggest Opus when:** architecture decision with long-term consequences; same bug after 2 Sonnet attempts; complex multi-file reasoning where relationships matter.
- **Suggest `--effort high` when:** complex algorithm design; tricky Rust lifetime/borrow issues; multi-step logical deduction where low effort visibly struggles.
- **Warn about session burn when:** a task will require many tool calls (20+) — flag it upfront so user can batch or decide to defer.
