#------------------------------------------------------------------
#     █████████  █████               ████   █████
#    ███░░░░░███░░███               ░░███  ░░███
#   ███     ░░░  ░███████    ██████  ░███  ███████    █████
#  ░███          ░███░░███  ███░░███ ░███ ░░░███░    ███░░
#  ░███    █████ ░███ ░███ ░███ ░███ ░███   ░███    ░░█████
#  ░░███  ░░███  ░███ ░███ ░███ ░███ ░███   ░███ ███ ░░░░███
#   ░░█████████  ████ █████░░██████  █████  ░░█████  ██████
#    ░░░░░░░░░  ░░░░ ░░░░░  ░░░░░░  ░░░░░    ░░░░░  ░░░░░░
#----------------------------------------------------------homebrew
eval "$(/opt/homebrew/bin/brew shellenv)"
#-----------------------------------------------------------xdg-dir
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_RUNTIME_DIR="$HOME/.cache"
#---------------------------------------------------------xdg-ninja
export LESSHISTFILE="$XDG_STATE_HOME"/lesshst
export TERMINFO="$XDG_DATA_HOME"/terminfo
export TERMINFO_DIRS="$XDG_DATA_HOME"/terminfo:/usr/share/terminfo
export ANDROID_USER_HOME="$XDG_DATA_HOME"/android
export CARGO_HOME="$XDG_DATA_HOME"/cargo
export PYTHON_HISTORY="$XDG_STATE_HOME"/python/python_history
export CP_HOME_DIR="$XDG_DATA_HOME"/cocoapods
export RUSTUP_HOME="$XDG_DATA_HOME"/rustup

# ruby
export BUNDLE_USER_CONFIG="$XDG_CONFIG_HOME"/bundle
export BUNDLE_USER_CACHE="$XDG_CACHE_HOME"/bundle
export BUNDLE_USER_PLUGIN="$XDG_DATA_HOME"/bundle
export RBENV_ROOT="$XDG_DATA_HOME"/rbenv

# npm
export NPM_CONFIG_INIT_MODULE="$XDG_CONFIG_HOME"/npm/config/npm-init.js
export NPM_CONFIG_CACHE="$XDG_CACHE_HOME"/npm
export NPM_CONFIG_TMP="$XDG_RUNTIME_DIR"/npm
#----------------------------------------------------------packages
export PATH="/Users/gholts/.cache/.bun/bin:$PATH"    # bun
export PATH="$(brew --prefix)/opt/node@24/bin:$PATH" # node
#------------------------------------------------------------------
export SHELL_SESSIONS_DISABLE=1  # remove zsh_sessions file
export HOMEBREW_NO_AUTO_UPDATE=1 # disable homebrew auto update
export EDITOR="nvim"
export VISUAL=$EDITOR

# fzf
export FZF_DEFAULT_OPTS_FILE="$XDG_CONFIG_HOME/fzf/config.fzfrc"
export FZF_DEFAULT_COMMAND="fd -iIH"
export FZF_CTRL_T_COMMAND="fd"
export FZF_CTRL_R_OPTS="--no-preview --layout=reverse"
