function gds --description "Launch goose on DeepSeek (plain 'goose' stays on local ollama)"
    # DeepSeek key: prefer $DEEPSEEK_API_KEY, else the 600-perm key file (same as ccds).
    set -l key_file "$HOME/.config/deepseek/key"
    set -l key
    if set -q DEEPSEEK_API_KEY
        set key $DEEPSEEK_API_KEY
    else if test -r "$key_file"
        set key (string trim < "$key_file")
    end

    if test -z "$key"
        echo "gds: no DeepSeek API key found." >&2
        echo "  → export \$DEEPSEEK_API_KEY, or write the key to $key_file (chmod 600)." >&2
        return 1
    end

    # Model overridable via GOOSE_MODEL (e.g. deepseek-v4-flash for cheap runs).
    set -q GOOSE_MODEL; or set -l GOOSE_MODEL deepseek-v4-pro

    env DEEPSEEK_API_KEY="$key" GOOSE_PROVIDER=custom_deepseek GOOSE_MODEL="$GOOSE_MODEL" goose $argv
end
