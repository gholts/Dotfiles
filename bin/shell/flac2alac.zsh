#!/bin/zsh

# Converts all FLAC files in the current folder to Apple-compatible
# lossless ALAC (.m4a), preserving metadata and cover art.
#
# Multi-disc handling:
#   - Keeps Album / Album Artist / Year consistent across every file.
#   - Reads DISCNUMBER / DISCTOTAL and TRACKNUMBER / TRACKTOTAL from FLAC tags.
#   - Understands disc/track values already stored as current/total (e.g. 1/2).
#   - Infers disc/track numbers from filenames such as "1-01 Song.flac".
#   - Filename disc/track numbers take priority over existing current numbers.
#   - Writes Apple/iTunes-compatible disc and track atoms as current/total,
#     e.g. disc=1/2 and track=5/12.
#
# For inferred totals to be accurate, run this with the complete album's FLAC
# files together in the same directory.
#
# Usage:
#   ./flac2alac_preserve_discs.zsh "Album Name" YEAR
#   ./flac2alac_preserve_discs.zsh "Album Name" YEAR "Album Artist"
#
# Examples:
#   ./flac2alac_preserve_discs.zsh "EZ2AC SPECIAL SOUND TRACK" 2015
#   ./flac2alac_preserve_discs.zsh \
#       "EZ2AC NIGHT TRAVELER ORIGINAL SOUNDTRACK" 2017 "EZ2AC"

if (($# < 2)); then
    echo 'Usage:'
    echo '  ./flac2alac_preserve_discs.zsh "Album Name" YEAR ["Album Artist"]'
    exit 1
fi

ALBUM="$1"
YEAR="$2"
ALBUM_ARTIST="${3:-EZ2AC}"
OUTPUT_DIR="ALAC"

# ----------------------------------------------------- Requirements

for cmd in beet metaflac; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: $cmd is required but was not found in PATH."
        exit 1
    fi
done

setopt NULL_GLOB
files=(./*.flac)

if ((${#files[@]} == 0)); then
    echo "No FLAC files found in this directory."
    exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/flac2alac.XXXXXX")" || exit 1
trap 'rm -rf -- "$work_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
export BEETSDIR="$work_dir"

beet_config="$work_dir/config.yaml"
beet_library="$work_dir/library.db"
beet_stage="$work_dir/converted"

cat >"$beet_config" <<'EOF'
directory: /tmp
plugins: convert
import:
  copy: no
  move: no
  write: no
  autotag: no
  resume: no
  duplicate_action: keep
convert:
  format: alac
  threads: 1
  paths:
    default: $id
  formats:
    alac:
      command: ffmpeg -hide_banner -loglevel error -i $source -y -map 0:a:0 -map 0:v:0? -c:a alac -c:v copy $dest
      extension: m4a
EOF

beet_cmd=(beet -c "$beet_config" -l "$beet_library")

# ---------------------------------------------------------- Helpers

# normalize_uint VALUE
#
# Validates a non-negative decimal integer and removes leading zeroes.
# The normalized result is returned in $NORMALIZED.
normalize_uint() {
    local value="$1"
    NORMALIZED=""

    if [[ -z "$value" || "$value" == *[!0-9]* ]]; then
        return 1
    fi

    # Strip leading zeroes without letting tag text become an arithmetic
    # expression. This keeps values such as 01 and 08 safely decimal.
    while [[ "$value" == 0* && "$value" != "0" ]]; do
        value="${value#0}"
    done

    NORMALIZED="$value"
    return 0
}

# parse_number_pair VALUE
#
# Accepts either:
#   3
#   3/12
#
# Results:
#   $PAIR_CURRENT
#   $PAIR_TOTAL
parse_number_pair() {
    local value="$1"
    local current=""
    local total=""

    PAIR_CURRENT=""
    PAIR_TOTAL=""

    if [[ "$value" == */* ]]; then
        current="${value%%/*}"
        total="${value#*/}"
    else
        current="$value"
    fi

    if normalize_uint "$current"; then
        PAIR_CURRENT="$NORMALIZED"
    fi

    if [[ -n "$total" ]] && normalize_uint "$total"; then
        if ((NORMALIZED > 0)); then
            PAIR_TOTAL="$NORMALIZED"
        fi
    fi
}

# parse_filename_numbers FILE
#
# Recognizes filenames such as:
#   1-01 Song.flac
#   2-05 Another Song.flac
#
# Results:
#   $FILENAME_DISC
#   $FILENAME_TRACK
parse_filename_numbers() {
    local file="$1"
    local base="${file##*/}"
    local stem="${base%.flac}"
    local filename_re='^([0-9]+)-([0-9]+)([.]?([[:space:]]|$))'

    FILENAME_DISC=""
    FILENAME_TRACK=""

    if [[ "$stem" =~ $filename_re ]]; then
        if normalize_uint "${match[1]}"; then
            FILENAME_DISC="$NORMALIZED"
        fi

        if normalize_uint "${match[2]}"; then
            FILENAME_TRACK="$NORMALIZED"
        fi
    fi
}

