#!/bin/sh
set -eu
export DISPLAY=:99
export GDK_BACKEND=x11
export XDG_SESSION_TYPE=x11
export XDG_CURRENT_DESKTOP=OPENBOX
unset WAYLAND_DISPLAY
smoke_dir=${KOPLER_SMOKE_DIR:-/work}
mkdir -p "$smoke_dir"
export KOPLER_DATA_DIR="${KOPLER_DATA_DIR:-$smoke_dir/smoke-data}"
app_executable=${KOPLER_TEST_EXECUTABLE:-/work/src-tauri/target/debug/kopler}
# Isolated headless tests only; do not set these in desktop distribution.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
app_pid=
wm_pid=
other_pid=
display_pid=
cleanup() {
    result=$?
    trap - EXIT
    if [ "$result" -ne 0 ]; then
        for log in native openbox xvfb; do
            if [ -f "$smoke_dir/$log.log" ]; then
                echo "--- $log diagnostics ---"
                tail -n 60 "$smoke_dir/$log.log"
            fi
        done
        xdotool getactivewindow getwindowname 2>/dev/null || true
        if [ -n "${window_id:-}" ]; then xwininfo -id "$window_id" 2>/dev/null || true; fi
    fi
    for pid in "$app_pid" "$other_pid" "$wm_pid" "$display_pid"; do
        if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
    done
    exit "$result"
}
trap cleanup EXIT
wait_for() {
    remaining=$1
    shift
    until "$@"; do
        remaining=$((remaining - 1))
        if [ "$remaining" -le 0 ]; then return 1; fi
        sleep 0.1
    done
}
visible() { xwininfo -id "$window_id" 2>/dev/null | grep -q 'Map State: IsViewable'; }
hidden() { xwininfo -id "$window_id" 2>/dev/null | grep -q 'Map State: IsUn'; }
active() { [ "$(xdotool getactivewindow 2>/dev/null)" = "$window_id" ]; }
draft_saved() {
    node --input-type=module -e '
        import { DatabaseSync } from "node:sqlite";
        import { join } from "node:path";
        try {
            const db = new DatabaseSync(join(process.env.KOPLER_DATA_DIR, "kopler.sqlite3"), { readOnly: true });
            const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("draft");
            db.close();
            process.exit(JSON.parse(row?.value ?? "{}").body === process.env.KOPLER_SMOKE_TEXT ? 0 : 1);
        } catch { process.exit(1); }
    ' 2>/dev/null
}
Xvfb :99 -screen 0 1280x800x24 >"$smoke_dir/xvfb.log" 2>&1 &
display_pid=$!
wait_for 100 xdotool getdisplaygeometry >/dev/null 2>&1
# Activated desktop portals must inherit the virtual display set up in this script.
dbus-update-activation-environment DISPLAY GDK_BACKEND XDG_SESSION_TYPE XDG_CURRENT_DESKTOP
openbox >"$smoke_dir/openbox.log" 2>&1 &
wm_pid=$!
"$app_executable" >"$smoke_dir/native.log" 2>&1 &
app_pid=$!
window_id=$(timeout 30 xdotool search --sync --onlyvisible --name '^Kopler$' | head -1)
test -n "$window_id"
timeout 10 xdotool windowactivate --sync "$window_id"
# Window visibility precedes React readiness. A persisted capture edit proves the
# frontend is responsive before testing its save-before-hide shortcut behavior.
KOPLER_SMOKE_TEXT="Native smoke draft $$ $(date +%s)"
export KOPLER_SMOKE_TEXT
ui_ready=0
for attempt in 1 2 3 4 5; do
    if [ "$attempt" -gt 1 ]; then echo "Waiting for capture UI readiness (attempt $attempt)"; fi
    xdotool mousemove --sync --window "$window_id" 100 100 click 1
    xdotool key --clearmodifiers ctrl+a
    xdotool type --clearmodifiers --delay 1 "$KOPLER_SMOKE_TEXT"
    if wait_for 40 draft_saved; then ui_ready=1; break; fi
done
if [ "$ui_ready" -ne 1 ]; then echo 'FAIL: capture UI did not persist the readiness draft'; exit 1; fi
xdotool key --clearmodifiers ctrl+shift+space
if ! wait_for 100 hidden; then
    echo 'FAIL: X11 global shortcut did not hide the focused application'; exit 1
fi
timeout 15 "$app_executable" --show
wait_for 100 visible
draft_saved
test "$(pgrep -x kopler | wc -l)" -eq 1
xmessage -title 'Shortcut smoke second window' -buttons OK:0 'Focus regression check' >"$smoke_dir/other-window.log" 2>&1 &
other_pid=$!
other_id=$(timeout 10 xdotool search --sync --onlyvisible --name '^Shortcut smoke second window$' | head -1)
timeout 10 xdotool windowactivate --sync "$other_id"
test "$(xdotool getactivewindow)" = "$other_id"
xdotool key --clearmodifiers ctrl+shift+space
wait_for 100 active
visible
xdotool key --clearmodifiers ctrl+shift+space
wait_for 100 hidden
xdotool key --clearmodifiers ctrl+shift+space
wait_for 100 visible
wait_for 100 active
draft_saved
echo 'PASS: Linux X11 draft persistence, focused hide, background focus, hidden reveal, and single instance'
