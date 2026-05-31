#------------------------------------------------------------widget
copy-command() {
    echo -n "$BUFFER" | pbcopy
}
#---------------------------------------------------register_widget
zle -N copy-command
#-----------------------------------------------------------bindkey
bindkey -e
bindkey "^Xc" copy-command
bindkey "^p" history-search-backward
bindkey "^n" history-search-forward
