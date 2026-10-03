function dsh --wraps dsh --description 'DeepSeek Harness: ~/.dsh/AGENTS.md rebuilt from the ithaca store, API key from its file'
    mkdir -p ~/.dsh
    and ~/.agents/scripts/compose-context.py ~/.dsh/AGENTS.md
    or return 1
    # dsh scrubs *KEY* names from every command it spawns (verified 2026-10-03), so the model's
    # shell never sees this.
    set -q DEEPSEEK_API_KEY
    or set -lx DEEPSEEK_API_KEY (string trim < ~/.config/deepseek/key)
    command dsh $argv
end
