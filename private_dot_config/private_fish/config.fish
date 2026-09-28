if status is-interactive
	# environment variables
	set -x EDITOR nvim
	set -x TERMINAL foot

	# starship prompt
	starship init fish | source

	# load scripts and executables from .local/bin into PATH
	set -gx PATH $PATH $HOME/.local/bin
end

# mise (Go, Node): PATH hooks in interactive shells, shims everywhere else
if status is-interactive
	mise activate fish | source
else
	mise activate fish --shims | source
end
