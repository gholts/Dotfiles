#------------------------------------------------------------------
#     █████████  █████               ████   █████
#    ███░░░░░███░░███               ░░███  ░░███
#   ███     ░░░  ░███████    ██████  ░███  ███████    █████
#  ░███          ░███░░███  ███░░███ ░███ ░░░███░    ███░░
#  ░███    █████ ░███ ░███ ░███ ░███ ░███   ░███    ░░█████
#  ░░███  ░░███  ░███ ░███ ░███ ░███ ░███   ░███ ███ ░░░░███
#   ░░█████████  ████ █████░░██████  █████  ░░█████  ██████
#    ░░░░░░░░░  ░░░░ ░░░░░  ░░░░░░  ░░░░░    ░░░░░  ░░░░░░
#-----------------------------------------------p10k_instant_prompt
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
    source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi
#------------------------------------------------------zsh_settings
HISTSIZE=5000                          # Number of history entries kept in memory
SAVEHIST=$HISTSIZE                     # Number of history entries saved to disk
HISTFILE="$XDG_STATE_HOME/zsh/history" # History file path
setopt hist_ignore_space               # Do not save commands starting with a space
setopt appendhistory                   # Append history to the file when the shell exits
setopt sharehistory                    # Share history across all active zsh sessions
setopt correct                         # Enable command spelling correction
setopt hist_ignore_all_dups            # Remove older duplicate commands from history
setopt hist_ignore_dups                # Do not save a command if it matches the previous one
setopt hist_save_no_dups               # Do not write duplicate commands to the history file
setopt hist_find_no_dups               # Do not show duplicates when searching history
setopt GLOB_DOTS                       # Include dotfiles in glob matches
unsetopt CASE_GLOB                     # Make glob matching case-insensitive
#-------------------------------------------------completion_styles
zstyle ':completion:*:descriptions' format '[%d]'         # Format completion group titles
zstyle ':completion:*' menu no                            # Disable native zsh menu UI for fzf-tab
zstyle ':completion:*' group-name ''                      # Group completion results by tag
zstyle ':completion:*' verbose yes                        # Show detailed completion descriptions
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' # Enable case-insensitive completion
zstyle ':completion:*' squeeze-slashes true               # Collapse duplicate slashes in paths
zstyle ':completion:*' list-separator ''                  # Hide separator between item and description
zstyle ':completion:*' ignored-patterns \
    '.DS_Store' '*/.DS_Store' \
    '.localized' '*/.localized' \
    '.CFUserTextEncoding' '*/.CFUserTextEncoding' \
    '._*' '*/._*' \
    '.AppleDouble' '*/.AppleDouble' \
    '.idea' '*/.idea' \
    '.vscode' '*/.vscode'                                                   # Hide noisy dotfiles from completion
zstyle ':completion:*:options' list-colors '=(#b)(-[^ -]#)#( [^-]*)=0=0=33' # Highlight command options in completion lists
#----------------------------------------------------------compinit
autoload -Uz compinit                                  # Lazy-load the zsh completion initializer
zcompdump="$XDG_CACHE_HOME/zsh/zcompdump-$ZSH_VERSION" # Store compinit cache under XDG cache
mkdir -p "${zcompdump:h}"                              # Ensure the cache directory exists
if [[ "$zcompdump" -nt "$ZDOTDIR/.zsh_plugins.txt" ]]; then
    compinit -C -d "$zcompdump" # Fast init when the completion dump is fresh
else
    compinit -d "$zcompdump" # Full init and rebuild cache when plugins changed
fi

((${+_comp_options})) && _comp_options+=(globdots) # Include dotfiles in completion results
#---------------------------------------------fzf_shell_integration
(($+commands[fzf])) && source <(fzf --zsh) # Load fzf keybindings and shell integration
#----------------------------------------------------fzf-tab_styles
zstyle ':fzf-tab:*' use-fzf-default-opts no                                 # Do not inherit global FZF_DEFAULT_OPTS
zstyle ':fzf-tab:*' fzf-flags --height=60% --min-height=15 --layout=reverse # fzf-tab window layout and size
zstyle ':fzf-tab:*' show-group full                                         # Show full completion group names
zstyle ':fzf-tab:*' prefix ''                                               # Remove fzf-tab leading dot marker
zstyle ':fzf-tab:*' switch-group ',' '.'                                    # Use comma/dot to switch between groups
zstyle ':fzf-tab:complete:*:*' fzf-preview \
    '$XDG_CONFIG_HOME/bin/fzf/fzf-tab-preview "$realpath" "$word" "$group" "$desc"' # Universal preview script
#------------------------------------------macos_process_completion
zstyle ':completion:*:*:*:*:processes' command 'ps -u "$USER" -o pid,user,command -w' # Use macOS-compatible process listing
zstyle ':fzf-tab:complete:(kill|ps):argument-rest' fzf-preview \
    'ps -p "$word" -o pid= -o ppid= -o user= -o %cpu= -o %mem= -o etime= -o stat= -o command= 2>/dev/null' # Preview selected process details
#---------------------------------------homebrew_completion_preview
zstyle ':fzf-tab:complete:brew-(install|uninstall|search|info):*-argument-rest' \
    fzf-preview 'HOMEBREW_COLOR=1 brew info "$word" 2>/dev/null' # Preview Homebrew formula/cask info
#----------------------------------------------------------antidote
source "$HOMEBREW_PREFIX/opt/antidote/share/antidote/antidote.zsh" # Load antidote plugin manager
antidote load                                                      # Load plugins from .zsh_plugins.txt
#------------------------------------------------------------source
# (($+commands[starship])) && eval "$(starship init zsh)" # Initialize Starship prompt
[[ ! -f ~/.config/zsh/.p10k.zsh ]] || source ~/.config/zsh/.p10k.zsh # Initialize p10k
source "$ZDOTDIR/function.zsh"                                       # Load custom shell functions
source "$ZDOTDIR/keymap.zsh"                                         # Load custom keybindings
