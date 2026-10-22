#!/bin/bash
# Desktop (mako) notification, not Hyprland's own pipeline — niri has been the compositor since
# 2026-05-23, so `hyprctl notify` was a no-op (fixed 2026-10-23).
notify-send -a datetime -t 5000 "Date & Time" "$(date '+%A,  %b %-d | %H:%M')"
