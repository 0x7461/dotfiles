# Housekeeping Checklist

Trigger-based checklist for keeping docs, configs, and services in sync.
Referenced by the `/housekeeping` skill. Self-reviews every 30 days.

**Last reviewed:** 2026-05-08
**Last CC cleanup:** 2026-04-24

---

## After code changes to a project

- [ ] PLAN.md updated (new decisions, build notes, gotchas)
- [ ] IDEAS.md status still accurate (Idea/Research/Implement/Maintain/Archived)
- [ ] `Updated: YYYY-MM-DD` date in PLAN.md header
- [ ] **Trim-on-done:** any roadmap item just shipped? Collapse its detail block into a one-line History entry. Don't let ✅-done blocks accumulate.

## Git hygiene (after code changes in a git repo)

Run these in the project dir. Each is a quick `Bash` call; skip silently if not in a git repo.

- [ ] **Stale uncommitted work** — flag if `git log -1 --format=%ct` shows >3 days since last commit AND there's uncommitted work (`git status --porcelain | wc -l` > 0). Days of uncommitted work = lost history granularity if it ever has to be bundled into one commit later.
  ```sh
  age_days=$(( ( $(date +%s) - $(git log -1 --format=%ct) ) / 86400 ))
  dirty=$(git status --porcelain | wc -l)
  [ "$age_days" -gt 3 ] && [ "$dirty" -gt 0 ] && echo "⚠ $age_days days since last commit, $dirty files dirty"
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

## Weekly sweep (run manually or when prompted)

- [ ] **Drift detection** (run these as a block):
  - `find ~/projects -name "INSIGHTS.md" -o -name "research.md" -o -name "notes.md"` — flag any; these should be folded into PLAN.md
  - `find ~/.claude/projects -name "project_*.md"` — flag any; project content belongs in PLAN.md
  - `wc -l ~/projects/*/PLAN.md | awk '$1 > 300'` — flag PLAN.md files over the 300-line soft limit
  - For each PLAN.md, compare its `**Status:**` line against the matching IDEAS.md entry — flag mismatches
- [ ] **Repo staleness sweep** — for each project repo, check git age + dirtiness:
  ```sh
  for d in ~/projects/*/; do
    [ -d "$d/.git" ] || continue
    age=$(( ( $(date +%s) - $(git -C "$d" log -1 --format=%ct 2>/dev/null || echo $(date +%s)) ) / 86400 ))
    dirty=$(git -C "$d" status --porcelain 2>/dev/null | wc -l)
    [ "$age" -gt 3 ] && [ "$dirty" -gt 0 ] && echo "$(basename $d): ${age}d since commit, $dirty dirty"
  done
  ```
- [ ] PLAN.md `Updated:` dates — flag any >60 days on Maintain/Implement projects
- [ ] `chezmoi status` — no unmanaged config drift
- [ ] All runit services healthy (`SVDIR=~/service sv status`)
- [ ] CLAUDE.md under 200 lines soft limit
- [ ] MEMORY.md — prune stale session notes
- [ ] This checklist — if >30 days since last review, revise it
- [ ] **Monthly CC cleanup** — if >30 days since `Last CC cleanup:` above:
  - CLAUDE.md — reread every rule; rewrite stale/vague ones, remove anything obvious or no longer true, consolidate duplicates, stay under 200 lines
  - MEMORY.md — remove scratchpad entries that are resolved or no longer relevant; promote anything durable to CLAUDE.md or obsidian vault
  - settings.json — review flags; remove workarounds that are no longer needed
  - Update `Last CC cleanup:` date when done.

## Checklist self-revision triggers

Update this checklist when:
- A new doc location is added (new obsidian-vault subdir, new per-project doc type)
- A new service type is introduced (not just a new bot — a new kind of service)
- A doc routing rule changes in CLAUDE.md
- A recurring mistake suggests a missing check
