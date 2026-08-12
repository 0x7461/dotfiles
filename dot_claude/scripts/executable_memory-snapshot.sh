#!/bin/sh
# Weekly git snapshot of the Claude memory store.
#
# Backstop only — /housekeeping is the primary commit path. This exists so a
# week of curation is never lost to an unnoticed deletion or a wiped tree.
#
# Fires from a wide daily window (see ~/service/memory-snapshot/run) but
# dedups on ISO week, so it commits at most once per week and still runs if
# the laptop was off on any given day.

set -u

MEM="${MEMORY_DIR:-/home/ta/.claude/projects/-home-ta/memory}"
STATE_DIR="${MEMORY_SNAPSHOT_STATE:-/home/ta/.local/state/memory-snapshot}"
STATE="$STATE_DIR/last-week"
WEEK=$(date +%G-W%V)

mkdir -p "$STATE_DIR"

if [ "$(cat "$STATE" 2>/dev/null)" = "$WEEK" ]; then
    exit 0                      # already handled this week
fi

cd "$MEM" || { echo "memory-snapshot: $MEM missing"; exit 1; }

if [ ! -e .git ]; then
    echo "memory-snapshot: not a git repo (expected .git pointer to ~/.local/share/claude-memory.git)"
    exit 1
fi

if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    echo "memory-snapshot: $WEEK — no changes"
    echo "$WEEK" > "$STATE"
    exit 0
fi

added=$(git status --porcelain | grep -c '^??')
modified=$(git status --porcelain | grep -c '^ M')
deleted=$(git status --porcelain | grep -c '^ D')

# Record integrity in the message rather than refusing to commit — a broken
# state still deserves a backup, it just needs to be visibly flagged.
if check=$(MEMORY_DIR="$MEM" python3 /home/ta/.claude/scripts/memcheck.py 2>&1); then
    integrity=$(echo "$check" | head -1 | sed 's/^memcheck: //')
else
    integrity="FAILING — $(echo "$check" | head -1 | sed 's/^memcheck: //')"
fi

git add -A || exit 1
git commit -q -F - <<EOF
Weekly snapshot $WEEK

added $added, modified $modified, deleted $deleted
memcheck: $integrity

Automated by ~/service/memory-snapshot. Primary commit path is /housekeeping.
EOF

echo "memory-snapshot: $WEEK — committed (+$added ~$modified -$deleted); $integrity"
echo "$WEEK" > "$STATE"
