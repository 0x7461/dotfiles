#!/usr/bin/env bash
# Claude Code status line — cwd | branch | model <E> | ctx · 5h · reset @ 7d [⚡]
# Receives session JSON via stdin.

input=$(cat)
ctx=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
five_h_raw=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage')
seven_d_raw=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage')
five_h=$(echo "${five_h_raw/null/0}" | cut -d. -f1)
seven_d=$(echo "${seven_d_raw/null/0}" | cut -d. -f1)
five_h_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // 0')
seven_d_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // 0')

# Only update the cache when rate_limits fields are actually present.
# Genuine 0% still writes; missing fields preserve the last good reading.
if [ "$five_h_raw" != "null" ] || [ "$seven_d_raw" != "null" ]; then
    mkdir -p "$HOME/.local/share/nagger"
    printf '{"five_hour":%s,"seven_day":%s,"five_hour_resets_at":%s,"seven_day_resets_at":%s}\n' \
        "$five_h" "$seven_d" "$five_h_reset" "$seven_d_reset" \
        > "$HOME/.local/share/nagger/rate-limits.json"
fi

model=$(echo "$input" | jq -r '.model.display_name // ""')
effort=$(echo "$input" | jq -r '.effort.level // ""')
exceeds_200k=$(echo "$input" | jq -r '.exceeds_200k_tokens // false')

case "$effort" in
    low)    effort_short="Lo"  ;;
    medium) effort_short="Md"  ;;
    high)   effort_short="Hi"  ;;
    xhigh)  effort_short="Hi+" ;;
    max)    effort_short="Mx"  ;;
    *)      effort_short=""    ;;
esac

model_part="${model}"
[ -n "$effort_short" ] && model_part="${model_part} (${effort_short})"

# 7-day reset countdown: Nd when >24h remain, Nh on the last day.
reset_str=""
if [ "$seven_d_reset" != "0" ] && [ "$seven_d_reset" != "null" ]; then
    remaining=$(( seven_d_reset - $(date +%s) ))
    if [ "$remaining" -ge 86400 ]; then
        reset_str="$((remaining / 86400))d"
    elif [ "$remaining" -gt 0 ]; then
        reset_str="$((remaining / 3600))h"
    fi
fi

if [ -n "$reset_str" ]; then
    usage="${ctx} · ${five_h} · ${reset_str} @ ${seven_d}"
else
    usage="${ctx} · ${five_h} · ${seven_d}"
fi
[ "$exceeds_200k" = "true" ] && usage="${usage} 2x"

branch=$(git branch --show-current 2>/dev/null)
cwd_part="${PWD}"
[ -n "$branch" ] && cwd_part="${cwd_part} (${branch})"

echo "${cwd_part} | ${model_part} | ${usage}"
