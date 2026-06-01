if status is-interactive
    and command -q tmux
    and not set -q TMUX
    if test "$USE_TMUX" = "1"
        # Terminals that opt in (alacritty) auto-attach. The tty console and
        # ghostty (USE_TMUX=0) deliberately stay out, so niri started from the
        # console never inherits $TMUX into the Wayland environment.
        exec tmux new-session -A -s main
    else if set -q SSH_CONNECTION
        # Remote logins attach to the shared session, creating it if needed.
        tmux attach -t main 2>/dev/null; or tmux new-session -s main
    end
end
