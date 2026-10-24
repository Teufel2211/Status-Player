# Changelog

All notable changes to this project are documented in this file.

## Unreleased

- Timed statuses: `/status <text> [color] <duration>` (for example `30m`, `2h`, `1d`). The previous status returns automatically when the time is up, also after a server restart; the dashboard shows the remaining time.
- Temporary ignore: `/ignore <player> [duration]` and `/unignore <player>`, plus duration controls in the dashboard. The previous status is restored automatically when the ignore expires.
- Per-player chat slowmode: set the minimum seconds between chat messages in the dashboard; players get a remaining-time notice when they send too fast.
- Warning levels 1–3: assigned only in the dashboard, shown in-game as `[!1]`/`[!2]`/`[!3]` next to the status (yellow → gold → red). Warnings expire automatically (default 14 days, configurable); only active warnings count. From 3 active warnings the dashboard offers a 60-minute mute (opt-in per server, never applied automatically).
- Server presets: owners maintain name, status and color in the dashboard; they appear in-game in the `/status` menu, `/status preset list` and `/status preset <name>` for all players.
- New `/bug <text>` command: report bugs right from the game. The report (player name, server, mod/MC version, loader) lands in the dashboard inbox of the server team. Needs a dashboard-connected server; can be toggled with `/status feature bug`.
- `/bug` now accepts up to 3 screenshots per report: attach them in-game (screenshot picker) or upload them in the browser via the link in chat (works for vanilla clients and Bedrock players too). Images show up as thumbnails in the dashboard inbox.
- New keybind (default `U`) opens the `/status` menu. Rebindable under Options → Controls → Key Binds → StatusMod.
- Admin kill switch: disable StatusMod per server or for the whole fleet from the admin dashboard. While disabled, status display, AFK, moderation, commands and sync push are off; the mod keeps polling, so re-enabling applies within 15 seconds without a restart. `/modinfo` still reports the state.

## 1.4.1 - 2026-10-15

- Geyser support for MC 26.3: the Bedrock-incompatibility warnings are gone (console, join ping, `/status version`).
- Console commands answer again on Fabric/Quilt 1.21.11 (`/modinfo`, `/status preset list`, `/status config show` were silently swallowed).
- Dashboard unmute/unblock now applies in game (previously re-added by the next sync).
- Login with two-factor authentication is now actually enforced; codes are single-use even under parallel requests.
- Dashboard session handling fixed (no more instant logout after registering, refresh rotation hardened).
- Many small stability fixes (sync, permissions, audit log, config handling).

## 1.4.0 - 2026-10-12

- Self-status GUI: bare `/status` opens a beginner-friendly menu (colored wool presets including own customs, live status display, next/clear buttons).
- Admin player GUI: `/status gui` with skinned heads, search and pages; clicking a head prepares the status/color command.
- Dashboard link: automatic server setup via console code, live two-way sync (status, badge, mute, block, online presence), `/status transfer`, `/status apikey`, `/status setup-secret`, `/status sync`.
- Custom dashboard avatars: `/status avatar <name|url|off>` (self or, for admins, other players).
- Bedrock (Geyser/Floodgate) output channels: boss bar/action bar, sidebar and `/status list`; warning when running on unsupported MC 26.3.
- New toggles/commands: `/status sidebar`, `/status topbar`, `/status version`, clickable status history.
- Per-world status/color, placeholders (e.g. `{time}`), emoji support, bracket styles, font styles.
- Auto-AFK rework: configurable text/color, restores the previous status on return.
- Pretty-printed `config.json`; reload merges instead of clobbering manual edits.
- Quilt loader support and MC 26.3 support: 24 jars (fabric/forge/neoforge/quilt x 1.21.11/26.1/26.1.1/26.1.2/26.2/26.3).
- GUI hardening: menu items can no longer be taken, dropped or duplicated (restore + purge + resync + per-tick reconcile + close cleanup).
- Item names/lore work on all runtimes (fixes paper/default names on Fabric/Quilt 1.21.11).
- Permissions: UUID-based operator checks (no username spoofing), strict command-permission tiers.
- Dashboard URLs strictly validated (HTTPS or loopback host only).
- Input sanitization for status/badge/preset/avatar/transfer/sync text; preset names normalized (max 500 customs).
- Sync/transfer HTTP bodies capped (8 MB); transfer capped at 5000 players; fetched API keys length-checked.
- Avatar URLs restricted to https.
- Forge `mods.toml` version now expands correctly in standalone builds.

## 1.3.0

- Added Forge and NeoForge loader support.
- Forge: MC 1.19 - 25.x via Architectury Loom (`loom.platform=forge`).
- Forge: MC 26.1 - 26.2 via standalone ForgeGradle 7 (`Loader/forge26.1/`).
- NeoForge: MC 1.21+ via Architectury Loom (`loom.platform=neoforge`).
- MC 26.x builds use unobfuscated game code (no mappings needed).
- Multiversion build script now builds all 15 combinations: fabric/forge/neoforge × 26.2/26.1.2/26.1.1/26.1/1.21.11.
- Removed vestigial `forge_minecraft_version` and `forge_gradle_version` properties.
- Cleaned up `.gitignore` and temp files.

## 1.2.9

- Added local multi-version build and publish scripts.
- Added auto-detected Fabric API selection from Maven for 1.21.x.
- Added robust permission checks across Minecraft/Fabric versions.
- Added rainbow1530 palette support from bundled RGB list.
