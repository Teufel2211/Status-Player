# StatusMod Wiki

StatusMod adds lightweight status tags for players on Minecraft servers and clients.

Current version: **1.4.2** (see [CHANGELOG](../CHANGELOG.md)).

Supported loaders and Minecraft versions:

| Loader | Versions | Build system |
|--------|----------|--------------|
| Fabric | 1.21.11 | Architectury Loom |
| Fabric | 26.1 – 26.3 | Plain javac (unobfuscated) |
| Forge | 1.21.11 | Architectury Loom (`loom.platform=forge`) |
| Forge | 26.1 – 26.3 | Standalone ForgeGradle 7 (`Loader/forge26.1/`) |
| NeoForge | 1.21.11 | Architectury Loom (`loom.platform=neoforge`) |
| NeoForge | 26.1 – 26.3 | Plain javac (unobfuscated) |
| Quilt | 1.21.11, 26.1 – 26.3 | Repackaged from Fabric |

That's 24 JARs: 4 loaders × 6 versions.

## Wiki Pages

- [Installation](Installation) — download, install, first start
- [Commands](Commands) — all commands with examples
- [Configuration](Configuration) — `config.json` fields and storage files
- [Dashboard](Dashboard) — web dashboard: setup, sync, players, keys
- [Building](Building) — build all 24 JARs locally
- [Compatibility](Compatibility) — loaders, versions, Bedrock
- [Release](Release) — token check + publishing (maintainers)

## Quick Summary

- Players set a custom status + color (`/status`), shown in tab list, names, boss bar/sidebar.
- Timed statuses (`/status Bauen 2h`) return automatically; per-player chat slowmode and temporary ignores are managed in the dashboard.
- Beginner GUI: bare `/status` opens a preset menu; `/status gui` (admin) shows player heads.
- Optional web dashboard (opt-in): live two-way sync, player management, warnings, server presets, API keys.
- Optional client extra: keybind `U` opens the `/status` menu (rebindable); `/bug` can attach up to 3 screenshots (in-game picker or browser link).
- Status data is stored locally in `config/statusmod/` (JSON, works without dashboard).
- AI disclosure: development is AI-assisted (see Modrinth project page).
