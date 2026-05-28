if status is-interactive
    and command -q tmux
    and not set -q TMUX
    and test "$USE_TMUX" != "0"
    if tmux has-session -t main 2>/dev/null
        exec tmux new-session -t main
    else
        exec tmux new-session -s main
    end
end
