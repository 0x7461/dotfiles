#!/bin/sh
# Idle daemon for niri. Replaces hypridle.
# Spawned by ~/.config/niri/config.kdl spawn-at-startup.
#
# Timings (mirror of the old hypridle.conf):
#   60s   kbd backlight off
#   300s  dim screen
#   600s  lock session
#   900s  power off monitors
#   3600s idle shutdown
# before-sleep: lock first.
# Note: `after-sleep` event is intentionally omitted — Void's swayidle is too
# old to support it, and niri restores monitors on resume on its own.

exec swayidle -w \
    timeout 60   'brightnessctl -sd rgb:kbd_backlight set 0' \
        resume   'brightnessctl -rd rgb:kbd_backlight' \
    timeout 300  'brightnessctl -s set 10' \
        resume   'brightnessctl -r' \
    timeout 600  'loginctl lock-session' \
        resume   'notify-send "Welcome back!"' \
    timeout 900  'niri msg action power-off-monitors' \
        resume   'niri msg action power-on-monitors && brightnessctl -r' \
    timeout 3600 'idle-shutdown' \
    before-sleep 'loginctl lock-session'
