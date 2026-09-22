#!/usr/bin/env bash
# Void laptop runner. Claude Code runs the status line in a non-login shell, so the
# proto shims are not on PATH. Try PATH first, then proto, then the system python.
SCRIPT="$HOME/.claude/statusline.py"

for cmd in python3 python; do
  command -v "$cmd" >/dev/null 2>&1 && exec "$cmd" "$SCRIPT"
done

for candidate in "$HOME/.proto/shims/python" "$HOME"/.proto/tools/python/*/bin/python3 /usr/bin/python3; do
  [ -x "$candidate" ] && exec "$candidate" "$SCRIPT"
done

echo "statusline: no python interpreter found"
