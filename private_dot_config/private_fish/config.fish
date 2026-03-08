if status is-interactive
	# environment variables
	set -x EDITOR nvim
	set -x TERMINAL alacritty

	# starship prompt
	starship init fish | source

	# load scripts and executables from .local/bin into PATH
	set -gx PATH $PATH $HOME/.local/bin

	# auto-attach tmux on SSH sessions
	if set -q SSH_CONNECTION; and not set -q TMUX
		tmux attach -t main 2>/dev/null; or tmux new -s main
	end
end

# Auto-start Hyprland on TTY1 login (with D-Bus session)
if status is-login
    if test -z "$WAYLAND_DISPLAY"; and test "$XDG_VTNR" = "1"
        exec dbus-run-session -- Hyprland
    end
end

# proto
set -gx PROTO_HOME "$HOME/.proto";
set -gx PATH "$PROTO_HOME/shims" "$PROTO_HOME/bin" $PATH;
# peon-ping quick controls
function peon; bash /home/ta/.claude/hooks/peon-ping/peon.sh $argv; end
