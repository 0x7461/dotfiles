#!/usr/bin/env python3
"""Summarize recent Claude Code sessions."""

import json
import sys
import datetime
from collections import defaultdict
from pathlib import Path

import argparse

parser = argparse.ArgumentParser()
parser.add_argument("days", nargs="?", type=int, default=3)
parser.add_argument("--session", type=str, default=None, help="Show full conversation for session prefix")
args = parser.parse_args()
days = args.days
session_filter = args.session

history_file = Path.home() / ".claude" / "history.jsonl"
cmd_log = Path.home() / ".claude" / "command-history.log"
sessions_dir = Path.home() / ".claude" / "projects" / "-home-ta"
# Fallback for transcripts CC's buggy cleanup deleted: hindsight archives raw lines
# into a SQLite DB daily. Queried directly (stdlib) — recap.py stays standalone.
archive_db = Path.home() / ".local" / "share" / "hindsight" / "archive.db"


def archive_session_lines(sid):
    """Raw transcript lines from hindsight's archive.db ([] if absent)."""
    if not archive_db.exists():
        return []
    import sqlite3
    con = sqlite3.connect(archive_db)
    try:
        return [r[0] for r in con.execute(
            "SELECT raw FROM records WHERE source='transcript' AND workspace='-home-ta' "
            "AND session_id=? ORDER BY seq", (sid,))]
    finally:
        con.close()


def archive_session_ids(prefix):
    """Archived session ids matching a prefix ([] if no archive)."""
    if not archive_db.exists():
        return []
    import sqlite3
    con = sqlite3.connect(archive_db)
    try:
        return [r[0] for r in con.execute(
            "SELECT DISTINCT session_id FROM records WHERE source='transcript' "
            "AND workspace='-home-ta' AND session_id LIKE ?", (prefix + "%",))]
    finally:
        con.close()

# -- Session detail mode --
if session_filter:
    sids = [p.stem for p in sessions_dir.glob(f"{session_filter}*.jsonl")]
    from_archive = False
    if not sids:
        sids = archive_session_ids(session_filter)
        from_archive = True
    if not sids:
        print(f"No session found matching '{session_filter}'")
        sys.exit(1)
    if len(sids) > 1:
        print(f"Ambiguous prefix '{session_filter}' matches {len(sids)} sessions:")
        for s in sids:
            print(f"  {s}")
        sys.exit(1)
    sid = sids[0]
    if from_archive:
        lines = archive_session_lines(sid)
        print(f"Session: [{sid[:8]}]  (hindsight archive)\n")
    else:
        with open(sessions_dir / f"{sid}.jsonl") as f:
            lines = f.readlines()
        print(f"Session: [{sid[:8]}]  {sessions_dir / (sid + '.jsonl')}\n")
    for line in lines:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        mtype = msg.get("type")
        content = msg.get("message", {}).get("content", "")
        if mtype == "user":
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "text":
                        t = c["text"].strip()
                        if t and not t.startswith("<"):
                            print(f"USER: {t[:600]}")
            elif isinstance(content, str) and content.strip():
                t = content.strip()
                if not t.startswith("<"):
                    print(f"USER: {t[:600]}")
        elif mtype == "assistant":
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "text":
                        t = c["text"].strip()
                        if t:
                            truncated = t[:400] + ("…" if len(t) > 400 else "")
                            print(f"ASST: {truncated}")
            elif isinstance(content, str) and content.strip():
                t = content.strip()
                truncated = t[:400] + ("…" if len(t) > 400 else "")
                print(f"ASST: {truncated}")
    sys.exit(0)

if not history_file.exists():
    print("No history file found.")
    sys.exit(0)

cutoff_ms = (datetime.datetime.now() - datetime.timedelta(days=days)).timestamp() * 1000

sessions = defaultdict(list)
session_meta = {}

with open(history_file) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("timestamp", 0) < cutoff_ms:
            continue
        sid = entry.get("sessionId", "unknown")
        sessions[sid].append(entry)
        ts = entry.get("timestamp", 0)
        if sid not in session_meta:
            session_meta[sid] = {
                "project": entry.get("project", "?"),
                "first_ts": ts,
                "last_ts": ts,
            }
        else:
            session_meta[sid]["last_ts"] = max(session_meta[sid]["last_ts"], ts)

if not sessions:
    print(f"No sessions in the last {days} day(s).")
    sys.exit(0)

sorted_sessions = sorted(session_meta.items(), key=lambda x: x[1]["first_ts"])

# Build session time ranges for correlating commands
session_ranges = []
for sid, meta in sorted_sessions:
    start = datetime.datetime.fromtimestamp(meta["first_ts"] / 1000)
    end = datetime.datetime.fromtimestamp(meta["last_ts"] / 1000) + datetime.timedelta(minutes=30)
    session_ranges.append((start, end, sid))

