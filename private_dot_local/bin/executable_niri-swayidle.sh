#!/bin/sh
# Idle daemon for niri. Replaces hypridle.
# Spawned by ~/.config/niri/config.kdl spawn-at-startup.
#
# Timings (dim at 3m, lock + monitors off at 5m; same on battery and AC):
#   180s   kbd backlight off + dim screen
#   300s   lock session + power off monitors
# Silent playback does not inhibit idle: wayland-pipewire-idle-inhibit only
# holds the clock while PipeWire is actually outputting audio, so a muted or
# audio-less video still dims at 60s.
# before-sleep: lock first.
#
# hyprlock MUST be backgrounded (`&`). swayidle runs with -w (wait for each
# command to finish); hyprlock has no fork/daemonize flag and blocks in the
# foreground until unlock, so an un-backgrounded `hyprlock` at t=180 froze the
# timer chain and the t=300 power-off never fired (screen dimmed+locked but
# never off). before-sleep backgrounds it too, with a 1s guard so the lock renders
# before the system actually suspends. (Diagnosed & fixed 2026-06-01; the
# diagnostic `logger -t swayidle ...` prefixes were removed once confirmed.)

exec swayidle -w \
    timeout 180  'brightnessctl -sd rgb:kbd_backlight set 0' \
        resume   'brightnessctl -rd rgb:kbd_backlight' \
    timeout 180  'brightnessctl -s set 10' \
        resume   'brightnessctl -r' \
    timeout 300  'pidof hyprlock || hyprlock &' \
    timeout 300  'niri msg action power-off-monitors' \
        resume   'niri msg action power-on-monitors && brightnessctl -r' \
    before-sleep 'pidof hyprlock || hyprlock & sleep 1' \
    lock         'pidof hyprlock || hyprlock &' \
    unlock       'pkill -USR1 hyprlock'
