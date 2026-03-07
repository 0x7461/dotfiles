#!/bin/sh
# Start PipeWire audio stack (used by Hyprland autostart)
# Kill stale instances from previous sessions
killall pipewire pipewire-pulse wireplumber 2>/dev/null
sleep 1

# Start in order: pipewire first, then wireplumber needs a moment
pipewire &
pipewire-pulse &
sleep 1
wireplumber &
