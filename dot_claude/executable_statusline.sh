#!/usr/bin/env bash
# Void laptop runner. Claude Code runs the status line in a non-login shell, so PATH
# may be minimal. Try PATH first, then the system python.
SCRIPT="$HOME/.claude/statusline.py"

for cmd in python3 python; do
  command -v "$cmd" >/dev/null 2>&1 && exec "$cmd" "$SCRIPT"
done

[ -x /usr/bin/python3 ] && exec /usr/bin/python3 "$SCRIPT"

echo "statusline: no python interpreter found"
