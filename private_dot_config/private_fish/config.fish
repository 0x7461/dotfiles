if status is-interactive
	# environment variables
	set -x EDITOR nvim
	set -x TERMINAL alacritty

	# starship prompt
	starship init fish | source

	# load scripts and executables from .local/bin into PATH
	set -gx PATH $PATH $HOME/.local/bin
end

# proto
set -gx PROTO_HOME "$HOME/.proto";
set -gx PATH "$PROTO_HOME/shims" "$PROTO_HOME/bin" $PATH;
