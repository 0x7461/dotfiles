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

Recent sync activity:

```sh
# Last sync entries per service
for log in ~/service/archiver/log/main/current ~/service/archiver-stories/log/main/current; do
  [ -f "$log" ] && echo "=== $(basename $(dirname $(dirname "$log"))) ===" && grep -E "(Syncing|Done:|Saved:|Failed:|No active)" "$log" | tail -10
done
```

Tracked accounts and download counts:

```sh
sqlite3 ~/projects/archiver/archiver.db "SELECT platform, COUNT(*) as total FROM downloads GROUP BY platform;"
sqlite3 ~/projects/archiver/archiver.db "SELECT platform, author, download_date FROM downloads ORDER BY download_date DESC LIMIT 5;"
```

Recent download failures (last 7 days):

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

Scan PLAN.md files for open items:

```sh
for plan in ~/projects/*/PLAN.md; do
  project=$(basename $(dirname "$plan"))
  open=$(grep -c '^\- \[ \]' "$plan" 2>/dev/null || echo 0)
  [ "$open" -gt 0 ] && echo "$project: $open open task(s)"
done
```

## Presentation

Summarize as a compact dashboard:
- Services: running/down
- Archiver: last sync time, recent failures (flag if any in last 7 days), new downloads
- Packages: any outdated
- Tasks: open items per project

Flag anything that needs attention.
