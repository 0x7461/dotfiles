#!/bin/sh
level=$(cat /sys/class/power_supply/BAT0/capacity_level)
status=$(cat /sys/class/power_supply/BAT0/status)
pct=$(cat /sys/class/power_supply/BAT0/capacity)
notify-send -t 7000 "Battery [$level]" "$status, $pct%"
