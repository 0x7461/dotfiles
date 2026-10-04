#!/bin/sh
# Scheduled-slot worker for archivist-ig-sync: pause-gate → health preflight →
# sync → pause-on-block. Run by ./run via snooze at the scheduled time so the
# auth check is fresh (not stale from the previous 24h cycle).
cd /home/ta/projects/archivist
SVDIR="$(cd "$(dirname "$0")" && pwd)"
PAUSE="$SVDIR/paused"

# Auto-pause sentinel: a prior run hit a logged-out/blocked session. Stay parked
# until the user re-imports cookies and removes it — never browse IG with a
# known-bad session (that's how a soft-block escalates to a ban).
if [ -f "$PAUSE" ]; then
    echo "archivist-ig-sync: PAUSED ($(cat "$PAUSE")). Re-import cookies + rm $PAUSE to resume."
    exit 0
fi

# Health preflight — don't open a session if auth is already bad. 0=ok, 2=logged-out, 3=soft-blocked.
uv run --extra discovery smuggler-check-session instagram
rc=$?
if [ "$rc" -ne 0 ]; then
    echo "session-check rc=$rc at $(date -u +%FT%TZ)" > "$PAUSE"
    echo "archivist-ig-sync: session check failed (rc=$rc) — paused. Re-import cookies + rm $PAUSE."
    exit 0
fi

# Conservative: 20 new posts/account/day across followed IG accounts.
uv run --extra discovery archivist instagram archive following --limit 20
rc=$?
if [ "$rc" -eq 2 ]; then
    echo "sync exit=2 (session blocked mid-run) at $(date -u +%FT%TZ)" > "$PAUSE"
    echo "archivist-ig-sync: session blocked mid-run — paused. Re-import cookies + rm $PAUSE."
fi
exit 0
