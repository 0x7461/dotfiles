if status is-interactive
	# environment variables
	set -x EDITOR nvim
	set -x TERMINAL foot

	# starship prompt
	starship init fish | source

	# load scripts and executables from .local/bin into PATH
	set -gx PATH $PATH $HOME/.local/bin

	# GitHub SSH key: load once per agent lifetime instead of retyping ssh-add
	if not ssh-add -l 2>/dev/null | grep -q id_ed25519_gh
		ssh-add ~/.ssh/id_ed25519_gh
	end
end

# proto
set -gx PROTO_HOME "$HOME/.proto";
set -gx PATH "$PROTO_HOME/shims" "$PROTO_HOME/bin" $PATH;
