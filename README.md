# Status Player

Status Player adds lightweight status tags for players on Minecraft servers and clients.
Players can set a custom status text and color that is shown in the player list (TAB) and above their name.

## Highlights

- `/status <text> [color] [duration]` to set your status quickly (`30m`, `2h`, `1d`)
- `/status clear` to remove your status
- `/status preset <name>`, `/status timed <minutes> <status>`, `/status random <status>`
- `/status world <status>` per-dimension override
- `/status history` to view recent statuses
- Color support for English and German names, plus hex (`#RRGGBB` / `#RGB`)
- Placeholders: `{world}`, `{ping}`
- Your status is saved and restored automatically when you rejoin
- Timed statuses revert automatically, even after a server restart
- Admin tools for moderation (`/block`, `/unblock`, `/ignore`, `/unignore`, `/status admin ...`)

## Commands

- `/status <text> [color] [duration]`
- `/status clear`
- `/status preset <name>`
- `/status timed <minutes> <status>`
- `/status random <status>`
- `/status world <status> [color]`
- `/status world clear`
- `/status history`
- `/color <name|hex|reset>`
- `/settings brackets <on|off>`
- `/settings position <before|after>`
- `/settings words <number>`
- `/status admin set <player> <status> [color]` (if enabled in config)
- `/status admin clear <player>` (if enabled in config)
- `/block <player>` / `/unblock <player>`
- `/ignore <player> [duration]` / `/unignore <player>` (temporary block)
- `/status config show`
- `/status config reload`
- `/modinfo`

## Examples

- `/status AFK red`
- `/status Workshop #ffaa00`
- `/status Bauen 2h`
- `/status Busy`
- `/settings words 2`
- `/status Not Disturb orange` (with `words=2`, status = `Not Disturb`, color = `orange`)
- `/ignore Griefer 1d`

## Installation

1. Download the release JAR that matches your loader and Minecraft version.
2. Put it in the `mods/` folder on the server or client.
3. Start or restart Minecraft/server.

**Note:** Forge/NeoForge builds require the corresponding mod loader installed on the server/client.

## Compatibility

| Loader | Minecraft versions |
|--------|-------------------|
| Fabric | 1.21.11, 26.1, 26.1.1, 26.1.2, 26.2, 26.3 |
| Forge | 1.21.11, 26.1, 26.1.1, 26.1.2, 26.2, 26.3 |
| NeoForge | 1.21.11, 26.1, 26.1.1, 26.1.2, 26.2, 26.3 |
| Quilt | 1.21.11, 26.1, 26.1.1, 26.1.2, 26.2, 26.3 |

That is 24 builds (4 loaders × 6 Minecraft versions).

## Configuration

Server owners find all options in `config/statusmod/config.json`
(admin level, permissions, default color, cooldowns, staff badge and more).
Changes apply with `/status config reload` — no restart needed.

## Privacy

Without a dashboard connection the mod works fully local: no external
connections, no telemetry. Data stays on your own server
(`config/statusmod/`: player UUID, name, status text and color, settings).

Optional: connect your own dashboard (opt-in in `config.json`). While enabled,
the mod syncs player UUID, name, online presence, status text and color,
settings, mute state and block list to the dashboard URL you configured, so
you can manage players from the web. Disable anytime by clearing the dashboard
values in the config.

## Links

- Source: https://github.com/Teufel2211/Status-Player
- Issues: https://github.com/Teufel2211/Status-Player/issues

## License

**Status Player License 1.0** from version 1.4.2 on. See `LICENSE`.

In short: use it on your own servers (also monetized ones) and modify it for
private use — that is fine. Redistributing it under a different name, or
publishing a modified version as your own mod, is not.

Exception: if this project has had no release for at least twelve months, you
may publish a continuation — including under your own name — as long as it
states that it is based on Status Player and links back here.

Versions up to and including 1.4.1 were published under the MIT License and
stay under it; the old text is kept in `LICENSE-MIT-legacy.txt`.

---

*Developer? Building, repository layout and internals: see `docs/BUILD.md`.*
