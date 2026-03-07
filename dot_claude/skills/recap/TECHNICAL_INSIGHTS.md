# Recap — Technical Insights

## Data sources and formats

**history.jsonl** (`~/.claude/history.jsonl`)
- One JSON line per user message: `{timestamp (ms), sessionId, project, display}`
- Filter by `timestamp >= cutoff_ms` — never Read the whole file (9MB+)

**command-history.log** (`~/.claude/command-history.log`)
- Format: `[YYYY-MM-DD HH:MM:SS] command text` (local time)
- Written by `audit-commands.sh` PreToolUse hook
- No session IDs — correlate to sessions by timestamp range (session first_ts → last_ts + 30 min buffer)

**Session JSONL** (`~/.claude/projects/-home-ta/{sessionId}.jsonl`)
- Contains full conversation including tool calls
- Entry types: `user`, `assistant`, `file-history-snapshot`, `progress`, `queue-operation`, `system`
- `file-history-snapshot` with `isSnapshotUpdate: true` → `snapshot.trackedFileBackups` maps relative file paths to `{version, backupTime}`. Version > 1 = file was edited.
- `assistant` entries with `message.usage` → `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`
- Fast filter: check `"file-history-snapshot" in line` or `'"usage"' in line and '"type":"assistant"' in line` before parsing JSON

**stats-cache.json** (`~/.claude/stats-cache.json`)
- Stale — last computed date may be weeks old. Don't use for recent token data; use session JSONL instead.

## Token burn rate thresholds (cache_read / turns)
- `< 50K/turn` — healthy
- `50–150K/turn` — context getting heavy
- `> 150K/turn` — warn: consider fresh session
