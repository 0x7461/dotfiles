---
name: recap
description: Summarize recent Claude Code sessions from history. Shows what was worked on, grouped by session. Use /recap or /recap <days> (default 3).
user-invocable: true
allowed-tools:
  - Bash
---

Show a summary of recent Claude Code sessions.

## Steps

### 1. Load required tools

Call `ToolSearch` with query `select:Bash` to ensure the Bash tool is loaded before use.

### 2. Run the recap script

```sh
uv run python3 ~/.claude/scripts/recap.py $DAYS
```

Where `$DAYS` is the argument passed by the user (default: 3 if not provided).

### 3. Display the output

Show the session summary as-is — it's already formatted.

### 4. Offer to dig deeper

After showing the summary, ask if the user wants to:
- See more messages from a specific session
- Resume working on something from a past session
- Check what changed in a specific project

## Notes

- Sessions are identified by their first 8 chars of UUID shown in brackets
- The project path shows where Claude Code was running at the time
- Timestamps are local time

## Token burn rate

Running `/recap` itself is near-zero cost — it's a local subprocess with no API calls. The output is a few hundred tokens added to context at most. Use it freely at the start of a session to orient without paying context overhead.

The burn rate to watch is the **session context size**, shown as `cache/turn` in the recap output:
- `< 50K/turn` — healthy
- `50–150K/turn` — context getting heavy, watch it
- `> 150K/turn` — ⚠ consider starting a fresh session; each response is dragging a large context

A session grows heavy when it spans multiple days or covers many topics without a break. The fix is simple: start a new Claude Code session. History, command log, and file history persist — use `/recap` in the new session to re-orient cheaply.
