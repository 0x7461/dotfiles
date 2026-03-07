#!/bin/bash

# Define the notification color
COLOR="rgb(88c0d0)"

# Check for a force flag to remove wireplumber state
if [[ "$1" == "--force" ]]; then
    hyprctl notify -1 3000 "$COLOR" "Forcing restart: Clearing WirePlumber state..."
    rm -rf ~/.local/state/wireplumber/
fi

# Kill any running instances of the sound services
hyprctl notify -1 3000 "$COLOR" "Stopping sound services..."
killall pipewire pipewire-pulse wireplumber || true

# Wait for 3 seconds to ensure all services are fully shut down
sleep 3

# Restart the sound services
hyprctl notify -1 3000 "$COLOR" "Restarting sound services..."
pipewire &
pipewire-pulse &
wireplumber &

# Wait 3s to ensure services are restarted and show final confirmation
sleep 3
hyprctl notify -1 3000 "$COLOR" "Restarted sound services"

