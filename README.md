# herdr-jackc0re

A [Herdr](https://herdr.dev) layout: a warm charcoal and amber theme ported from my
jackc0re Neovim/Zed colorscheme, plus an agents sidebar where every agent is a
little ASCII critter that reacts to its status.

| Status | Critter |
|---|---|
| working | `(•_• )` glancing around, bobbing, with a scanner sweeping the card |
| needs you | `(°o°)!` shaking, red border pulsing |
| done | `\(^o^)/` cheering with confetti |
| idle | `(-_-) zZ` dozing |

Plus, adapted from ozcberkay's [Herdr Çoban](https://github.com/ozcberkay/herdr-coban)
and restyled for jackc0re: **THIS PC** vitals (Windows port) and **CLAUDE**
5-hour/weekly limits with a pace mark in the sidebar, and per-tab **Notes** and a
live **Claude Code** session card in the right panel.

<img src="jackc0re/preview.png" width="260" alt="jackc0re sidebar">

## Install

Copy the contents of [`jackc0re/`](jackc0re) into your Herdr home
(`~/.config/herdr-app`), leaving out `RECIPE.md` and `preview.png`:

```
layouts/jackc0re.json
mods/critters/
mods/jackc0re-tabs/
mods/machine-vitals/
mods/claude-status/
mods/tab-notes/
themes/jackc0re.json
```

For the CLAUDE panels, point Claude Code's status line at the wrapper in
`~/.claude/settings.json` (keep your own status line command, if you have one,
as a single-quoted last argument):

```json
"statusLine": { "type": "command",
  "command": "sh ~/.config/herdr-app/mods/claude-status/statusline.sh --hide-in-herdr" }
```

Heads-up: `machine-vitals` runs PowerShell (Windows only), `claude-status` and
`tab-notes` keep files under `~/.config/herdr-app/`.

Then switch to it:

```sh
for m in critters jackc0re-tabs machine-vitals claude-status tab-notes; do
  herdr-app check ~/.config/herdr-app/mods/$m
done
herdr-app do layout.switch --name jackc0re
```

`ctrl-shift-l` cycles back to your other layouts. Or ask the agent in your Herdr
window to "add herdr.dev/layouts/jackc0re/jackc0re".

To tweak the critters, edit the `CRITTER` table at the top of
`mods/critters/main.js`. Herdr hot-reloads it.

See [`jackc0re/RECIPE.md`](jackc0re/RECIPE.md) for the full brief.

## Credits

THIS PC, CLAUDE, Notes and the Claude Code card are adapted from
[ozcberkay/herdr-coban](https://github.com/ozcberkay/herdr-coban) (Apache-2.0,
see `jackc0re/mods/LICENSE-herdr-coban`).