# probe_number_metadata FILE
#
# Reads common FLAC/Vorbis number tags without changing the source file.
#
# Results:
#   $PROBE_DISC
#   $PROBE_DISC_TOTAL
#   $PROBE_TRACK
#   $PROBE_TRACK_TOTAL
probe_number_metadata() {
    local file="$1"
    local probe_output=""
    local key=""
    local value=""
    local key_lower=""
    local disc_raw=""
    local track_raw=""
    local candidate=""

    PROBE_DISC=""
    PROBE_DISC_TOTAL=""
    PROBE_TRACK=""
    PROBE_TRACK_TOTAL=""

    if ! probe_output="$(
        metaflac \
            --show-tag=DISCNUMBER \
            --show-tag=DISC \
            --show-tag=DISCTOTAL \
            --show-tag=TOTALDISCS \
            --show-tag=TRACKNUMBER \
            --show-tag=TRACK \
            --show-tag=TRACKTOTAL \
            --show-tag=TOTALTRACKS \
            -- "$file"
    )"; then
        echo "ERROR reading metadata: $file" >&2
        return 1
    fi

    while IFS='=' read -r key value; do
        [[ -z "$key" ]] && continue
        key_lower="${(L)key}"

        case "$key_lower" in
        discnumber | disc)
            disc_raw="$value"
            ;;

        disctotal | totaldiscs)
            if normalize_uint "$value"; then
                candidate="$NORMALIZED"
                if ((candidate > ${PROBE_DISC_TOTAL:-0})); then
                    PROBE_DISC_TOTAL="$candidate"
                fi
            fi
            ;;

        tracknumber | track)
            track_raw="$value"
            ;;

        tracktotal | totaltracks)
            if normalize_uint "$value"; then
                candidate="$NORMALIZED"
                if ((candidate > ${PROBE_TRACK_TOTAL:-0})); then
                    PROBE_TRACK_TOTAL="$candidate"
                fi
            fi
            ;;
        esac
    done <<<"$probe_output"

    # DISCNUMBER/TRACKNUMBER may already contain current/total.
    parse_number_pair "$disc_raw"
    PROBE_DISC="$PAIR_CURRENT"

    if [[ -n "$PAIR_TOTAL" ]] && ((PAIR_TOTAL > ${PROBE_DISC_TOTAL:-0})); then
        PROBE_DISC_TOTAL="$PAIR_TOTAL"
    fi

    parse_number_pair "$track_raw"
    PROBE_TRACK="$PAIR_CURRENT"

    if [[ -n "$PAIR_TOTAL" ]] && ((PAIR_TOTAL > ${PROBE_TRACK_TOTAL:-0})); then
        PROBE_TRACK_TOTAL="$PAIR_TOTAL"
    fi

    return 0
}

# ------------------------------------------------------------ First

typeset -A TRACK_TOTAL_BY_DISC
typeset -A BEET_ID_BY_PATH
typeset -A BIT_DEPTH_BY_PATH
typeset -A DISC_BY_PATH
typeset -A TRACK_BY_PATH
typeset -A TRACK_TOTAL_BY_PATH
album_total_discs=0

absolute_files=()
for f in "${files[@]}"; do
    absolute_files+=("${f:A}")
done

# Build a private, throwaway beets library. No files are copied, moved,
# retagged, or submitted for autotagging.
if ! "${beet_cmd[@]}" import -A -C -W -P -q -s "${absolute_files[@]}" >/dev/null; then
    echo "ERROR: beets could not read the input files." >&2
    exit 1
fi

while IFS=$'\x1f' read -r beet_id beet_path bit_depth; do
    [[ -z "$beet_id" || -z "$beet_path" ]] && continue
    BEET_ID_BY_PATH[$beet_path]="$beet_id"
    BIT_DEPTH_BY_PATH[$beet_path]="$bit_depth"
done < <("${beet_cmd[@]}" list -f $'$id\x1f$path\x1f$bitdepth')

