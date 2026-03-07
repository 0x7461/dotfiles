#!/bin/sh

CACHE_DIR="$HOME/.local/cache/void-mirrors"
MIRROR_LIST="$CACHE_DIR/mirrors.txt"
PARSED_MIRRORS="$CACHE_DIR/mirrors-parsed.txt"
SORTED_MIRRORS="$CACHE_DIR/mirrors-sorted.txt"
LOG_FILE="$CACHE_DIR/mirror-rank.log"
TEST_FILE="current/bootstrap/x86_64-repodata"
MIRROR_REFRESH_INTERVAL=86400  # 24 hours

mkdir -p "$CACHE_DIR"

log() {
    echo "$(date +'%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

test_speed() {
    local url="$1"
    local curl_opts="-o /dev/null --write-out '%{time_total}' --max-time 10"
    [ "$VERBOSE" = true ] || curl_opts="-s $curl_opts"
    local result=$(curl $curl_opts "${url}/${TEST_FILE}")
    if [ $? -ne 0 ]; then
        log "Mirror unreachable or timed out: $url"
        echo "999999999 $url"
    else
        echo "$result $url"
    fi
}

check_mirror() {
    local url="$1"
    curl -s -I --connect-timeout 5 "$url" > /dev/null 2>&1
    return $?
}

needs_refresh() {
    [ ! -f "$MIRROR_LIST" ] && return 0
    local last_update=$(stat -c %Y "$MIRROR_LIST")
    local current_time=$(date +%s)
    [ $((current_time - last_update)) -ge $MIRROR_REFRESH_INTERVAL ]
}

FORCE_REFRESH=false
VERBOSE=false

log "Starting Void Linux mirror ranking script."

for arg in "$@"; do
    case "$arg" in
        --refresh)
            FORCE_REFRESH=true
            ;;
        --verbose)
            VERBOSE=true
            ;;
    esac
done

if $FORCE_REFRESH || needs_refresh; then
    log "Fetching latest mirror list..."
    curl_opts="-s"
    [ "$VERBOSE" = true ] && curl_opts=""
    curl $curl_opts 'https://raw.githubusercontent.com/void-linux/xmirror/master/mirrors.yaml' -o "$MIRROR_LIST"
    [ $? -ne 0 ] && log "Error fetching mirror list." && exit 1
    log "Fetched latest mirror list."
    log "Parsing mirror list..."
    awk -F': ' '/base_url:/ {print $2}' "$MIRROR_LIST" > "$PARSED_MIRRORS"
    if [ $? -ne 0 ]; then
        log "Error parsing mirror list with awk."
        # Handle the error (e.g., exit, try again)
    fi
    log "Sorting mirrors by speed..."
    > "$SORTED_MIRRORS"
    for mirror in $(cat "$PARSED_MIRRORS"); do
        log "Testing $mirror..."
        if check_mirror "$mirror"; then
            test_speed "$mirror" >> "$SORTED_MIRRORS"
        else
            log "Mirror $mirror is unreachable. Skipping."
            echo "999999999 $mirror" >> "$SORTED_MIRRORS"
        fi
    done
    sort -n -o "$SORTED_MIRRORS" "$SORTED_MIRRORS"
else
    log "Using cached mirror list."
    log "Using cached parsed mirror list."
    log "Using cached sorted mirror list."
fi

log "Top 3 fastest mirrors:"
head -n 3 "$SORTED_MIRRORS" | awk '{print NR ". " $2 " (" $1 "s)"}'

