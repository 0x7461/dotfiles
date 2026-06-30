function ccds --description "Launch Claude Code on DeepSeek's Anthropic-compatible endpoint"
    # DeepSeek key: prefer $DEEPSEEK_API_KEY, else the 600-perm key file.
    set -l key_file "$HOME/.config/deepseek/key"
    set -l key
    if set -q DEEPSEEK_API_KEY
        set key $DEEPSEEK_API_KEY
    else if test -r "$key_file"
        set key (string trim < "$key_file")
    end

    if test -z "$key"
        echo "ccds: no DeepSeek API key found." >&2
        echo "  → export \$DEEPSEEK_API_KEY, or write the key to $key_file (chmod 600)." >&2
        return 1
    end

    # Model IDs current as of 2026-06; legacy deepseek-chat/-reasoner retire 2026-07-24.
    # If launch errors with an unknown-model error, re-check https://api-docs.deepseek.com
    set -lx ANTHROPIC_BASE_URL             "https://api.deepseek.com/anthropic"
    set -lx ANTHROPIC_AUTH_TOKEN           "$key"
    set -lx ANTHROPIC_MODEL                "deepseek-v4-pro"
    set -lx ANTHROPIC_DEFAULT_OPUS_MODEL   "deepseek-v4-pro"
    set -lx ANTHROPIC_DEFAULT_SONNET_MODEL "deepseek-v4-pro"
    set -lx ANTHROPIC_DEFAULT_HAIKU_MODEL  "deepseek-v4-flash"
    set -lx CLAUDE_CODE_SUBAGENT_MODEL     "deepseek-v4-flash"
    set -lx CLAUDE_CODE_EFFORT_LEVEL       "max"

    # -u ANTHROPIC_API_KEY: a real Anthropic key outranks AUTH_TOKEN and would break
    # DeepSeek auth — strip it for this child only (parent shell untouched).
    env -u ANTHROPIC_API_KEY claude $argv
end
