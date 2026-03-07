#!/bin/sh
# Fetch weather from Open-Meteo using auto-detected location (ipinfo.io)
# Usage: get-weather.sh [icon|temp]
# Used by eww defpoll. Falls back to ☔️ on failure.

FALLBACK_ICON="☔️"
CACHE="/tmp/eww-weather.cache"
LOC_CACHE="/tmp/eww-weather-loc.cache"
MODE="${1:-icon}"

# Detect location — cache indefinitely (IP rarely changes)
if [ -f "$LOC_CACHE" ]; then
  loc=$(cat "$LOC_CACHE")
else
  loc=$(/usr/bin/curl -s -m 10 "https://ipinfo.io/json" 2>/dev/null | sed -n 's/.*"loc"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -n "$loc" ]; then
    printf '%s' "$loc" > "$LOC_CACHE"
  fi
fi

if [ -z "$loc" ]; then
  [ "$MODE" = "icon" ] && echo "$FALLBACK_ICON" || echo ""
  exit 0
fi

lat=$(echo "$loc" | cut -d',' -f1)
lon=$(echo "$loc" | cut -d',' -f2)

# Cache weather for 10 min so two polls don't make two requests
if [ -f "$CACHE" ] && [ "$(find "$CACHE" -mmin -10 2>/dev/null)" ]; then
  json=$(cat "$CACHE")
else
  URL="https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto&models=best_match"
  json=$(/usr/bin/curl -s -m 10 "$URL" 2>/dev/null)
  if [ -n "$json" ]; then
    printf '%s' "$json" > "$CACHE"
  fi
fi

if [ -z "$json" ]; then
  [ "$MODE" = "icon" ] && echo "$FALLBACK_ICON" || echo ""
  exit 0
fi

temp=$(printf '%s' "$json" | sed -n 's/.*"temperature":\([0-9.eE+-]*\).*/\1/p')
code=$(printf '%s' "$json" | sed -n 's/.*"weathercode":\([0-9]*\).*/\1/p')
is_day=$(printf '%s' "$json" | sed -n 's/.*"is_day":\([01]\).*/\1/p')

if [ -z "$temp" ] || [ -z "$code" ]; then
  [ "$MODE" = "icon" ] && echo "$FALLBACK_ICON" || echo ""
  exit 0
fi

if [ "$MODE" = "temp" ]; then
  temp_int=$(printf '%.0f' "$temp" 2>/dev/null || echo "$temp")
  echo "${temp_int}°C"
  exit 0
fi

# WMO weather code to emoji
case "$code" in
  0)                     icon=$([ "$is_day" = "1" ] && echo "☀️" || echo "🌙") ;;
  1|2)                   icon=$([ "$is_day" = "1" ] && echo "⛅" || echo "☁️") ;;
  3)                     icon="☁️" ;;
  45|48)                 icon="🌫️" ;;
  51|53|55)              icon="🌦️" ;;
  56|57)                 icon="🌧️" ;;
  61|63|65)              icon="🌧️" ;;
  66|67)                 icon="🌧️" ;;
  71|73|75|77)           icon="🌨️" ;;
  80|81|82)              icon="🌧️" ;;
  85|86)                 icon="🌨️" ;;
  95|96|99)              icon="⛈️" ;;
  *)                     icon="$FALLBACK_ICON" ;;
esac

echo "$icon"
