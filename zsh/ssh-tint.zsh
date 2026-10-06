#-----------------------------------------------------------ssh_tint
# Stable per-host tint for interactive SSH sessions.
# Visual context only; OpenSSH still verifies host identity.

typeset -ga _SSH_TINT_DARK_PALETTE=(
    '#241b20' '#261d1a' '#262219' '#20251b'
    '#19261f' '#192527' '#19222a' '#1b202b'
    '#201d2b' '#241c2a' '#281b27' '#291b22'
    '#2a1c1d' '#282019' '#242319' '#1d261d'
)

typeset -ga _SSH_TINT_LIGHT_PALETTE=(
    '#f8e8ed' '#f8ebe4' '#f5eedf' '#eaf1e2'
    '#e1f2e8' '#e1f1f2' '#e3ecf5' '#e7e8f6'
    '#ece5f5' '#f2e4f1' '#f6e3ec' '#f8e4e8'
    '#f8e6e4' '#f6eae1' '#f2eee0' '#e8f1e5'
)

_ssh_tint_supported() {
    emulate -L zsh

    [[ $TERM_PROGRAM == ghostty ]] || return 1

    local version=${TERM_PROGRAM_VERSION%%-*}
    [[ -n $version ]] || return 1

    autoload -Uz is-at-least
    is-at-least 1.3.2 "$version"
}

_ssh_tint_dark() {
    emulate -L zsh

    [[ $OSTYPE == darwin* ]] &&
        [[ $(command defaults read -g AppleInterfaceStyle 2>/dev/null) == Dark ]]
}

_ssh_tint_style() {
    emulate -L zsh

    local host
    local host_alias
    local port=22
    local target
    local key value file
    local first second third fourth rest
    local direct_seed
    local ca_seed
    local seed
    local sum
    local -i dark=0 index
    local -a known_hosts

    while read -r key value; do
        case $key in
        hostname)
            host=$value
            ;;
        port)
            port=$value
            ;;
        hostkeyalias)
            host_alias=$value
            ;;
        userknownhostsfile | globalknownhostsfile)
            known_hosts+=(${(z)value})
            ;;
        esac
    done < <(command ssh -G "$@" 2>/dev/null)

    [[ -n $host ]] || return 1

    if [[ -n $host_alias && $host_alias != none ]]; then
        target=$host_alias
    elif [[ $port == 22 ]]; then
        target=$host
    else
        target="[$host]:$port"
    fi

    for file in "${known_hosts[@]}"; do
        [[ $file != none ]] || continue

        case $file in
        '~')
            file=$HOME
            ;;
        '~/'*)
            file=$HOME/${file#\~/}
            ;;
        esac

        [[ -r $file ]] || continue

        while read -r first second third fourth rest; do
            [[ -n $first && $first != \#* ]] || continue

            case $first in
            '@revoked')
                continue
                ;;

            '@cert-authority')
                if [[ -z $ca_seed && -n $third && -n $fourth ]]; then
                    ca_seed="$third $fourth"
                fi
                continue
                ;;

            '@'*)
                continue
                ;;
            esac

            [[ -n $second && -n $third ]] || continue

            [[ -n $direct_seed ]] ||
                direct_seed="$second $third"

            if [[ $second == *ed25519* ]]; then
                direct_seed="$second $third"
                break 2
            fi
        done < <(command ssh-keygen -F "$target" -f "$file" 2>/dev/null)
    done

    if [[ -n $direct_seed ]]; then
        seed=$direct_seed
    elif [[ -n $ca_seed ]]; then
        seed="$target $ca_seed"
    fi

    _ssh_tint_dark && dark=1

    # Unknown hosts get amber rather than a seemingly authoritative color.
    if [[ -z $seed ]]; then
        if ((dark)); then
            print -r -- '#f2f4f8 #332a1c'
        else
            print -r -- '#525252 #fff0db'
        fi
        return
    fi

    sum=$(print -rn -- "$seed" | command cksum) || return 1
    sum=${sum%% *}
    index=$((sum % 16 + 1))

    if ((dark)); then
        print -r -- "#f2f4f8 ${_SSH_TINT_DARK_PALETTE[$index]}"
    else
        print -r -- "#525252 ${_SSH_TINT_LIGHT_PALETTE[$index]}"
    fi
}

_ssh_tint() {
    local style foreground background
    local -i rc

    if [[ -t 0 && -t 1 ]] && _ssh_tint_supported; then
        style=$(_ssh_tint_style "$@")

        if [[ -n $style ]]; then
            foreground=${style%% *}
            background=${style#* }

            printf '\e]10;%s\e\\\e]11;%s\e\\' \
                "$foreground" "$background" \
                2>/dev/null >/dev/tty
        fi
    fi

    _ssh_tint_exec "$@"
    rc=$?

    if [[ -n $style ]]; then
        printf '\e]110\e\\\e]111\e\\' \
            2>/dev/null >/dev/tty
    fi

    return $rc
}

if [[ -z ${_SSH_TINT_INSTALLED:-} ]]; then
    # Preserve Ghostty's ssh-env / ssh-terminfo integration.
    if (($+functions[ssh])); then
        functions -c ssh _ssh_tint_exec
    else
        _ssh_tint_exec() {
            command ssh "$@"
        }
    fi

    ssh() {
        _ssh_tint "$@"
    }

    typeset -g _SSH_TINT_INSTALLED=1
fi
