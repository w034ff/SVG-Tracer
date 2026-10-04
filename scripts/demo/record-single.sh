#!/usr/bin/env bash
# Records the single-conversion demo shown in the README
# (docs/images/demo-single.gif) by driving the Linux release build inside a
# virtual X server.
#
# Needs: xvfb, xdotool, ffmpeg, python3, and the Adwaita cursor theme
# (sudo apt-get install -y xvfb xdotool ffmpeg). Build the app first:
#   npm run tauri build -- --no-bundle
# Then run from the repository root: scripts/demo/record-single.sh
#
# The click positions below are window coordinates of the current layout at
# the default window size (tauri.conf.json). After a layout change, take a
# screenshot of each step and update them.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
APP=$ROOT/target/release/svg-tracer
SOURCE_IMAGE=$ROOT/crates/tracer/tests/fixtures/logo_color.png
OUT=$ROOT/docs/images/demo-single.gif
CURSOR_FILE=/usr/share/icons/Adwaita/cursors/default

# Must match the window size in tauri.conf.json so the window fills the screen.
SCREEN_W=1200
SCREEN_H=800
DISPLAY_NUM=:99
# At 200 px the trace loses the shapes' corners; 400 px traces cleanly and
# still shows jagged edges when zoomed in.
DEMO_IMAGE_SIZE=400
# Without a window manager GTK file dialogs open at the top-left corner at
# full screen size, so they are moved to the centre and outlined afterwards.
DIALOG_X=250
DIALOG_Y=160
DIALOG_W=700
DIALOG_H=480
POINTER_START_X=760
POINTER_START_Y=600
CAPTURE_FPS=25
GIF_FPS=12
GIF_WIDTH=960
GIF_COLORS=128

WORK=$(mktemp -d)
HOME_DIR=$WORK/home
PICTURES=$HOME_DIR/Pictures
EVENTS=$WORK/events.log
export DISPLAY=$DISPLAY_NUM

cleanup() {
  kill "${APP_PID:-}" "${XVFB_PID:-}" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf -- "${WORK:?}"
}
trap cleanup EXIT

# --- Environment ----------------------------------------------------------

mkdir -p "$PICTURES" "$HOME_DIR/.config/glib-2.0/settings"
ffmpeg -loglevel error -y -i "$SOURCE_IMAGE" \
  -vf "scale=$DEMO_IMAGE_SIZE:$DEMO_IMAGE_SIZE:flags=area" "$PICTURES/logo.png"
# Open the file chooser in the working directory (Pictures) instead of "Recent".
printf "[org/gtk/settings/file-chooser]\nstartup-mode='cwd'\n" \
  >"$HOME_DIR/.config/glib-2.0/settings/keyfile"

Xvfb "$DISPLAY_NUM" -screen 0 "${SCREEN_W}x${SCREEN_H}x24" -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
for _ in $(seq 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done

# A fresh HOME gives default settings and English UI. The input method is
# turned off so that xdotool keystrokes are not converted.
(
  cd "$PICTURES"
  HOME=$HOME_DIR XDG_CONFIG_HOME=$HOME_DIR/.config XDG_DATA_HOME=$HOME_DIR/.local/share \
    LANG=C.UTF-8 LANGUAGE=en GDK_BACKEND=x11 GSETTINGS_BACKEND=keyfile \
    GTK_IM_MODULE=gtk-im-context-simple XMODIFIERS= \
    exec "$APP" >"$WORK/app.log" 2>&1
) &
APP_PID=$!
sleep 5

# --- Helpers --------------------------------------------------------------

now() { awk -v a="$(date +%s.%N)" -v b="$T0" 'BEGIN { printf "%.3f", a - b }'; }

# Xvfb shows an "X" pointer wherever the app does not set a cursor, so the
# pointer is left out of the capture and drawn from these logged positions.
glide() {
  local x=$1 y=$2 steps=${3:-12} px py
  eval "$(xdotool getmouselocation --shell)"
  while read -r px py; do
    xdotool mousemove "$px" "$py"
    echo "move $(now) $px $py" >>"$EVENTS"
    sleep 0.012
  done < <(awk -v sx="$X" -v sy="$Y" -v x="$x" -v y="$y" -v n="$steps" \
    'BEGIN { for (i = 1; i <= n; i++) { t = i / n; f = t * t * (3 - 2 * t);
      printf "%d %d\n", sx + (x - sx) * f + 0.5, sy + (y - sy) * f + 0.5 } }')
}

