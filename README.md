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

And:

- **CODEX** 5-hour/weekly limits under CLAUDE, read from Codex's own session logs
  on this computer and every connected machine (WSL included); the newest report wins.
- The session card also covers **Codex** and **Pi** (model, effort, context against
  the model's window, cost or tokens, time, cache share), plus a **sub-agents** list:
  every agent the tab started with `hc run`, each with its context and cost. Click
  one to peek at it.
- **Files** is a file tree on every machine, WSL and ssh too: the tree first, and
  a double-click (or Enter) opens the file in the tab's nvim on the right, started
  there the first time. `alt-e` opens and closes it.
- **Blueprint**, chappse6's live diagram of what an agent is building, as a panel.

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
mods/codex-status/
mods/tab-notes/
mods/filetree/
mods/blueprint/
mods/jackc0re-spaces/
mods/wsl/
themes/jackc0re.json
```

For `alt-e` to open the Files panel, add to your `keys.json` under `"global"`:

```json
"alt-e": "jackc0re-tabs.toggle-files"
```

Opening files in nvim needs `nvim` on the machine the space is on. To keep the old
preview instead, set `"open": "preview"` in `mods/filetree/config.json` (and
`"remote_open": "preview"` for other machines).

For the CLAUDE panels, point Claude Code's status line at the wrapper in
`~/.claude/settings.json` (keep your own status line command, if you have one,
as a single-quoted last argument):

```json
"statusLine": { "type": "command",
  "command": "sh ~/.config/herdr-app/mods/claude-status/statusline.sh --hide-in-herdr" }
```

Heads-up: `machine-vitals` runs PowerShell (Windows only), `claude-status` and
`tab-notes` keep files under `~/.config/herdr-app/`. `codex-status` and the
Codex/Pi part of `claude-status` run `sh` (PowerShell for local Codex limits on
Windows) on each machine to read `~/.codex/sessions` and `~/.pi/agent`.
`filetree` runs `git` and `nvim`. `blueprint` asks GitHub once a day whether a
newer Blueprint is out (`herdr-app do blueprint.update-check-off` stops that).

Then switch to it:

```sh
for m in critters jackc0re-tabs machine-vitals claude-status codex-status tab-notes filetree blueprint jackc0re-spaces wsl; do
  herdr-app check ~/.config/herdr-app/mods/$m
done
herdr-app do layout.switch --name jackc0re
```

`ctrl-shift-l` cycles back to your other layouts. Or ask the agent in your Herdr
window to "add herdr.dev/layouts/jackc0re/jackc0re".

To tweak the critters, edit the `CRITTER` table at the top of
`mods/critters/main.js`. Herdr hot-reloads it.

See [`jackc0re/RECIPE.md`](jackc0re/RECIPE.md) for the full brief.

## WSL (NixOS) as a Herdr machine

Optional: spaces, agents and git run natively in a WSL distro (from
[emoss08/herdr-wsl](https://github.com/emoss08/herdr-wsl), MIT, adapted).
`mods/wsl` adds a sidebar row (connection, keepalive, `+` for a WSL space) and
`mods/jackc0re-spaces` (Herdr's 0.1.16 `spaces` + herdr-wsl's two changes) sends
the Spaces `+` to WSL while it is connected. Set `mods/wsl/config.json` to your
machine and distro.

NixOS side (`jackc0re/wsl/`): import `herdr-wsl.nix` (loopback-only sshd on
2222, key-only, linger) and put your own public key in it. Windows side:
`ssh-keygen -t ed25519 -N "" -f ~/.ssh/herdr_wsl_ed25519`, a `Host wsl` entry
(127.0.0.1, port 2222, user, that key), then `hc machine add wsl --install`.
For the CLAUDE panels from Claude Code in WSL, use `herdr-statusline.sh` as its
`statusLine` (it tags terminals `wsl-<id>` and writes to the Windows Herdr home).

## Credits

THIS PC, CLAUDE, Notes and the Claude Code card are adapted from
[ozcberkay/herdr-coban](https://github.com/ozcberkay/herdr-coban) (Apache-2.0,
see `jackc0re/mods/LICENSE-herdr-coban`). The WSL row is from
[emoss08/herdr-wsl](https://github.com/emoss08/herdr-wsl) (MIT, `mods/wsl/LICENSE-herdr-wsl`).
Files is cybertron288's `filetree` from
[cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods) (MIT,
`mods/filetree/LICENSE-herdr-mods`), itself a port of Kurt Buhler's
[claude-code-filetree](https://github.com/data-goblin/claude-code-filetree), changed
here to open files in nvim. Blueprint is
[chappse6/herdr-blueprint-app](https://github.com/chappse6/herdr-blueprint-app)
(MIT, `mods/blueprint/LICENSE-herdr-blueprint`), as-is. The pane headers in my own
setup come from [ChmaraX/herdr-nvim](https://github.com/ChmaraX/herdr-nvim) (install
it with its own installer); this layout ships Herdr's plain `pane` header instead.
