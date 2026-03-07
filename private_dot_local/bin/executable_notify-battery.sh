#!/bin/bash
hyprctl notify -1 7000 "rgb(234080)" "Battery [$(cat /sys/class/power_supply/BAT0/capacity_level)]: $(cat /sys/class/power_supply/BAT0/status), $(cat /sys/class/power_supply/BAT0/capacity)%"
