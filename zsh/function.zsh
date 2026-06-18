mkd() { mkdir -p "$1" && cd "$1"; }
#-----------------------------------------cd_to_where_Finder_opened
cdf() {
    local target_dir=$(osascript -e 'tell application "Finder" to return POSIX path of (target of window 1 as alias)' 2>/dev/null)
    if [[ -n "$target_dir" ]]; then
        cd "$target_dir"
    else
        echo "No open Finder window found"
    fi
}
#---------------------------------------------------------utilities
alias q="exit"
alias cd="z"
alias cd..="cd ../"
alias ..="cd ../"
alias ...="cd ../../"
alias ....="cd ../../../"
#------------------------------------------------------------eza/ls
alias eza="eza -I='.DS_Store|.localized|.CFUserTextEncoding' --group-directories-last"
alias ls="eza"
alias la="eza -lah"
alias tree="eza -T --level=4"
alias tg="eza -1a --git-ignore"
#----------------------------------------------------------packages
alias vim="nvim"
alias nvim.="nvim ."
alias nvim,="nvim ."
nvim() {
    [[ $1 == , ]] && set -- .
    command nvim "$@"
}
alias server="bunx serve"
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
#---------------------------------------------------------xdg_alias
alias adb="HOME=$XDG_DATA_HOME/android adb"
alias wget="wget --hsts-file=$XDG_DATA_HOME/wget-hsts"
alias mitmproxy="mitmproxy --set confdir=$XDG_CONFIG_HOME/mitmproxy"
alias mitmweb="mitmweb --set confdir=$XDG_CONFIG_HOME/mitmproxy"
