# Changelog

All notable changes to this project are documented in this file.

## 1.4.2 - 2026-10-27

Starting with 1.4.2, entries are grouped under **Added**, **Changed**, **Improved** and **Removed**; empty groups are omitted.

### Added

- Timed statuses: `/status <text> [color] <duration>` (for example `30m`, `2h`, `1d`). The previous status returns automatically when the time is up, also after a server restart; the dashboard shows the remaining time.
- Temporary ignore: `/ignore <player> [duration]` and `/unignore <player>`, plus duration controls in the dashboard. The previous status is restored automatically when the ignore expires.
- Per-player chat slowmode: set the minimum seconds between chat messages in the dashboard; players get a remaining-time notice when they send too fast.
- Warning levels 1–3: assigned only in the dashboard, shown in-game as `[!1]`/`[!2]`/`[!3]` next to the status (yellow → gold → red). Warnings expire automatically (default 14 days, configurable); only active warnings count. From 3 active warnings the dashboard offers a 60-minute mute (opt-in per server, never applied automatically).
- Server presets: owners maintain name, status and color in the dashboard; they appear in-game in the `/status` menu, `/status preset list` and `/status preset <name>` for all players.
- New `/bug <text>` command: report bugs right from the game. The report (player name, server, mod/MC version, loader) lands in the dashboard inbox of the server team. Needs a dashboard-connected server; can be toggled with `/status feature bug`.
- New keybind (default `U`) opens the `/status` menu. Rebindable under Options → Controls → Key Binds → StatusMod.
- Admin kill switch: disable StatusMod per server or globally from the admin dashboard. While disabled, status display, AFK, moderation, commands and sync push are off; the mod keeps polling, so re-enabling applies within 15 seconds without a restart. `/modinfo` still reports the state.
- Server sync recovers on its own: after a network error or a dashboard outage the mod reconnects with backoff and pushes every change made in the meantime. Nothing is lost and no restart is needed.
- Signed release builds: every release JAR carries a signed build manifest (Ed25519). The mod refuses to start when the manifest no longer matches its own content, and the dashboard only accepts sync from verified builds. The dashboard overview shows the running build and, for test servers, a "Dev-Builds erlauben" switch.
- Release gate: before publishing, CI registers every JAR by build ID in the dashboard registry. On start the mod checks that registry and refuses to run unknown builds (only `/modinfo` stays available). The first start of a new build does a single check (~150–500 ms, hard cap 2 s); afterwards a local cache decides instantly without network. If the dashboard is unreachable, the mod starts anyway. Unknown builds show up red in the dashboard; only the project owner can unlock exactly one build for exactly one server (per server, never global).

### Changed

- Admin-only commands: `/code`, `/modinfo` and `/status version` now require admin permissions. `/code` and `/modinfo` are also hidden from non-admin command suggestions; `/status version` stays listed but rejects non-admins.
- The default `adminOpLevel` is now `4` (owner only). Existing config files keep the level they already specify.
- Display name: the mod now appears as **Status Player** in the mod list instead of **Status Mod**.
- Kill switch chat notice: when StatusMod is disabled, players see why (per-server owner notice or global Discord pointer) on join and immediately when the switch changes.
- License: from 1.4.2 on, Status Player is released under the **Status Player License 1.0** instead of MIT. Running it on your own servers (including monetized ones) and modifying it for private use stay allowed; rebranding it or publishing a modified version as your own mod does not. A continuation may be published if the project has had no release for twelve months. Versions up to and including 1.4.1 remain MIT.
- Server start no longer prints the attest success line; the build gate state is visible in `/modinfo` instead. Unlocking unknown builds is done in the admin dashboard, not in the per-server owner dashboard.
- After logging in, the project owner lands directly on the admin dashboard while everyone else — server owners included — lands on the dashboard of their own server. The "Dashboard" button on the landing page routes the same way.

### Improved

- `/bug` now accepts up to 3 screenshots per report: attach them in-game (screenshot picker) or upload them in the browser via the link in chat (works for vanilla clients and Bedrock players too). Images show up as thumbnails in the dashboard inbox.
- Mod menu links: the Website and Issues buttons now open the Modrinth project page and the GitHub issue tracker instead of being greyed out.
- Release builds are obfuscated: internal class names are shortened and debug information (source file names, line numbers, local variable names) is removed. Loader entrypoints, the public API, the dashboard sync and all commands behave unchanged.
- Dashboard sync pairs itself: on first contact the dashboard issues the sync code and the mod adopts it in the background. No console command and no dashboard page are needed, and a lost pairing re-connects automatically.
- Sync works for any server size: players, mutes and blocks are pushed in chunks of 200, so the previous silent 200-player ceiling is gone.

### Removed

- `/status sync` (including `sync status`, `sync confirm <code>` and `sync reset`) and the dashboard "Sync" page: the sync code is handled internally now, so there is nothing to confirm, inspect or reset by hand.

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
