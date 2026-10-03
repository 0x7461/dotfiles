function codex --wraps codex --description 'Codex CLI with ~/.codex/AGENTS.md rebuilt from the ithaca store first'
    mkdir -p ~/.codex
    and ~/.agents/scripts/compose-context.py ~/.codex/AGENTS.md
    or return 1
    command codex $argv
end
