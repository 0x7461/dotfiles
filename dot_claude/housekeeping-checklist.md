# Housekeeping Checklist

Trigger-based checklist for keeping docs, configs, and services in sync.
Referenced by the `/housekeeping` skill. Self-reviews every 30 days.

**Last reviewed:** 2026-09-18 (added the pre-check-before-remediation section after walking into the Camoufox lock trap a second time, plus the output-styles and two-owner config checks)
**Last CC cleanup:** 2026-09-24 (memcheck clean at 82; CLAUDE.md 112/200 lines; MEMORY.md 98 lines / 14,635 bytes)

> **Scope:** in-session, transcript-driven hygiene only. Portfolio-wide periodic scans (drift detection, repo staleness, runit health, monthly CC cleanup) moved to [[maint-watch]] (`~/projects/maint-watch/PLAN.md`) — runs out-of-session via runit cron + Telegram digest via nagger lane.

---

## After code changes to a project

- [ ] PLAN.md updated (new decisions, internals, history)
- [ ] **AGENTS.md updated** if rules / commands / layout / boundaries / external-integration points changed
- [ ] `Updated: YYYY-MM-DD` refreshed on touched docs (PLAN.md and AGENTS.md)
- [ ] IDEAS.md status still accurate (Idea/Research/Implement/Maintain/Archived)
- [ ] **Trim-on-done:** any roadmap item just shipped? Collapse its detail block into a one-line History entry. Don't let ✅-done blocks accumulate.
- [ ] **Trimming an oversize PLAN.md — read it end-to-end first.** The size is rarely the real find; **stale claims are**, and they only surface on a full read. Three of three trims on 2026-08-14/15 turned one up: `ax88179` prescribed a decisive test it had already run ("until then, change nothing"), and `agent-docs` marked a finished phase `✱ current` plus a shipped skill "deferred". Collapse *finished* work (History, closed investigations, completed phases) rather than deleting live reference — and before cutting anything whose imperative half is supposed to live in AGENTS.md, grep AGENTS.md to confirm it actually does. ⚠ Never trim an un-versioned PLAN.md: `git init` first, or the removed content is simply gone (learned the expensive way — see [[feedback_flag_inferred_structure]]).

- [ ] **Spec-hygiene: check doc claims against the world, not against other docs.** A stale PLAN reads perfectly coherently — that is why re-reading it doesn't catch anything. Run the commands. On 2026-08-15 this found `aria2` presenting four shipped phases as pending (the service had been up for days, yt-dlp/gallery-dl were already routing through it, the magnet handler was registered), `compress` marking a botkit integration "(future)" that was live in `trending.go`, and — the one that mattered — `dotfiles` documenting **1 of 6** template variables, which would have produced a *silently broken* `~/.ssh/config` on a rebuild, since chezmoi renders an undefined variable as empty rather than failing. ⚠ **Never hand-copy a directory listing into a doc** — replace it with the command that derives it (`chezmoi managed`, `ls`). The dotfiles inventory named four tools that were gone and omitted the compositor in use.

## Git hygiene (after code changes in a git repo)

Run these in the project dir. Each is a quick `Bash` call; skip silently if not in a git repo.

- [ ] **Stale uncommitted work** — flag if `git log -1 --format=%ct` shows >3 days since last commit AND there's uncommitted work (`git status --porcelain | wc -l` > 0). Days of uncommitted work = lost history granularity if it ever has to be bundled into one commit later.
  ```sh
  age_days=$(( ( $(date +%s) - $(git log -1 --format=%ct) ) / 86400 ))
  dirty=$(git status --porcelain | wc -l)
  [ "$age_days" -gt 3 ] && [ "$dirty" -gt 0 ] && echo "⚠ $age_days days since last commit, $dirty files dirty"
  ```
