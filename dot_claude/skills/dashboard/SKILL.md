---
name: dashboard
description: System dashboard — services, archiver status, packages, and project tasks. Use ONLY when the user explicitly asks about system status, running services, or "what needs attention". Do NOT trigger for questions about what to work on next or project ideas — those should read IDEAS.md directly.
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

Show a system status overview. Run all sections and present a concise summary.

## 1. User Services

Check all runit user services:

```sh
for svc in ~/service/*/; do
  name=$(basename "$svc")
  SVDIR=~/service sv status "$name" 2>&1
done
```

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
```

## 4. Project Tasks

Scan PLAN.md files for open items in either format:

```sh
for plan in ~/projects/*/PLAN.md; do
  project=$(basename $(dirname "$plan"))
  checkboxes=$(grep -c '^- \[ \]' "$plan" 2>/dev/null || echo 0)
  has_backlog=$(awk '/^## Backlog/{flag=1; next} /^## /{flag=0} flag && /^- /' "$plan" 2>/dev/null | wc -l)
  total=$((checkboxes + has_backlog))
  [ "$total" -gt 0 ] && echo "$project: $total open ($checkboxes checkboxes, $has_backlog backlog items)" || true
done
```

Most projects use the agent-docs `## Backlog` convention; older projects use `- [ ]` checkboxes. The scan covers both.

## Presentation

Summarize as a compact dashboard:
- Services: running/down
- Archiver: status output + failure count
- Packages: any outdated
- Tasks: open items per project

Flag anything that needs attention.

## 5. Verify

Re-read the assembled dashboard with one question: *"if the user only sees this summary, will they know whether anything needs immediate action?"* If not, add an explicit "**Action needed:** ..." line at the top. If everything is green, say "**All clear**" — silence reads as "skipped."
