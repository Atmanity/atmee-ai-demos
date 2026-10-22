#!/usr/bin/env bash
# Make a test utterance for the live harness: tools/live-test/audio/<name>.wav
#   tools/live-test/say.sh clue "Can I have a clue, please?"
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)/audio"
mkdir -p "$dir"
say -v "${VOICE:-Samantha}" -o "$dir/$1.aiff" "$2"
afconvert -f WAVE -d LEI16@24000 "$dir/$1.aiff" "$dir/$1.wav"
rm "$dir/$1.aiff"
echo "$dir/$1.wav"
