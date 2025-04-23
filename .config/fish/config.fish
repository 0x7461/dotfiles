if status is-interactive
	# environment variables
	set -x EDITOR nvim
	set -x TERMINAL ghostty

	# starship prompt
	starship init fish | source
end
