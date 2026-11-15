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

<img src="jackc0re/preview.png" width="260" alt="jackc0re sidebar">

## Install

Copy the contents of [`jackc0re/`](jackc0re) into your Herdr home
(`~/.config/herdr-app`), leaving out `RECIPE.md` and `preview.png`:

```
layouts/jackc0re.json
mods/critters/
themes/jackc0re.json
```

Then switch to it:

```sh
herdr-app check ~/.config/herdr-app/mods/critters
herdr-app do layout.switch --name jackc0re
```

`ctrl-shift-l` cycles back to your other layouts. Or ask the agent in your Herdr
window to "add herdr.dev/layouts/jackc0re/jackc0re".

To tweak the critters, edit the `CRITTER` table at the top of
`mods/critters/main.js`. Herdr hot-reloads it.

See [`jackc0re/RECIPE.md`](jackc0re/RECIPE.md) for the full brief.
