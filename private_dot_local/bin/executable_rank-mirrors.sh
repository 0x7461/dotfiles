#!/bin/sh
# Rank Void Linux mirrors by speed + freshness and print top results.
# Usage: rank-mirrors.sh [--refresh] [--top N]
#
# Scores mirrors on:
#   - Download speed (x86_64-repodata, ~2MB — the actual file xbps-install -S fetches)
#   - Freshness (Last-Modified header — stale mirrors get penalized)

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/void-mirrors"
MIRROR_LIST="$CACHE_DIR/mirrors.yaml"
PARSED_MIRRORS="$CACHE_DIR/mirrors-parsed.txt"
RESULTS="$CACHE_DIR/mirrors-ranked.txt"
TEST_FILE="current/x86_64-repodata"
REFRESH_INTERVAL=86400  # re-fetch mirror list after 24h
STALE_THRESHOLD=3600    # mirrors >1h behind newest are penalized

TOP=5
FORCE_REFRESH=false

for arg in "$@"; do
  case "$arg" in
    --refresh) FORCE_REFRESH=true ;;
    --top) shift_next=true ;;
    [0-9]*) [ "$shift_next" = true ] && TOP="$arg" && shift_next=false ;;
  esac
done

mkdir -p "$CACHE_DIR"

# Fetch mirror list if stale or missing
needs_refresh() {
  [ ! -f "$MIRROR_LIST" ] && return 0
  last=$(stat -c %Y "$MIRROR_LIST" 2>/dev/null || echo 0)
  now=$(date +%s)
  [ $((now - last)) -ge $REFRESH_INTERVAL ]
}

if [ "$FORCE_REFRESH" = true ] || needs_refresh; then
  echo "Fetching mirror list..." >&2
  curl -sf -m 15 'https://raw.githubusercontent.com/void-linux/xmirror/master/mirrors.yaml' -o "$MIRROR_LIST" || {
    echo "Error: failed to fetch mirror list" >&2
    exit 1
  }
fi

# Parse base_url entries
awk -F': ' '/base_url:/ {print $2}' "$MIRROR_LIST" > "$PARSED_MIRRORS"

total=$(wc -l < "$PARSED_MIRRORS")
echo "Testing $total mirrors (speed + freshness)..." >&2

# Test each mirror: download speed + Last-Modified timestamp
test_mirror() {
  url="$1"
  tmpfile=$(mktemp)
  result=$(curl -sf -D "$tmpfile" -o /dev/null \
    -w '%{size_download} %{time_total}' \
    -m 15 "${url}/${TEST_FILE}" 2>/dev/null)

  if [ $? -eq 0 ]; then
    size=$(echo "$result" | awk '{print $1}')
    total_time=$(echo "$result" | awk '{print $2}')

    # Extract Last-Modified as epoch
    last_mod=$(grep -i '^last-modified:' "$tmpfile" | sed 's/^[^:]*: //' | tr -d '\r')
    if [ -n "$last_mod" ]; then
      mod_epoch=$(date -d "$last_mod" +%s 2>/dev/null || echo 0)
    else
      mod_epoch=0
    fi

    # Use tab separator so awk parsing is unambiguous
    printf '%s\t%s\t%s\t%s\n' "$size" "$total_time" "$mod_epoch" "$url"
  fi
  rm -f "$tmpfile"
}

> "$RESULTS"
jobs_count=0
while IFS= read -r mirror; do
  test_mirror "$mirror" >> "$RESULTS" &
  jobs_count=$((jobs_count + 1))
  [ $jobs_count -ge 8 ] && wait && jobs_count=0
done < "$PARSED_MIRRORS"
wait

# Find the newest mirror timestamp
newest_epoch=$(awk -F'\t' '$3 > 0 {print $3}' "$RESULTS" | sort -rn | head -1)

# Score = download_time * freshness_penalty
# Fresh (<=1h behind newest): penalty 1.0
# Stale (>1h behind): penalty 2.0
# Unknown timestamp: penalty 1.5
awk -F'\t' -v newest="$newest_epoch" -v threshold="$STALE_THRESHOLD" '
{
  size = $1 + 0
  dl_time = $2 + 0
  mod_epoch = $3 + 0
  url = $4

  # Skip mirrors that returned no data
  if (size < 1000 || dl_time <= 0) next

  speed_mb = (size / dl_time) / 1048576

  if (newest > 0 && mod_epoch > 0) {
    age = newest - mod_epoch
    if (age > threshold) {
      penalty = 2.0
      flag = "stale"
    } else {
      penalty = 1.0
      flag = "fresh"
    }
  } else {
    penalty = 1.5
    flag = "unknown"
  }

  score = dl_time * penalty

  printf "%.6f\t%.1f\t%s\t%s\n", score, speed_mb, flag, url
}' "$RESULTS" | sort -t'	' -n > "$RESULTS.scored"

echo "" >&2
echo "Top $TOP mirrors:" >&2
echo "---"
head -n "$TOP" "$RESULTS.scored" | awk -F'\t' '{
  rank = NR
  score = $1
  speed = $2
  flag = $3
  url = $4
  tag = ""
  if (flag == "stale") tag = " [stale]"
  else if (flag == "unknown") tag = " [?]"
  printf "%d. %s (%.1f MB/s%s)\n", rank, url, speed, tag
}'
echo "---"
echo ""

best=$(head -1 "$RESULTS.scored" | awk -F'\t' '{print $4}')

printf "Update mirror to %s? [y/N] " "$best"
read -r answer
case "$answer" in
  [yY]|[yY][eE][sS])
    sudo xmirror -s "$best"
    ;;
  *)
    echo "Skipped. To apply manually:  sudo xmirror -s $best"
    ;;
esac
