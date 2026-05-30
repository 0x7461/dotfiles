---
name: dashboard
description: System dashboard — services, archiver status, packages, project tasks, and IDEAS.md open projects. Use when the user explicitly asks about system status, running services, "what needs attention", or wants a sweep of open items across all projects (not just PLAN.md backlogs). Do NOT trigger for vague "what should I work on" — surface options from IDEAS.md directly instead.
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

Show a system status overview. Run all sections and present a concise summary.

> Note: skill markdown is shell-interpolated when rendered into the prompt, so `$0`/`$1`/`$NF` in awk scripts get stripped. Use python or sed for line parsing.

## 1. User Services

Check all runit user services (raw liveness), then reconcile against *declared* expected-state via `maint-watch doctor` — its `## Services` declarations are the source of truth for which services are supposed to be persistently up (same defer-to-the-owner pattern as §2's archiver status):

```sh
for svc in ~/service/*/; do
  name=$(basename "$svc")
  SVDIR=~/service sv status "$name" 2>&1
done
```

```sh
uv run --project ~/projects/maint-watch python -m maint_watch doctor 2>&1
```

**Reading it — never call a `down` service "expected" by guess:**
- A `doctor` verdict of `DOWN` / `REBOOT-RISK` / `MISSING` is **action-needed**: the service is *declared* persistent but reality disagrees (`REBOOT-RISK` = running now, but a `down` sentinel will park it on the next reboot).
- A `down` service with **no** `## Services` declaration is *unknown*, not automatically fine — surface it as "down, undeclared" so the gap is visible (and a candidate for a `## Services` entry), rather than rendered as silent green.

## 2. Archiver Status

Defer to archiver's own status command (canonical, single source of truth):

```sh
uv run --project ~/projects/archiver archiver status
```

Plus failures in the last 7 days (status doesn't surface these):

```sh
sqlite3 ~/projects/archiver/archiver.db "SELECT failed_at, platform, author, error FROM download_failures WHERE failed_at >= datetime('now', '-7 days') ORDER BY failed_at DESC LIMIT 10;"
```

## 3. Stale Packages

Check custom-built packages against upstream:

```sh
# Currently installed versions of custom packages
for pkg in google-chrome hyprland hyprpaper hyprlock hypridle; do
  installed=$(xbps-query "$pkg" 2>/dev/null | grep pkgver | head -1 | sed 's/pkgver: //')
  template_ver=$(grep '^version=' ~/void-packages/srcpkgs/"$pkg"/template 2>/dev/null | head -1 | sed 's/version=//')
  [ -n "$installed" ] && echo "$pkg: installed=$installed template=$template_ver"
done
:  # the `[ ... ] && echo` form exits 1 when the test is false on the last iteration — pin exit 0
```

## 4. Project Tasks

Scan PLAN.md files for open items in either format:

```sh
for plan in ~/projects/*/PLAN.md; do
  project=$(basename $(dirname "$plan"))
  # grep -c always prints a count (incl. 0) on stdout but exits 1 when 0 matches.
  # Don't fall back with `|| echo 0` — that appends a second "0" and breaks the arithmetic.
  checkboxes=$(grep -c '^- \[ \]' "$plan" 2>/dev/null; true)
  has_backlog=$(awk '/^## Backlog/{flag=1; next} /^## /{flag=0} flag && /^- /' "$plan" 2>/dev/null | wc -l)
  total=$((checkboxes + has_backlog))
  [ "$total" -gt 0 ] && echo "$project: $total open ($checkboxes checkboxes, $has_backlog backlog items)" || true
done
:  # pin exit 0
```

Most projects use the agent-docs `## Backlog` convention; older projects use `- [ ]` checkboxes. The scan covers both.

**Caveat — this count is a doc-derived proxy, not verified open work.** It counts every top-level `- ` line under `## Backlog`, which includes shipped-but-untrimmed detail, not just open tasks. A high count may mean the project owes a trim-on-done pass (as maint-watch did at 27 — all shipped phases) rather than having real pending work. Present it as "worth a look," not confirmed open-work; a big number alone is not alarm.

## 5. IDEAS.md Open Projects

PLAN.md scan in §4 only catches projects with an active backlog. Many open projects live in IDEAS.md at earlier statuses (Implement / Research / Idea — PLAN.md written) without a backlog block. Scan IDEAS.md and surface them:

```sh
python3 - <<'PY'
import re
num=title=None
for line in open('/home/ta/projects/IDEAS.md'):
    m=re.match(r'^## (\d+)\. *(.*)', line)
    if m: num,title=m.group(1),m.group(2).rstrip(); continue
    m=re.match(r'^\*\*Status:\*\* *([^|\n]*)', line)
    if not m or num is None: continue
    s=m.group(1).strip()
    bucket=("Implement" if s.startswith("Implement")
            else "Research" if s.startswith("Research")
            else "Idea (PLAN drafted)" if s.startswith("Idea") and "PLAN.md written" in s
            else None)
    if bucket: print(f"  #{num}  {bucket:<22}  {title}")
PY
```

Reports each non-Maintain/Done/Archived entry. Sort or group by bucket in presentation. Exclusions are deliberate:
- **Maintain** — already shipped, not "open work."
- **Done / Archived** — closed.
- **Idea (no PLAN.md)** — too many; would flood output. Surface count only.

Also count the Idea-no-PLAN bucket for visibility:

```sh
python3 -c "
import re
c=sum(1 for l in open('/home/ta/projects/IDEAS.md')
      if re.match(r'^\*\*Status:\*\* *Idea', l) and 'PLAN.md written' not in l)
print(f'  Idea (no PLAN): {c} entries — see IDEAS.md if browsing')
"
```

## Presentation

Summarize as a compact dashboard:
- Services: running/down, plus `doctor` verdicts for declared services — any DOWN/REBOOT-RISK/MISSING is flagged
- Archiver: status output + failure count
- Packages: any outdated
- Tasks: open items per project

Flag anything that needs attention.

## 5. Verify

Re-read the assembled dashboard with one question: *"if the user only sees this summary, will they know whether anything needs immediate action?"* If not, add an explicit "**Action needed:** ..." line at the top. If everything is green, say "**All clear**" — silence reads as "skipped."

**Never emit unearned green.** "All clear" for services requires `doctor` to be green — not merely the absence of crashed services. A down declared-persistent service, or a `REBOOT-RISK` sentinel, is action-needed even when the raw `sv status` line looks unremarkable. If a signal couldn't be verified (e.g. a down service with no declaration), say so explicitly rather than folding it into "All clear."