- [ ] **Stale chezmoi state** — flag if `chezmoi status` reports any drift between live files and source-of-truth. Drift means a live file has been edited (or auto-written) without `chezmoi re-add` propagating it back. Distinguish mode-only noise (umask mismatch — common, benign) from content drift (real, needs `chezmoi re-add`). Source-repo git age isn't part of this check — drift can exist on a freshly-committed source.
  ```sh
  cm_dirty=$(chezmoi status 2>/dev/null | wc -l)
  if [ "$cm_dirty" -gt 0 ]; then
    # NOTE: paths from `chezmoi status` are relative to $HOME — they MUST be prefixed, or
    # `chezmoi diff` resolves nothing, returns empty, and every entry is silently misclassified
    # as mode-only. That hid real content drift on 2026-07-30 (a ~/.ssh/config edit that the
    # next `chezmoi apply` would have reverted). Always verify a suspect file directly:
    #   chezmoi diff ~/.ssh/config
    cm_content=$(chezmoi status 2>/dev/null | while IFS= read -r ln; do
      chezmoi diff "$HOME/${ln:3}" 2>/dev/null | grep -q '^[-+][^-+]' && echo 1
    done | wc -l)
    cm_mode=$((cm_dirty - cm_content))
    echo "⚠ chezmoi: $cm_dirty drifted ($cm_content content, $cm_mode mode-only)"
    [ "$cm_content" -gt 0 ] && echo "  → run: chezmoi diff <file>; chezmoi re-add <file>"
    [ "$cm_mode" -gt 0 ] && echo "  → mode-only noise (umask 022 vs 002); fix systemically with: chezmoi re-add --recursive ~"
  fi
  ```
- [ ] **Sensitive untracked files** — scan for files that look secret-bearing or runtime-only and shouldn't be committed.
  ```sh
  git ls-files --others --exclude-standard | grep -iE '\.(bak|env|key|pem|cookies)|password|secret|credential|\.db-(shm|wal)$|\.v[0-9]+\.bak$'
  ```
  If hits: add the right glob to `.gitignore` BEFORE the next `git add`.
