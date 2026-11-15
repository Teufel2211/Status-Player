# Compatibility

StatusMod builds for four loaders across six Minecraft versions (24 JARs):

| Loader | Minecraft versions | Build system |
|--------|-------------------|--------------|
| Fabric | 1.21.11 | Architectury Loom (Mojang mappings) |
| Fabric | 26.1 – 26.3 | Plain javac (unobfuscated, no mappings) |
| Forge | 1.21.11 | Architectury Loom (`loom.platform=forge`) |
| Forge | 26.1 – 26.3 | Standalone ForgeGradle 7 (`Loader/forge26.1/`, one build per all 26.x) |
| NeoForge | 1.21.11 | Architectury Loom (`loom.platform=neoforge`) |
| NeoForge | 26.1 – 26.3 | Plain javac (unobfuscated) |
| Quilt | 1.21.11, 26.1 – 26.3 | Repackaged from Fabric |

## Notes

- MC 26.x ships unobfuscated (Mojang stopped obfuscating with 26.1), so no mappings are needed for 26.x builds.
- Java: 1.21.11 = Java 21 (class file 65); 26.x = Java 25.
- Bedrock players via Geyser/Floodgate: tab-list prefixes don't reach Bedrock (protocol limitation) — use `/status list`, boss bar/action bar and sidebar instead (see [Commands](Commands)). Floodgate on MC 26.3 warns: no compatible Geyser release yet.
- Forge 26.1 via third-party launchers (Modrinth/Prism) can crash in `FireBlock` bootstrap — upstream Forge issue, also happens vanilla. Use the official installer pipeline or 26.1.1+.
- LuckyPerms (if installed): `statusmod.use` / `statusmod.admin`. Without it, everyone may use `/status`, OP level (`adminOpLevel`, default 4) gates admin commands.

## Build inputs

- `common/` — shared code
- `fabric/`, `forge/`, `neoforge/` — loader shims (1.21.11)
- `Loader/forge26.1/` — standalone Forge 26.x
- `quilt/` — `quilt.mod.json` template for repackaging
- `scripts/local/build-multiversion.ps1` — orchestrates StatusMod builds (see [Building](Building))
