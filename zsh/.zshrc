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
HISTDUP=erase
setopt hist_ignore_all_dups
setopt hist_ignore_dups
setopt hist_save_no_dups
setopt hist_find_no_dups
#----------------------------------------------------zsh_completion
zstyle ':completion:*:descriptions' format "[%d]"
zstyle ':fzf-tab:*' fzf-flags --height=40% --min-height=15
zstyle ':fzf-tab:*' fzf-preview '~/.config/bin/fzf/fzf-tab-preview "$realpath"'
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'                             # case insensitive
autoload -U compinit && compinit -d "$XDG_CACHE_HOME"/zsh/zcompdump-"$ZSH_VERSION" # lazy load compeletion
#------------------------------------------------------------source
source <(fzf --zsh)                                                # fzf
eval "$(starship init zsh)"                                        # starship
source "$(brew --prefix)/opt/antidote/share/antidote/antidote.zsh" # antidote
source "$XDG_DATA_HOME/cargo/env"                                  # cargo
source "$ZDOTDIR/function.zsh"                                     # function
source "$ZDOTDIR/keymap.zsh"                                       # keymap
antidote load                                                      # load plugins
