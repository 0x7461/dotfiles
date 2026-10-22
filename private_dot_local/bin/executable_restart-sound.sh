#!/bin/bash
# Notifications go through mako (notify-send), not `hyprctl notify` — niri has been the compositor
# since 2026-05-23, where hyprctl is a no-op (fixed 2026-10-23).

# Check for a force flag to remove wireplumber state
if [[ "$1" == "--force" ]]; then
    notify-send -a sound -t 3000 "Sound" "Forcing restart: clearing WirePlumber state..."
    rm -rf ~/.local/state/wireplumber/
fi

# Kill any running instances of the sound services
notify-send -a sound -t 3000 "Sound" "Stopping sound services..."
killall pipewire pipewire-pulse wireplumber || true

# Wait for 3 seconds to ensure all services are fully shut down
sleep 3

# Restart the sound services
notify-send -a sound -t 3000 "Sound" "Restarting sound services..."
pipewire &
pipewire-pulse &
wireplumber &

# Wait 3s to ensure services are restarted and show final confirmation
sleep 3
notify-send -a sound -t 3000 "Sound" "Restarted sound services"
