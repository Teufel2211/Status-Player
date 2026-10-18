# Commands

Legend: `(admin)` needs OP level (default 2, see `adminOpLevel`) or the `statusmod.admin` permission. Everything else needs `statusmod.use` (granted to everyone when no permission plugin is installed).

## Status

- `/status` — opens the preset menu (beginner GUI)
- `/status <text> [color]` — set your status, e.g. `/status AFK red`
- `/status clear` — delete your status
- `/status preset <name>` — apply a preset (built-in or own custom)
- `/status preset save <name> <text> [color]` — save your own preset
- `/status preset remove <name>` — delete your own preset
- `/status preset list` — list presets
- `/status timed <minutes> <text>` — status with expiry
- `/status random <text>` — status with a stable random color
- `/status world <text> [color]` — per-world status (current world only)
- `/status world clear` — delete per-world status
- `/status history` — recent statuses, click to re-apply
- `/status version` — mod version + build tag
- `/status list` — who's online with statuses (chat overview, Bedrock-friendly)

## Look

- `/color <name|hex|reset>` — your status color (`red`, `#ffaa00`, `rainbow`, …)
- `/settings brackets <off|square|angle>` — brackets around the status
- `/settings position <before|after>` — status before/after your name
- `/settings words <1-10>` — how many words `/status` takes as text
- `/settings font <style>` — font style
- `/status avatar <name|url|off>` — your dashboard avatar (player name or `https://` skin PNG)
- `/status sidebar <on|off>` — sidebar status list
- `/status topbar <on|off>` — boss-bar status display

## Bugs

- `/bug <text>` — report a bug; requires the server to be connected to a dashboard (the report lands in the server team's dashboard)

## Admin

- `/status gui [page] [search]` — player-head GUI (click a head to prepare set/color)
- `/status admin set <player> <text> [color]` — set someone's status
- `/status admin color <player> <color>` — set someone's color
- `/status admin clear <player>` — clear someone's status
- `/status admin mute <player> <minutes>` / `/status admin unmute <player>` — mute from StatusMod
- `/status badge <player> <text> [color]` — staff badge; `/status badge clear <player>`
- `/status feature list` / `/status feature <key> <on|off>` — toggles: `status badge afk block mute presets code sync bug`
- `/status config show` / `/status config reload` — view/reload config
- `/status sync` — sync wiring + last push/pull (shows key prefix only)
- `/status apikey <key>` — store dashboard API key (**prefer console**: typed commands land in the server log)
- `/status setup-secret <secret>` — store dashboard setup secret (same warning)
- `/status transfer <server-id> <key>` — copy statuses from another server on the same dashboard
- `/block <player>` / `/unblock <player>` — block from StatusMod
- `/code` — login code for the dashboard (admin only)
- `/modinfo` — mod info + links

## Examples

- `/status AFK red`
- `/status Workshop #ffaa00`
- `/status Bin gleich zurück`
- `/settings words 2`
- `/status avatar Delle2211`
- `/status preset save shop Offen green`