# Read command-history.log and correlate with sessions by timestamp
session_commands = defaultdict(list)
if cmd_log.exists():
    cutoff_dt = datetime.datetime.now() - datetime.timedelta(days=days)
    with open(cmd_log) as f:
        for line in f:
            line = line.strip()
            if not line or not line.startswith("["):
                continue
            try:
                ts_str = line[1:20]  # "2026-02-22 00:41:18"
                cmd_ts = datetime.datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
                cmd_text = line[22:].strip()
            except (ValueError, IndexError):
                continue
            if cmd_ts < cutoff_dt:
                continue
            for start, end, sid in session_ranges:
                if start <= cmd_ts <= end:
                    session_commands[sid].append(cmd_text)
                    break

# Read session JSONLs to extract modified files and token usage
session_files = defaultdict(dict)   # sid -> {path: max_version}
session_tokens = {}                  # sid -> {input, output, cache_read, cache_write, turns}

for sid in session_meta:
    jl = sessions_dir / f"{sid}.jsonl"
    if jl.exists():
        with open(jl) as f:
            lines = f.readlines()
    else:
        lines = archive_session_lines(sid)
    if not lines:
        continue
    file_versions = {}
    usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "turns": 0}
    for line in lines:
        # File history
        if "file-history-snapshot" in line:
            try:
                e = json.loads(line)
                if e.get("isSnapshotUpdate"):
                    for path, info in e.get("snapshot", {}).get("trackedFileBackups", {}).items():
                        v = info.get("version", 1)
                        file_versions[path] = max(file_versions.get(path, 0), v)
            except json.JSONDecodeError:
                pass
        # Token usage
        elif '"usage"' in line and '"type":"assistant"' in line:
            try:
                e = json.loads(line)
                if e.get("type") == "assistant":
                    u = e.get("message", {}).get("usage", {})
                    if u:
                        usage["input"]       += u.get("input_tokens", 0)
                        usage["output"]      += u.get("output_tokens", 0)
                        usage["cache_read"]  += u.get("cache_read_input_tokens", 0)
                        usage["cache_write"] += u.get("cache_creation_input_tokens", 0)
                        usage["turns"]       += 1
            except json.JSONDecodeError:
                pass
    session_files[sid] = {p: v for p, v in file_versions.items() if v > 1}
    if usage["turns"] > 0:
        session_tokens[sid] = usage

print(f"Last {days} day(s) — {len(sorted_sessions)} session(s)\n")

for sid, meta in sorted_sessions:
    msgs = sessions[sid]
    dt = datetime.datetime.fromtimestamp(meta["first_ts"] / 1000)
    project = meta["project"].replace(str(Path.home()), "~")
    cmds = session_commands.get(sid, [])
    files = session_files.get(sid, {})
    print(f"── {dt.strftime('%Y-%m-%d %H:%M')}  {project}  [{sid[:8]}]  {len(msgs)} msg  {len(cmds)} cmd  {len(files)} files")

    # Show up to 4 user messages
    shown = 0
    for msg in msgs:
        text = msg.get("display", "").strip()
        if not text:
            continue
        if len(text) > 110:
            text = text[:107] + "..."
        print(f"   • {text}")
        shown += 1
        if shown >= 4:
            break
    if len(msgs) > shown:
        print(f"   ... +{len(msgs) - shown} more")

    # Show up to 3 commands
    if cmds:
        for cmd in cmds[:3]:
            short = cmd[:80] + "..." if len(cmd) > 80 else cmd
            print(f"   $ {short}")
        if len(cmds) > 3:
            print(f"   ... +{len(cmds) - 3} more cmd")

    # Show top edited files (sorted by version count descending)
    if files:
        top = sorted(files.items(), key=lambda x: -x[1])[:5]
        for path, v in top:
            print(f"   ~ {path}  (v{v})")
        if len(files) > 5:
            print(f"   ... +{len(files) - 5} more files")

    # Show token usage and burn rate warning
    tok = session_tokens.get(sid)
    if tok and tok["turns"] > 0:
        cache_per_turn = tok["cache_read"] // tok["turns"]
        out_k  = tok["output"] // 1000
        cr_m   = tok["cache_read"] // 1_000_000
        cw_k   = tok["cache_write"] // 1000
        if cache_per_turn > 150_000:
            warn = "⚠ context very heavy — consider fresh session"
        elif cache_per_turn > 50_000:
            warn = "~ context getting heavy"
        else:
            warn = "ok"
        print(f"   tokens: out {out_k}K  cache_read {cr_m}M  cache/turn {cache_per_turn//1000}K  [{warn}]")

    print()