- [ ] **PLAN.md History vs `git log` drift** — if PLAN claims a phase/feature shipped on date X but `git log --since=X` is empty (or `git log --grep=<phase>` returns nothing), the doc is lying. Flag for the user. ⚠ **Give `--since` a time.** git reads a bare date as that day **at the current time of day** (`git rev-parse --since=2026-10-01` → `11:56` when run at 11:56), so it drops every commit made earlier that day — an entry written for *today* then reads as a lie against a truthful doc. Use `--since="${X}T00:00"` (2026-10-01: bare matched none of vxpm's three morning commits, `T00:00` matched all three).
- [ ] **Long-lived branch with stale dirty tree** — if on a non-main branch with uncommitted changes for >3 days, suggest stashing or committing.

## After config/system changes

- [ ] Changed config file added to chezmoi (`chezmoi add <file>`)
- [ ] **Secret-containing configs** (WireGuard `.conf`, `.env` files) — do NOT add to chezmoi; document location in obsidian-vault instead
- [ ] Obsidian vault system doc updated (`~/obsidian-vault/system/<topic>.md`)
- [ ] reproducibility.md still accurate (new packages, changed steps)
- [ ] packages.md updated if new packages installed

- [ ] **An output style changed?** They live in the ithaca store (`store/styles/`, git-tracked;
  `~/.claude/output-styles` is a symlink) and also sync to the work machine through the `cc-at-work`
  gist (`git@gist.github.com:2ce62c03b78b14953f8a47bd8b937365`). Commit in ithaca **and** push the
  gist, or the two machines diverge with no drift signal. A style loads at session start only. pi
  reads it through `~/.pi/agent/extensions/store-context.ts`, which **hardcodes the file path** — a
  renamed or switched style needs that path changed as well.

- [ ] **Changed a CC hook, rule file or the status line?** pi has its own ports in
  `~/.pi/agent/extensions/` (`audit-commands.ts`, `notify.ts`, `status.ts`; chezmoi-tracked). Change
  both sides or they drift. Where they live and how each was verified: `~/projects/ithaca/agent_docs/pi-setup.md`.

- [ ] **A file with two owners?** `~/.claude/statusline.sh` is in chezmoi *and* in the gist since
  2026-09-18. Whichever you edited, update the other, or the next `chezmoi apply` reverts a gist pull.
  Prefer collapsing to one owner when the sync settles.

## After service changes (runit)

- [ ] Run script matches current binary/config paths
- [ ] **snooze spec verified before install** — `snooze -v <spec> true` prints the next fire time. An unspecified field defaults to `0`, not "any", so `-M/15` means "every 15th minute *of hour 0*" and silently parks the service until midnight. Cost a parked `mbsync` on 2026-08-02; `sv status` read `run` the whole time.
- [ ] **`snooze -t` only together with a job that touches the timefile.** snooze never writes it; an untouched `-t` file re-fires a slot the job finished inside its first 60s (mbsync ran ~4×/window, archiver-mirror twice, until 2026-09-28). Catch-up wanted → `-t ~/.local/state/snooze/<name> -s <cadence>` + `sh -c 'touch "$1" && exec <job>' sh "$tf"`; no catch-up → no `-t` at all. Pattern: `~/obsidian-vault/system/services.md` late-boot gotcha.
- [ ] **Scheduled (snooze) service has a `finish` hook** — `install -m 755 ~/projects/maint-watch/service-hooks/finish ~/service/<name>/finish`. Without it a job failing every run reads `OK`, because the supervised process is the scheduler, not the job.
- [ ] Log directory exists (`log/main/` for svlogd)
- [ ] **Service actually *ran*, not just "is up"** — `sv status` reports the scheduler. Confirm a real outcome: `awk '!($1==-1 && $2==15)' ~/.cache/maint-watch/runs/<name>` (that filter drops `sv restart`s, which are recorded as SIGTERM and are not job runs).
- [ ] .env file has all required vars
- [ ] **`## Services` declaration** — if a project owns the service, its AGENTS.md `## Services` block declares it (`persistent` = up + survives reboot) **with a cadence** (`persistent, every 6h`) if it is scheduled; without one, a service that stops firing altogether reads `OK` forever. Declare the longest *normal* gap, not the nominal interval — a job running hourly but only 08:00–22:00 has a 10-hour legitimate overnight gap. Run `maint-watch doctor` to reconcile declared vs actual; a leftover `down` sentinel on a persistent service means it silently parks on the next reboot.

## After botkit changes

- [ ] Binary rebuilt (`go build -o bin/<bot> ./cmd/<bot>/`)
- [ ] Service restarted (`SVDIR=~/service sv restart <bot>`)
- [ ] Bot token env vars set in .env

## Before remediating a failure that has a memory

- [ ] **Run the memory's named pre-check first.** A memory written for a symptom usually records how
  that symptom lies. `reference_camoufox_stale_lock` says to `grep -c coreBundle.js <log>` before
  touching a lock file, because "Connection closed while reading from the driver" has two causes and
  the stale lock is the *residue* of the other one. Skipped twice now — 2026-08-29 and 2026-09-18 —
  both times by reading only the tail of the log, which starts below the Node stack trace. Reading a
  log tail is not reading the log.

## ithaca watch (every housekeeping — expires 2026-10-29)

The agent store went live 2026-09-29 (`~/projects/ithaca/store/`, exposed as `~/.agents`). Run
this every time for a month to catch breakage early. Record anything found as a fix item in
ithaca's PLAN Backlog. **On or after 2026-10-29:** summarise the month in ithaca HISTORY, then
delete this section.

- [ ] **Store committed and pushed.** Memory now lives in ithaca, so /housekeeping is its commit
  path: `git -C ~/projects/ithaca status -sb` — commit memory/rule edits from this session,
  then `git push` (the private remote is the only off-site copy).
- [ ] **Links intact:** `readlink ~/.agents` → `/home/ta/projects/ithaca/store`, and
  `find ~/.claude ~/.agents -maxdepth 3 -xtype l -not -path '*/debug/*'` prints nothing (no
  dangling links; `debug/latest` is CC's own and often dangles).
  `chezmoi status` clean for `.claude` / `.agents` paths.
- [ ] **CC saved a memory this session?** Confirm it landed in `store/memory/` (it shows in
  ithaca's `git status`). The first confirmed save clears AGENTS.md "Untested: CC saving a
  memory through the symlinked folder".
- [ ] **pi used this session?** Note anything pi missed that CC follows (a rule, the output
  style, a memory). pi reads the store once per session, so edits apply next session.
- [ ] **After 2026-10-05:** `git -C ~/projects/ithaca log --oneline --grep 'Weekly snapshot' -1`
  shows a W41+ commit — the ithaca-snapshot service's commit path works inside ithaca.

## Session end (replaces save-learnings)

- [ ] Non-obvious discoveries routed to correct doc:
  - Build/tool/errors → project PLAN.md
  - System knowledge → obsidian-vault/system/
  - Dev patterns → obsidian-vault/dev/
  - Cross-project rules → CLAUDE.md if machine-bound, `~/.claude/rules/behaviour.md` if portable
    (split 2026-09-29; both load in CC natively and in pi via `store-context.ts`)
- [ ] No session-specific context saved to durable docs
- [ ] **Memory store integrity** — run `python3 ~/.claude/scripts/memcheck.py`. Exit 0 = clean; it validates `name:` == filename stem, description/type present, `[[links]]` resolve, and that MEMORY.md matches disk both ways. Fix anything it reports before finishing (all are mechanical). If a memory was added this session, it also catches a missing index entry.
- [ ] MEMORY.md is index-only and under 200 lines — one line per memory, no content blocks, and no mirroring of harness-supplied facts (model IDs, tool names) that only go stale
- [ ] **Glossary upkeep (#56)** — did this session coin/use a new shared-vocabulary term (project codename, tool shorthand, recurring abbreviation, or a person/place alias)? Offer to add it, routing by sensitivity:
  - **Public** (codenames, tools, abbrevs) → `~/obsidian-vault/system/glossary.md` (loads globally via the `~/.claude/rules/glossary.md` symlink; **public terms only** — its contents ship to whatever model backs the session)
  - **PII** (people, places, real identities) → `~/.claude/pii-aliases.local.md` (local, un-synced — never put PII in the vault glossary)
  - Also flag any glossary entry this session made **stale** (a retired/renamed project or tool still listed as current). Transcript-driven only — full-glossary sweeps aren't this checklist's job.

## T7 vault inbox sweep (run on housekeeping if T7 mounted)

Only runs if `/run/media/ta/T7 Shield/` is mounted. Skip silently if not.

- [ ] **`_inbox/unsorted/` items older than 90 days** — surface for "sort or delete" decision. Don't auto-delete.
  ```sh
  find "/run/media/ta/T7 Shield/_inbox/unsorted" -mindepth 1 -mtime +90 2>/dev/null
  ```
- [ ] **`_inbox/imports/` workspaces** — flag any subdir older than 30 days that hasn't been verified-and-removed (likely an interrupted import).
  ```sh
  find "/run/media/ta/T7 Shield/_inbox/imports" -mindepth 2 -maxdepth 2 -type d -mtime +30 2>/dev/null
  ```
- [ ] **Pending cleanup backups in `_meta/`** — flag any `*-backup-*` dir older than 14 days (post-cleanup safety backups should be reviewed and deleted by then).
  ```sh
  find "/run/media/ta/T7 Shield/_meta" -maxdepth 1 -type d -name '*-backup-*' -mtime +14 2>/dev/null
  ```

## Trash bins (monthly)

Review then empty — never empty unseen. `gio trash --empty` purges ALL trashes at once (home + every mounted drive), so list contents first:

```sh
gio list trash:// 2>/dev/null
du -sh ~/.local/share/Trash "/run/media/ta/T7 Shield/.Trash-1000" 2>/dev/null
```

- [ ] Surface contents + sizes for a keep/purge decision (user runs the empty command themselves).
- Last emptied: never. **2026-09-28: 11 GB, 975 items** (4.9 GB of it the retired `~/.proto` +
  `~/.bun`; 2.5 GB is trashed `~/archive` files — deleting those needs explicit OK). User approved
  emptying; CC's `rm -rf` on the trash was permission-denied, so the user runs it. `gio trash --list`
  fails here (`trash:: Operation not supported`). Earlier: **2026-09-24: 5.2 GB, 971 items, oldest 2023-01-14** —
  the "in use since 2026-07" note was wrong, it has been accumulating for ~3 years. T7 held a
  further ~11.1 GB as of 2026-07-05 (not re-measured; T7 unmounted). Note `gio list trash://`
  reported **0 items** against a populated `~/.local/share/Trash/files` — don't trust it alone,
  check the directory.

## Checklist self-revision triggers

Update this checklist when:
- A new doc location is added (new obsidian-vault subdir, new per-project doc type)
- A new service type is introduced (not just a new bot — a new kind of service)
- A doc routing rule changes in CLAUDE.md
- A recurring mistake suggests a missing check
