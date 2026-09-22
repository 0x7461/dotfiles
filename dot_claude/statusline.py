#!/usr/bin/env python3
"""Claude Code status line. One row. It drops low-value parts on a narrow terminal.

Shared by the Void laptop and the work machine. The only machine-specific piece is the
runner script that finds a Python interpreter; this file is portable.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

ANSI = re.compile(r"\x1b\[[0-9;]*m")
RESET = "\x1b[0m"
SEP = "\x1b[2m│\x1b[0m"

# Screen order is the list order. The rank decides what stays when the row is too
# wide. A higher rank stays on the row longer.
KEEP = {
    "dir": 99, "model": 80, "ctx": 70, "limit5h": 60,
    "cost": 50, "limit7d": 40, "pr": 35, "style": 30, "vim": 25,
    "spend": 15,
}

EFFORT = {"low": "Lo", "medium": "Md", "high": "Hi", "xhigh": "Hi+", "max": "Mx"}


def paint(code, text):
    return "\x1b[%sm%s%s" % (code, text, RESET)


def vlen(text):
    return len(ANSI.sub("", text))


def heat(pct):
    """Green below 50 percent. Yellow below 75 percent. Red above that.

    Colour is decoration only. Every meter also prints its number and a text tag,
    so the row stays readable without colour vision.
    """
    if pct is None:
        return "2"
    if pct < 50:
        return "32"
    if pct < 75:
        return "33"
    return "31"


def pct_int(value):
    """Truncate a percentage to an int. Return None when absent."""
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def short_head(cwd):
    """Return the short commit id. Return an empty string when git fails."""
    try:
        run = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=2,
        )
        if run.returncode == 0:
            return run.stdout.strip()
    except Exception:
        pass
    return ""


def git_state(cwd):
    """Read the branch name and the dirty file count. The result caches for 3 seconds."""
    key = hashlib.md5(cwd.encode("utf-8", "replace")).hexdigest()[:12]
    path = os.path.join(tempfile.gettempdir(), "cc-status-git-%s.json" % key)
    try:
        if time.time() - os.stat(path).st_mtime < 3:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
    except Exception:
        pass
    state = {"branch": None, "dirty": 0}
    try:
        run = subprocess.run(
            ["git", "-C", cwd, "status", "--porcelain=v1", "-b"],
            capture_output=True, text=True, timeout=2,
        )
        if run.returncode == 0:
            lines = run.stdout.splitlines()
            if lines and lines[0].startswith("##"):
                head = lines[0][3:].split("...")[0].strip()
                if head == "HEAD (no branch)":
                    head = "detached " + short_head(cwd)
                state["branch"] = head
                state["dirty"] = len(lines) - 1
    except Exception:
        pass
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
    except Exception:
        pass
    return state


def write_nagger_cache(rl):
    """Mirror the rate limits to nagger's pace cache.

    botkit's nagger reads ~/.local/share/nagger/rate-limits.json. Only write when a
    rate_limits field is actually present: a genuine 0% must still write, but missing
    fields must preserve the last good reading. Skipped where ~/.local/share does not
    exist, which is how this stays a no-op on the work machine.
    """
    five = rl.get("five_hour") or {}
    seven = rl.get("seven_day") or {}
    five_pct = pct_int(five.get("used_percentage"))
    seven_pct = pct_int(seven.get("used_percentage"))
    if five_pct is None and seven_pct is None:
        return
    share = os.path.join(os.path.expanduser("~"), ".local", "share")
    if not os.path.isdir(share):
        return
    payload = {
        "five_hour": five_pct or 0,
        "seven_day": seven_pct or 0,
        "five_hour_resets_at": five.get("resets_at") or 0,
        "seven_day_resets_at": seven.get("resets_at") or 0,
    }
    try:
        target = os.path.join(share, "nagger")
        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, "rate-limits.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
            fh.write("\n")
    except Exception:
        pass


def countdown(resets_at):
    """Render the time left before a limit resets. Nd above a day, else Nh."""
    try:
        remaining = int(resets_at) - int(time.time())
    except (TypeError, ValueError):
        return ""
    if remaining >= 86400:
        return "%dd" % (remaining // 86400)
    if remaining > 0:
        return "%dh" % (remaining // 3600)
    return ""


def build(d):
    parts = []

    def add(name, text):
        if text:
            parts.append((KEEP[name], text))

    # Place
    cwd = (d.get("workspace") or {}).get("current_dir") or d.get("cwd") or ""
    here = os.path.basename(cwd.rstrip("/\\")) or cwd
    wt = (d.get("workspace") or {}).get("git_worktree")
    g = git_state(cwd) if cwd else {"branch": None, "dirty": 0}

    place = paint("36", here) if here else ""
    if g.get("branch"):
        mark = "*%d" % g["dirty"] if g["dirty"] else ""
        colour = "33" if g["dirty"] else "32"
        label = g["branch"] + mark
        if wt:
            label = "%s@%s" % (label, wt)
        wrapped = paint("2", "(") + paint(colour, label) + paint("2", ")")
        place = place + " " + wrapped if place else wrapped
    add("dir", place)

    pr = d.get("pr") or {}
    if pr.get("number"):
        flag = {"approved": "ok", "pending": "wait",
                "changes_requested": "chg", "draft": "draft"}
        tail = flag.get(pr.get("review_state"), "")
        kind = "MR" if pr.get("kind") == "mr" else "PR"
        add("pr", paint("35", "%s#%s%s" % (kind, pr["number"], " " + tail if tail else "")))

    # Model and config
    model = (d.get("model") or {}).get("display_name") or "?"
    # "Opus 5 (1M context)" becomes "Opus 5 [1M]".
    if model.endswith("context)") and "(" in model:
        head, _, tail = model.partition("(")
        size = tail[:-len("context)")].strip()
        if size:
            model = "%s [%s]" % (head.strip(), size)
    bits = [paint("1", model)]
    eff = (d.get("effort") or {}).get("level")
    if eff:
        bits.append(paint("2", EFFORT.get(str(eff), str(eff))))
    if d.get("fast_mode"):
        bits.append(paint("36", "fast"))
    if (d.get("thinking") or {}).get("enabled"):
        bits.append(paint("2", "think"))
    add("model", " ".join(bits))

    style = (d.get("output_style") or {}).get("name")
    if style and style != "default":
        add("style", paint("2", style[:18]))

    vim = (d.get("vim") or {}).get("mode")
    if vim:
        add("vim", paint("34", vim))

    # Context. The 2x marker means the session exceeds the 200k tier.
    ctx = d.get("context_window") or {}
    pct = pct_int(ctx.get("used_percentage"))
    if pct is not None:
        text = "ctx %d%%" % pct
        if d.get("exceeds_200k_tokens"):
            text += " 2x"
        add("ctx", paint(heat(pct), text))

    # Limits and cost
    rl = d.get("rate_limits") or {}
    write_nagger_cache(rl)
    for key, name, tag in (("five_hour", "limit5h", "5h"),
                           ("seven_day", "limit7d", "7d"),
                           ("spend_limit", "spend", "spend")):
        win = rl.get(key) or {}
        p = pct_int(win.get("used_percentage"))
        if p is None:
            continue
        text = "%s %d%%" % (tag, p)
        # The 7-day window carries a reset countdown; it is the one worth pacing against.
        if key == "seven_day":
            left = countdown(win.get("resets_at"))
            if left:
                text += " (%s)" % left
        add(name, paint(heat(p), text))

    cost = d.get("cost") or {}
    usd = cost.get("total_cost_usd")
    if usd is not None:
        add("cost", paint("2", "$%.2f" % usd))
    return parts


def render(parts, width):
    """Drop the lowest-rank part until the row fits the terminal width."""
    keep = list(parts)
    while keep:
        row = (" %s " % SEP).join(text for _, text in keep)
        if vlen(row) <= width:
            return row
        worst = min(range(len(keep)), key=lambda i: keep[i][0])
        keep.pop(worst)
    return ""


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except Exception:
        data = {}
    try:
        width = int(os.environ.get("COLUMNS") or 120) - 2
    except ValueError:
        width = 118
    print(render(build(data), max(width, 20)))


if __name__ == "__main__":
    main()