for f in "${files[@]}"; do
    absolute_file="${f:A}"
    beet_id="${BEET_ID_BY_PATH[$absolute_file]}"
    bit_depth="${BIT_DEPTH_BY_PATH[$absolute_file]}"

    if [[ -z "$beet_id" ]] || ! normalize_uint "$bit_depth"; then
        echo "ERROR: beets could not inspect: $f" >&2
        exit 1
    fi

    if ((NORMALIZED == 0 || NORMALIZED > 24)); then
        echo "ERROR: $f is ${NORMALIZED}-bit; ALAC conversion would not preserve its precision." >&2
        exit 1
    fi

    parse_filename_numbers "$f"
    probe_number_metadata "$f" || exit 1

    # Filename numbers take priority for the current disc/track.
    resolved_disc="${FILENAME_DISC:-$PROBE_DISC}"
    resolved_track="${FILENAME_TRACK:-$PROBE_TRACK}"
    DISC_BY_PATH[$absolute_file]="$resolved_disc"
    TRACK_BY_PATH[$absolute_file]="$resolved_track"
    TRACK_TOTAL_BY_PATH[$absolute_file]="$PROBE_TRACK_TOTAL"

    # Infer from the resolved current disc, so an overridden stale tag cannot
    # inflate the total. Explicit total tags remain authoritative candidates.
    if [[ -n "$resolved_disc" ]] && ((resolved_disc > album_total_discs)); then
        album_total_discs="$resolved_disc"
    fi

    if [[ -n "$PROBE_DISC_TOTAL" ]] && ((PROBE_DISC_TOTAL > album_total_discs)); then
        album_total_discs="$PROBE_DISC_TOTAL"
    fi

    # Determine total tracks for each disc. An explicit source total is kept,
    # and the highest track number present acts as a fallback/inferred total.
    if [[ -n "$resolved_disc" ]]; then
        current_total="${TRACK_TOTAL_BY_DISC[$resolved_disc]:-0}"

        if [[ -n "$PROBE_TRACK_TOTAL" ]] && ((PROBE_TRACK_TOTAL > current_total)); then
            current_total="$PROBE_TRACK_TOTAL"
        fi

        if [[ -n "$resolved_track" ]] && ((resolved_track > current_total)); then
            current_total="$resolved_track"
        fi

        if ((current_total > 0)); then
            TRACK_TOTAL_BY_DISC[$resolved_disc]="$current_total"
        fi
    fi
done

# ----------------------------------------------------------- Second

for f in "${files[@]}"; do
    absolute_file="${f:A}"
    beet_id="${BEET_ID_BY_PATH[$absolute_file]}"
    echo
    echo "Converting: $f"

    disc="${DISC_BY_PATH[$absolute_file]}"
    track="${TRACK_BY_PATH[$absolute_file]}"
    modifications=(
        "album=$ALBUM"
        "albumartist=$ALBUM_ARTIST"
        "year=$YEAR"
        "month=0"
        "day=0"
        "comp=0"
    )

    # Write disc as current/total whenever a current disc number is known.
    # This is what FFmpeg's MP4/M4A muxer uses for the iTunes 'disk' atom.
    if [[ -n "$disc" ]]; then
        if ((album_total_discs > 0)); then
            disc_tag="$disc/$album_total_discs"
        else
            disc_tag="$disc"
        fi

        modifications+=("disc=$disc" "disctotal=$album_total_discs")
        echo "  Disc:  $disc_tag"
    fi

    # Preserve or infer the per-disc track total.
    if [[ -n "$track" ]]; then
        track_total="${TRACK_TOTAL_BY_PATH[$absolute_file]:-0}"

        if [[ -n "$disc" ]]; then
            inferred_total="${TRACK_TOTAL_BY_DISC[$disc]:-0}"
            if ((inferred_total > track_total)); then
                track_total="$inferred_total"
            fi
        fi

        if ((track_total > 0)); then
            track_tag="$track/$track_total"
        else
            track_tag="$track"
        fi

        modifications+=("track=$track" "tracktotal=$track_total")
        echo "  Track: $track_tag"
    fi

    if ! "${beet_cmd[@]}" modify -W -y "${modifications[@]}" "id:$beet_id" >/dev/null; then
        echo "ERROR preparing metadata: $f" >&2
        exit 1
    fi
done

if ! "${beet_cmd[@]}" convert -y -F -d "$beet_stage"; then
    echo "ERROR: beets conversion failed." >&2
    exit 1
fi

# The convert plugin can report success after an individual encoder failure,
# so verify every staged result before touching the output directory.
for f in "${files[@]}"; do
    absolute_file="${f:A}"
    beet_id="${BEET_ID_BY_PATH[$absolute_file]}"
    if [[ ! -s "$beet_stage/$beet_id.m4a" ]]; then
        echo "ERROR converting: $f" >&2
        exit 1
    fi
done

mkdir -p "$OUTPUT_DIR" || exit 1
for f in "${files[@]}"; do
    absolute_file="${f:A}"
    beet_id="${BEET_ID_BY_PATH[$absolute_file]}"
    base="${f##*/}"
    name="${base%.flac}"
    mv -f -- "$beet_stage/$beet_id.m4a" "$OUTPUT_DIR/$name.m4a" || exit 1
done

echo
echo "Finished."
echo "Album:        $ALBUM"
echo "Album Artist: $ALBUM_ARTIST"
echo "Year:         $YEAR"
if ((album_total_discs > 0)); then
    echo "Discs:        $album_total_discs"
fi
echo "Output:       $OUTPUT_DIR/"
