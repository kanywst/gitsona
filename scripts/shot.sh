#!/usr/bin/env bash
# Screenshot SVGs with headless Chromium: scripts/shot.sh file.svg [...]
# Output: file.png next to each input, rendered at 2x after animations finish.
set -euo pipefail
CH="${CHROME:-$(find "$HOME/Library/Caches/ms-playwright" -name chrome-headless-shell -type f 2>/dev/null | sort | tail -1)}"
for f in "$@"; do
  abs="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
  read -r w h < <(grep -o 'width="[0-9]*" height="[0-9]*"' "$abs" | head -1 | tr -dc '0-9 \n' | awk '{print $1, $2}')
  "$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=00000000 --window-size="$w,$h" --virtual-time-budget=8000 \
    --screenshot="${abs%.svg}.png" "file://$abs" >/dev/null 2>&1
done
