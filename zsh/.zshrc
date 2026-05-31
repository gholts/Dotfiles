#------------------------------------------------------------------
#     █████████  █████               ████   █████
#    ███░░░░░███░░███               ░░███  ░░███
#   ███     ░░░  ░███████    ██████  ░███  ███████    █████
#  ░███          ░███░░███  ███░░███ ░███ ░░░███░    ███░░
#  ░███    █████ ░███ ░███ ░███ ░███ ░███   ░███    ░░█████
#  ░░███  ░░███  ░███ ░███ ░███ ░███ ░███   ░███ ███ ░░░░███
#   ░░█████████  ████ █████░░██████  █████  ░░█████  ██████
#    ░░░░░░░░░  ░░░░ ░░░░░  ░░░░░░  ░░░░░    ░░░░░  ░░░░░░
#------------------------------------------------------zsh_settings
HISTSIZE=5000                          # history file size
SAVEHIST=$HISTSIZE                     # saved history size
HISTFILE="$XDG_STATE_HOME/zsh/history" # history file dir
setopt hist_ignore_space               # ignore only space history
setopt appendhistory                   # save history when session ended
setopt sharehistory                    # history across different session
setopt correct                         # zsh auto correction
# no dup historys
HISTDUP=erase
setopt hist_ignore_all_dups
setopt hist_ignore_dups
setopt hist_save_no_dups
setopt hist_find_no_dups
#----------------------------------------------------zsh_completion
# fzf-tab completion style
zstyle ':completion:*:descriptions' format "[%d]"
zstyle ':fzf-tab:*' fzf-flags --height=40% --min-height=15
zstyle ':fzf-tab:*' fzf-preview '[[ -d $realpath ]] && { echo "Directory: \e[1m$(basename "$realpath")\e[0m" && eza -1aT --level=3 --group-directories-first --color=always --ignore-glob ".DS_Store|.localized|.idea|.vscode" $realpath } || bat --color=always $realpath'
zstyle ':fzf-tab:*' fzf-preview '~/.config/bin/fzf/fzf-tab-preview "$realpath"'
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'                             # case insensitive
autoload -U compinit && compinit -d "$XDG_CACHE_HOME"/zsh/zcompdump-"$ZSH_VERSION" # lazy load compeletion
eval "$(starship init zsh)"                                                        # starship
source <(fzf --zsh)                                                                # fzf
source $(brew --prefix)/opt/antidote/share/antidote/antidote.zsh                   # antidote
antidote load                                                                      # zsh plugins load
#------------------------------------------------------------------
#-- Function
#------------------------------------------------------------------
mkd() { mkdir -p "$1" && cd "$1"; } # make dir and enter it
# cd into where Finder is
cdf() {
    local target_dir=$(osascript -e 'tell application "Finder" to return POSIX path of (target of window 1 as alias)' 2>/dev/null)
    if [[ -n "$target_dir" ]]; then
        cd "$target_dir"
    else
        echo "No open Finder window found"
    fi
}
# smtart touch
touch() {
    for arg in "$@"; do
        if [[ ! "$arg" == -* ]]; then
            mkdir -p "$(dirname "$arg")" && command touch "$arg"
        fi
    done
}
# copy current line to clipboard
copy-command() {
    echo -n "$BUFFER" | pbcopy
}
zle -N copy-command # register copy funtion to widget
#-----------------------------------------------------------keybind
bindkey -e
bindkey "^Xc" copy-command
bindkey "^p" history-search-backward
bindkey "^n" history-search-forward
#-------------------------------------------------------------alias
alias "q"="exit"
alias "cd"="z"
alias ".."="cd ../"
alias "..."="cd ../../"
alias "...."="cd ../../../"
# eza/ls
alias "eza"="eza -I='.DS_Store|.localized|.CFUserTextEncoding' --group-directories-last"
alias "ls"="eza"
alias "la"="eza -lah"
alias "tr"="eza -T --level=4"
alias "tg"="eza -1a --git-ignore"
# packages
alias "vim"="nvim"
alias "server"="bunx serve"
alias "rime-install"="~/plum/rime-install"
alias "tailscale"="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
# xdg alias
alias "adb"="HOME=$XDG_DATA_HOME/android adb"
alias "wget"="wget --hsts-file=$XDG_DATA_HOME/wget-hsts"
alias "mitmproxy"="mitmproxy --set confdir=$XDG_CONFIG_HOME/mitmproxy"
alias "mitmweb"="mitmweb --set confdir=$XDG_CONFIG_HOME/mitmproxy"
