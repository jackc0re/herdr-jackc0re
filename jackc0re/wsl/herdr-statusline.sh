#!/bin/sh
# Claude Code status line in NixOS -> Herdr claude-status panels on Windows.
# Terminal "t1" here is "wsl/t1" in Herdr, so its files are kept as "wsl-t1".
[ -n "${HC_TERMINAL_ID:-}" ] && export HC_TERMINAL_ID="wsl-$HC_TERMINAL_ID"
export HERDR_APP_HOME=/mnt/c/Users/GRIGS.DESKTOP-0KH5FS2/.config/herdr-app
exec sh "$HERDR_APP_HOME/mods/claude-status/statusline.sh" --hide-in-herdr "$@"
