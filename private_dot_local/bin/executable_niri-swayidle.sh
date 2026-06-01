#!/bin/sh
# Idle daemon for niri. Replaces hypridle.
# Spawned by ~/.config/niri/config.kdl spawn-at-startup.
#
# Timings:
#   60s    kbd backlight off
#   600s   dim screen
#   900s   lock session
#   1200s  power off monitors
# before-sleep: lock first.
#
# hyprlock MUST be backgrounded (`&`). swayidle runs with -w (wait for each
# command to finish); hyprlock has no fork/daemonize flag and blocks in the
# foreground until unlock, so an un-backgrounded `hyprlock` at t=900 froze the
# timer chain and t=1200 power-off never fired (screen dimmed+locked but never
# off). before-sleep backgrounds it too, with a 1s guard so the lock renders
# before the system actually suspends. (Diagnosed & fixed 2026-06-01; the
# diagnostic `logger -t swayidle ...` prefixes were removed once confirmed.)

exec swayidle -w \
    timeout 60   'brightnessctl -sd rgb:kbd_backlight set 0' \
        resume   'brightnessctl -rd rgb:kbd_backlight' \
    timeout 600  'brightnessctl -s set 10' \
        resume   'brightnessctl -r' \
    timeout 900  'pidof hyprlock || hyprlock &' \
    timeout 1200 'niri msg action power-off-monitors' \
        resume   'niri msg action power-on-monitors && brightnessctl -r' \
    before-sleep 'pidof hyprlock || hyprlock & sleep 1' \
    lock         'pidof hyprlock || hyprlock &' \
    unlock       'pkill -USR1 hyprlock'
