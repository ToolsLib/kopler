#!/bin/sh
set -eu
export DISPLAY=:99
smoke_dir=${KOPLER_SMOKE_DIR:-/work}
mkdir -p "$smoke_dir"
export KOPLER_DATA_DIR=${KOPLER_DATA_DIR:-$smoke_dir/smoke-data}
app_executable=${KOPLER_TEST_EXECUTABLE:-/work/src-tauri/target/debug/kopler}
# Isolated headless container only; do not set this in desktop distribution.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
Xvfb :99 -screen 0 1280x800x24 >"$smoke_dir/xvfb.log" 2>&1 &
display_pid=$!
trap 'kill "$display_pid" 2>/dev/null || true' EXIT
sleep 1
openbox >"$smoke_dir/openbox.log" 2>&1 &
"$app_executable" >"$smoke_dir/native.log" 2>&1 &
app_pid=$!
trap 'kill "$app_pid" "$display_pid" 2>/dev/null || true' EXIT
window_id=$(timeout 30 xdotool search --sync --onlyvisible --name '^Kopler$' | head -1)
test -n "$window_id"
xdotool windowactivate --sync "$window_id"
sleep 2
xdotool key --clearmodifiers ctrl+shift+space
sleep 1
if xdotool search --onlyvisible --name '^Kopler$' >/dev/null; then
    echo 'FAIL: X11 global shortcut did not hide the focused application'; exit 1
fi
"$app_executable" --show
sleep 1
xdotool search --onlyvisible --name '^Kopler$' >/dev/null
test "$(pgrep -x kopler | wc -l)" -eq 1
echo 'PASS: Linux X11 launch, global shortcut hide, second-launch reveal, and single instance'
