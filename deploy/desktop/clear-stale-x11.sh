#!/usr/bin/env bash
set -euo pipefail

display="${DISPLAY:-:1}"
if [[ ! "$display" =~ ^:([0-9]+)(\.[0-9]+)?$ ]]; then
  echo "Unsupported X11 display" >&2
  exit 1
fi
display_number="${BASH_REMATCH[1]}"
runtime_dir="${COKE_DESKTOP_X11_RUNTIME_DIR:-/tmp}"
if [[ ! -d "$runtime_dir" ]]; then
  echo "X11 runtime directory is unavailable" >&2
  exit 1
fi
runtime_dir="$(cd "$runtime_dir" && pwd -P)"
if [[ "$runtime_dir" == "/" ]]; then
  echo "Unsafe X11 runtime directory" >&2
  exit 1
fi
socket_dir="$runtime_dir/.X11-unix"
if [[ ! -d "$socket_dir" || -L "$socket_dir" ]]; then
  echo "X11 socket directory is unavailable" >&2
  exit 1
fi
lock="$runtime_dir/.X${display_number}-lock"
socket="$socket_dir/X${display_number}"

# Keep all runtime artifacts if the server responds or a server process is
# still alive. A restarted Pod can preserve /tmp across container restarts.
if xdpyinfo -display "$display" >/dev/null 2>&1; then exit 0; fi
if ps -A -o comm= | grep -qx 'Xvfb'; then
  echo "Xvfb is still running; refusing to remove its runtime files" >&2
  exit 1
fi
for path in "$lock" "$socket"; do
  if [[ -L "$path" || (-e "$path" && ! -f "$path" && ! -S "$path") ]]; then
    echo "Unexpected X11 runtime file type" >&2
    exit 1
  fi
done
rm -f -- "$lock" "$socket"
