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

# Pi
fish_add_path "/home/ta/.pi/agent/bin"

# Claude Code: auto-compact off, whatever settings.json says. The /config toggle
# went missing once (found 2026-10-10); manual /compact still works.
set -gx DISABLE_AUTO_COMPACT 1