click_at() { glide "$1" "$2"; sleep 0.2; xdotool click 1; }

place_dialog() {
  local id=""
  for _ in $(seq 50); do
    id=$(xdotool search --name "^$1\$" 2>/dev/null | head -1) || true
    [ -n "$id" ] && break
    sleep 0.1
  done
  xdotool windowsize "$id" "$DIALOG_W" "$DIALOG_H" windowmove "$id" "$DIALOG_X" "$DIALOG_Y"
}

# --- Scenario -------------------------------------------------------------

xdotool mousemove "$POINTER_START_X" "$POINTER_START_Y"
ffmpeg -loglevel error -y -f x11grab -draw_mouse 0 -framerate "$CAPTURE_FPS" \
  -video_size "${SCREEN_W}x${SCREEN_H}" -i "$DISPLAY_NUM" \
  -c:v libx264 -preset ultrafast -qp 0 "$WORK/raw.mp4" &
FFMPEG_PID=$!
T0=$(date +%s.%N)
echo "move 0 $POINTER_START_X $POINTER_START_Y" >"$EVENTS"
sleep 0.8

# Open the image
click_at 749 467
D0=$(now)
place_dialog "Open File"
sleep 0.6
click_at 470 243
sleep 0.3
click_at 900 617
echo "dialog $D0 $(now)" >>"$EVENTS"
sleep 1.5

# Fit, then zoom in to compare the edges
click_at 1088 70
sleep 1.3
for _ in 1 2 3; do click_at 1038 70; sleep 0.35; done
sleep 0.5
glide 520 380 16
sleep 0.3
glide 980 380 20
sleep 0.6

# Switch to "Black & white" and back to "Logo (color)"
click_at 149 105
sleep 0.6
click_at 80 179
sleep 1.4
click_at 149 105
sleep 0.5
click_at 80 133
sleep 0.8

# Fit again and save
click_at 1088 70
sleep 1.0
click_at 1140 773
D0=$(now)
place_dialog "Save File"
sleep 0.8
click_at 900 616
echo "dialog $D0 $(now)" >>"$EVENTS"
sleep 0.3
glide 900 700 16
sleep 1.5

kill -INT "$FFMPEG_PID"
wait "$FFMPEG_PID" || true
if [ ! -f "$PICTURES/logo.svg" ]; then
  echo "The SVG was not saved; a click position is probably off." >&2
  exit 1
fi

# --- Compose --------------------------------------------------------------

read -r HOT_X HOT_Y < <(python3 "$(dirname "$0")/xcursor-to-png.py" "$CURSOR_FILE" "$WORK/cursor.png")
awk -v hx="$HOT_X" -v hy="$HOT_Y" '$1 == "move" {
  printf "%s overlay@cur x %d, overlay@cur y %d;\n", $2, $3 - hx, $4 - hy }' "$EVENTS" >"$WORK/cursor.cmd"
outlines=$(awk -v x=$((DIALOG_X - 1)) -v y=$((DIALOG_Y - 1)) \
  -v w=$((DIALOG_W + 2)) -v h=$((DIALOG_H + 2)) '$1 == "dialog" {
  printf ",drawbox=x=%d:y=%d:w=%d:h=%d:color=0x9a9a9a:t=1:enable=%cbetween(t,%s,%s)%c",
    x, y, w, h, 39, $2, $3, 39 }' "$EVENTS")

mkdir -p "$(dirname "$OUT")"
ffmpeg -loglevel error -y -i "$WORK/raw.mp4" -loop 1 -i "$WORK/cursor.png" -filter_complex "
  [0:v]null${outlines},sendcmd=f=$WORK/cursor.cmd[bg];
  [bg][1:v]overlay@cur=x=$((POINTER_START_X - HOT_X)):y=$((POINTER_START_Y - HOT_Y)):shortest=1,
  fps=$GIF_FPS,scale=$GIF_WIDTH:-1:flags=lanczos,split[a][b];
  [a]palettegen=max_colors=$GIF_COLORS:stats_mode=diff[p];
  [b][p]paletteuse=dither=none:diff_mode=rectangle" "$OUT"
echo "Wrote $OUT"
