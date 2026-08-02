# Housekeeping Checklist

Trigger-based checklist for keeping docs, configs, and services in sync.
Referenced by the `/housekeeping` skill. Self-reviews every 30 days.

**Last reviewed:** 2026-08-02 (service-changes section gained snooze-spec verification, finish-hook install, cadence declaration, and a real-run check — all driven by mistakes made that session)
**Last CC cleanup:** 2026-07-05

> **Scope:** in-session, transcript-driven hygiene only. Portfolio-wide periodic scans (drift detection, repo staleness, runit health, monthly CC cleanup) moved to [[maint-watch]] (`~/projects/maint-watch/PLAN.md`) — runs out-of-session via runit cron + Telegram digest via nagger lane.

---

## After code changes to a project

- [ ] PLAN.md updated (new decisions, internals, history)
- [ ] **AGENTS.md updated** if rules / commands / layout / boundaries / external-integration points changed
- [ ] `Updated: YYYY-MM-DD` refreshed on touched docs (PLAN.md and AGENTS.md)
- [ ] IDEAS.md status still accurate (Idea/Research/Implement/Maintain/Archived)
- [ ] **Trim-on-done:** any roadmap item just shipped? Collapse its detail block into a one-line History entry. Don't let ✅-done blocks accumulate.

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
- [ ] **PLAN.md History vs `git log` drift** — if PLAN claims a phase/feature shipped on date X but `git log --since=X` is empty (or `git log --grep=<phase>` returns nothing), the doc is lying. Flag for the user.
- [ ] **Long-lived branch with stale dirty tree** — if on a non-main branch with uncommitted changes for >3 days, suggest stashing or committing.

## After config/system changes

- [ ] Changed config file added to chezmoi (`chezmoi add <file>`)
- [ ] **Secret-containing configs** (WireGuard `.conf`, `.env` files) — do NOT add to chezmoi; document location in obsidian-vault instead
- [ ] Obsidian vault system doc updated (`~/obsidian-vault/system/<topic>.md`)
- [ ] reproducibility.md still accurate (new packages, changed steps)
- [ ] packages.md updated if new packages installed

## After service changes (runit)

- [ ] Run script matches current binary/config paths
- [ ] **snooze spec verified before install** — `snooze -v <spec> true` prints the next fire time. An unspecified field defaults to `0`, not "any", so `-M/15` means "every 15th minute *of hour 0*" and silently parks the service until midnight. Cost a parked `mbsync` on 2026-08-02; `sv status` read `run` the whole time.
- [ ] **Scheduled (snooze) service has a `finish` hook** — `install -m 755 ~/projects/maint-watch/service-hooks/finish ~/service/<name>/finish`. Without it a job failing every run reads `OK`, because the supervised process is the scheduler, not the job.
- [ ] Log directory exists (`log/main/` for svlogd)
- [ ] **Service actually *ran*, not just "is up"** — `sv status` reports the scheduler. Confirm a real outcome: `awk '!($1==-1 && $2==15)' ~/.cache/maint-watch/runs/<name>` (that filter drops `sv restart`s, which are recorded as SIGTERM and are not job runs).
- [ ] .env file has all required vars
- [ ] **`## Services` declaration** — if a project owns the service, its AGENTS.md `## Services` block declares it (`persistent` = up + survives reboot) **with a cadence** (`persistent, every 6h`) if it is scheduled; without one, a service that stops firing altogether reads `OK` forever. Declare the longest *normal* gap, not the nominal interval — a job running hourly but only 08:00–22:00 has a 10-hour legitimate overnight gap. Run `maint-watch doctor` to reconcile declared vs actual; a leftover `down` sentinel on a persistent service means it silently parks on the next reboot.

## After botkit changes

- [ ] Binary rebuilt (`go build -o bin/<bot> ./cmd/<bot>/`)
- [ ] Service restarted (`SVDIR=~/service sv restart <bot>`)
- [ ] Bot token env vars set in .env

## Session end (replaces save-learnings)

- [ ] Non-obvious discoveries routed to correct doc:
  - Build/tool/errors → project PLAN.md
  - System knowledge → obsidian-vault/system/
  - Dev patterns → obsidian-vault/dev/
  - Cross-project rules → CLAUDE.md
- [ ] No session-specific context saved to durable docs
- [ ] MEMORY.md still under 200 lines
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
- Last emptied: never (bins in use since 2026-07; ~11.1 GB parked on T7 as of 2026-07-05)

## Checklist self-revision triggers

Update this checklist when:
- A new doc location is added (new obsidian-vault subdir, new per-project doc type)
- A new service type is introduced (not just a new bot — a new kind of service)
- A doc routing rule changes in CLAUDE.md
- A recurring mistake suggests a missing check
