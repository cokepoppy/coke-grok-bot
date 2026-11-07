#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
resolution="${COKE_DESKTOP_RESOLUTION:-1440x900}"
screen_slots="${COKE_DESKTOP_SCREEN_SLOTS:-8}"
start_url="${COKE_DESKTOP_START_URL:-https://example.com}"
chrome_bin="${COKE_DESKTOP_CHROME_BIN:-/usr/bin/chromium}"
profile_dir="$HOME/.config/chromium"
[[ "$resolution" =~ ^([0-9]{3,4})x([0-9]{3,4})$ ]] || { echo "COKE_DESKTOP_RESOLUTION must be WxH" >&2; exit 1; }
screen_width="${BASH_REMATCH[1]}"; screen_height="${BASH_REMATCH[2]}"
[[ "$screen_width" -ge 640 && "$screen_width" -le 3840 && "$screen_height" -ge 480 && "$screen_height" -le 2160 ]] || { echo "COKE_DESKTOP_RESOLUTION is outside the supported range" >&2; exit 1; }
[[ "$screen_slots" =~ ^([1-9]|1[0-6])$ ]] || { echo "COKE_DESKTOP_SCREEN_SLOTS must be between 1 and 16" >&2; exit 1; }
screen_stride=$((screen_width + 32))
virtual_width=$((screen_stride * screen_slots))
[[ "$virtual_width" -le 32767 ]] || { echo "Bot screen layout exceeds the X11 display limit" >&2; exit 1; }
mkdir -p "$HOME" "$profile_dir" "$HOME/.vnc" /workspace/.coke-desktop /tmp/.X11-unix
chmod 0700 "$HOME"
chmod 1777 /tmp/.X11-unix
clear-stale-grok-x11

# A recreated Pod mounts the prior Pod's persistent Chromium profile. Chrome's
# singleton links include the old Pod name and can block CDP startup forever;
# this entrypoint runs before any Chromium process exists in the new container.
# Drop only process ownership links, keeping cookies, files, and preferences.
rm -f "$profile_dir/SingletonLock" "$profile_dir/SingletonCookie" "$profile_dir/SingletonSocket"

Xvfb "$DISPLAY" -screen 0 "${virtual_width}x${screen_height}x24" -ac +extension GLX +render -noreset >/tmp/dots-xvfb.log 2>&1 &
xvfb_pid=$!
xfce_pid=""; vnc_pid=""; websockify_pid=""; chrome_pid=""; worker_pid=""
cleanup() {
  trap - EXIT INT TERM
  kill "$xvfb_pid" "$xfce_pid" "$vnc_pid" "$websockify_pid" "$worker_pid" 2>/dev/null || true
  if [[ -n "$chrome_pid" ]]; then kill -TERM -- "-$chrome_pid" 2>/dev/null || true; fi
  rm -f /tmp/dots-chrome.pid
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 50); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.2
done
xdpyinfo -display "$DISPLAY" >/dev/null 2>&1

dbus-launch --exit-with-session startxfce4 >/tmp/dots-xfce.log 2>&1 &
xfce_pid=$!
vnc_password="${VNC_PASSWORD:-}"
if [[ "${COKE_DESKTOP_VNC_AUTH_MODE:-gateway}" == "password" ]]; then
  [[ -n "$vnc_password" ]] || { echo "VNC_PASSWORD is required in password mode" >&2; exit 1; }
  x11vnc -storepasswd "$vnc_password" "$HOME/.vnc-passwd" >/dev/null
  x11vnc -display "$DISPLAY" -rfbauth "$HOME/.vnc-passwd" -rfbport 5900 -forever -shared -noxdamage >/tmp/dots-vnc.log 2>&1 &
else
  # The authenticated Dots API proxies the noVNC stream. The Service never
  # exposes the raw VNC listener directly.
  x11vnc -display "$DISPLAY" -nopw -localhost -rfbport 5900 -forever -shared -noxdamage >/tmp/dots-vnc.log 2>&1 &
fi
vnc_pid=$!
websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/tmp/dots-websockify.log 2>&1 &
websockify_pid=$!

chrome_flags=(
  --disable-dev-shm-usage --disable-gpu --disable-session-crashed-bubble --no-first-run --no-default-browser-check
  --password-store=basic --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
  --disable-extensions-except=/opt/coke-grok/active-tab-extension --load-extension=/opt/coke-grok/active-tab-extension
  --user-data-dir="$HOME/.config/chromium" --window-position=0,0 --window-size="${screen_width},${screen_height}"
)
if [[ -n "${COKE_DESKTOP_PROXY_SERVER:-}" ]]; then
  [[ "$COKE_DESKTOP_PROXY_SERVER" == "http://host.docker.internal:17891" ]] || { echo "Unsupported cloud-computer proxy endpoint" >&2; exit 1; }
  chrome_flags+=("--proxy-server=$COKE_DESKTOP_PROXY_SERVER")
  chrome_flags+=("--proxy-bypass-list=localhost;127.0.0.1;[::1];*.svc;*.cluster.local")
fi
if [[ "${COKE_DESKTOP_CHROME_NO_SANDBOX:-0}" == "1" ]]; then chrome_flags+=(--no-sandbox); fi
start_chromium() {
  setsid "$chrome_bin" "${chrome_flags[@]}" "$start_url" >>/tmp/dots-chrome.log 2>&1 &
  chrome_pid=$!
  printf '%s\n' "$chrome_pid" >/tmp/dots-chrome.pid
}
stop_chromium() {
  local pid="$1"
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 -- "-$pid" 2>/dev/null || break
    sleep 0.1
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
restart_chromium() {
  stop_chromium "$chrome_pid"
  start_chromium
  echo "Chromium restarted after renderer health failure (pid $chrome_pid)"
}
trap restart_chromium USR1
start_chromium
node /opt/coke-dots/grok-computer-worker.mjs >/tmp/dots-worker.log 2>&1 &
worker_pid=$!

while true; do
  for pid in "$xfce_pid" "$vnc_pid" "$websockify_pid" "$worker_pid"; do
    kill -0 "$pid" 2>/dev/null || { echo "desktop component exited" >&2; exit 1; }
  done
  if ! kill -0 "$chrome_pid" 2>/dev/null; then
    stop_chromium "$chrome_pid"
    start_chromium
  fi
  sleep 5
done
