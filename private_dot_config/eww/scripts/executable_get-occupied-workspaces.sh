#!/bin/sh
# Emit list of workspace IDs that have windows, then re-emit on changes

SOCK_DIR="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE"
# Fallback: find the socket if env vars are missing
if [ ! -d "$SOCK_DIR" ]; then
  SOCK_DIR=$(find /run/user/1000/hypr/ -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)
fi

hyprctl -j workspaces | jq -rc "[.[].id] | sort"
socat -u "UNIX-CONNECT:${SOCK_DIR}/.socket2.sock" - | while read -r line; do
  case "$line" in
    workspace\>*|destroyworkspace*|createworkspace*|movewindow*)
      hyprctl -j workspaces | jq -rc "[.[].id] | sort" ;;
  esac
done
