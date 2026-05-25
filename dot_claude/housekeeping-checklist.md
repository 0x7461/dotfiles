# Housekeeping Checklist

Trigger-based checklist for keeping docs, configs, and services in sync.
Referenced by the `/housekeeping` skill. Self-reviews every 30 days.

**Last reviewed:** 2026-05-25
**Last CC cleanup:** 2026-05-24

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
    cm_content=$(chezmoi status 2>/dev/null | while IFS= read -r ln; do
      chezmoi diff "${ln:3}" 2>/dev/null | grep -q '^[-+][^-+]' && echo 1
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
- [ ] Log directory exists (`log/main/` for svlogd)
- [ ] Service actually running (`SVDIR=~/service sv status <name>`)
- [ ] .env file has all required vars

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

## Checklist self-revision triggers

Update this checklist when:
- A new doc location is added (new obsidian-vault subdir, new per-project doc type)
- A new service type is introduced (not just a new bot — a new kind of service)
- A doc routing rule changes in CLAUDE.md
- A recurring mistake suggests a missing check
