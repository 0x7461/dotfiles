#!/bin/bash
chosen=$(printf "Logout\nReboot\nShutdown" | wofi -d -p "Power Menu:")
case "$chosen" in
    "Logout")
	hyprctl dispatch exit ;;
    "Reboot")
	loginctl reboot ;;
    "Shutdown")
	loginctl poweroff ;;
    *)
        exit 1 ;;
esac

