---
name: archiver
description: Check archiver status, run sync, view logs, or manage followed accounts. Use when the user asks about archiver, stories, sync status, or wants to archive something.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

Interface with the social media archiver at `~/projects/archiver`.

Usage examples:
- `/archiver` — show status (last run, accounts, any errors)
- `/archiver sync` — run a full sync now
- `/archiver sync instagram` — sync a specific platform
- `/archiver logs` — show recent log output
- `/archiver logs instagram` — platform-specific logs
- `/archiver follow @user instagram` — follow an account
- `/archiver skip @user instagram` — skip account for 12h

## Archiver commands

All commands run from `~/projects/archiver` with `uv run archiver`.

### Status check (default, no args)

1. Show runit service status:
```sh
sv status ~/service/archiver ~/service/archiver-stories
```

2. Show recent logs:
```sh
tail -n 20 ~/service/archiver/log/main/current | cat
tail -n 20 ~/service/archiver-stories/log/main/current | cat
```

3. Show followed accounts:
```sh
cd ~/projects/archiver && uv run archiver list
```

4. Check for recent errors:
```sh
grep -i "error\|fail\|rate limit" ~/service/archiver/log/main/current | tail -20 | cat
```

5. Show archive size summary:
```sh
du -sh ~/archive/*/  2>/dev/null
```

### Sync

```sh
cd ~/projects/archiver
uv run archiver sync [platform]
```

Platform can be: `tiktok`, `facebook`, `instagram`, or omitted for all.

Watch for rate limit messages — if seen, the sync will auto-skip the affected account for 12h.

### Logs

```sh
# All recent logs
tail -n 50 ~/service/archiver/log/main/current | cat

# Stories logs
tail -n 50 ~/service/archiver-stories/log/main/current | cat

# Platform-specific (grep)
grep -i "<platform>" ~/service/archiver/log/main/current | tail -30 | cat
```

### Follow / unfollow

```sh
cd ~/projects/archiver
uv run archiver <platform> follow @username
uv run archiver <platform> unfollow @username
```

### Skip (rate limit bypass)

```sh
cd ~/projects/archiver
uv run archiver <platform> skip @username [--hours N]
```

Default: 12h. Use after manual rate limit detection.

## Notes

- Runit services: `~/service/archiver` (daily sync via snooze), `~/service/archiver-stories` (stories)
- Logs: `~/service/archiver/log/main/current`, `~/service/archiver-stories/log/main/current`
- Archive location: `~/archive/`
- Config: `~/archive/config.json` (gitignored — never read or display credentials)
- DB: `~/archive/archiver.db` (SQLite — track downloaded items)
- Rate limits: Facebook 5-15s, Instagram 3-8s, TikTok/YouTube via yt-dlp sleep intervals
- RateLimitError auto-triggers 12h skip for the affected account
