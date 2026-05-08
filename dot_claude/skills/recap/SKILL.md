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

Summary mode (default):
```sh
uv run python3 ~/.claude/scripts/recap.py $DAYS
```

Session detail mode (full conversation dump):
```sh
uv run python3 ~/.claude/scripts/recap.py $DAYS --session $SESSION_ID
```

Where `$DAYS` is the argument passed by the user (default: 3), and `$SESSION_ID` is the 8-char prefix shown in brackets in the summary output. Prefix matching is supported — shortest unambiguous prefix works.

### 3. Display the output

Show the output as-is — it's already formatted.

### 4. Offer to dig deeper

After showing the summary, ask if the user wants to:
- Use `--session <id>` to read the full conversation of a specific session
- Resume working on something from a past session
- Check what changed in a specific project

## Notes

- Sessions are identified by their first 8 chars of UUID shown in brackets
- The project path shows where Claude Code was running at the time
- Timestamps are local time
- **Telegram section**: shows recent conversations with The Smartass bot (ai-agent), grouped by 30min gaps. First and last user messages shown as topic indicators. Offer to continue any Telegram thread in the current CC session.

## Token burn rate

Running `/recap` itself is near-zero cost — it's a local subprocess with no API calls. The output is a few hundred tokens added to context at most. Use it freely at the start of a session to orient without paying context overhead.

The burn rate to watch is the **session context size**, shown as `cache/turn` in the recap output:
- `< 50K/turn` — healthy
- `50–150K/turn` — context getting heavy, watch it
- `> 150K/turn` — ⚠ consider starting a fresh session; each response is dragging a large context

A session grows heavy when it spans multiple days or covers many topics without a break. The fix is simple: start a new Claude Code session. History, command log, and file history persist — use `/recap` in the new session to re-orient cheaply.
