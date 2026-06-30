function fish_greeting
    # no greeting in the niri scratch terminal (#79)
    if set -q SCRATCH_TERM
        return
    end

    set -l cow (fortune -s | iconv -c -f UTF-8 -t ASCII//TRANSLIT | cowsay)
    # find the widest line to right-align as a block
    set -l max_width 0
    for line in $cow
        set -l w (string length -- $line)
        if test $w -gt $max_width
            set max_width $w
        end
    end
    set -l cols (tput cols)
    set -l pad (math "$cols - $max_width - 3")
    if test $pad -lt 0
        set pad 0
    end
    set -l spaces (string repeat -n $pad ' ')
    echo
    for line in $cow
        printf '%s%s\n' $spaces $line
    end
end
