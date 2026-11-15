# Building

## All loaders, all versions (recommended)

Builds all 24 combinations (fabric/forge/neoforge/quilt × 1.21.11/26.1/26.1.1/26.1.2/26.2/26.3):

```powershell
.\scripts\local\build-multiversion.ps1 -Loaders fabric,forge,neoforge,quilt -ContinueOnError:$false
```

Output: `dist/multiversion/` (24 × `Statusmod-1.4.2-<loader>-<mc>.jar`), verified by `scripts/ci/verify-jars.ps1`.

## Single loader

```powershell
.\scripts\local\build-multiversion.ps1 -Loaders fabric -ContinueOnError:$false
.\scripts\local\build-multiversion.ps1 -Loaders forge -ContinueOnError:$false
.\scripts\local\build-multiversion.ps1 -Loaders neoforge -ContinueOnError:$false
.\scripts\local\build-multiversion.ps1 -Loaders quilt -ContinueOnError:$false
```

## How 26.x builds work

- **Fabric/NeoForge 26.x**: plain `javac` against Mojang's unobfuscated JARs (`scripts/local/build-fabric26-plain.ps1`, `build-neoforge26-plain.ps1`). A mapping gate refuses `net/minecraft/class_*` references.
- **Forge 26.x**: standalone ForgeGradle 7 (`Loader/forge26.1/`), one build copied to all five 26.x versions.
- **Quilt**: repackaged from the Fabric JAR (metadata swap only).

## Requirements

- Java 21 for 1.21.11 builds, Java 25 for 26.x (auto-detected under `C:\Program Files\Java`, override with `-JavaHome` on plain scripts)
- Gradle via wrapper (`gradlew.bat`) — no separate install needed
- > 6 GB free disk (Loom caches); `~\.gradle\caches\fabric-loom` can be deleted safely if space runs out

## Testing

```powershell
# Server boot matrix (default server-only, no client windows)
.\scripts\ci\test-mod-matrix.ps1 -Loaders fabric -McVersions 1.21.11 -Mods StatusMod
# With client: -WithClient (see docs/modrinth-client-test.md)
```

## Local release publishing

```powershell
.\scripts\ci\check-release-tokens.ps1   # read-only: are all tokens/IDs valid?
```

Required env vars: `MODRINTH_TOKEN`, `MODRINTH_PROJECT_ID`, `CURSEFORGE_TOKEN`, `CURSEFORGE_PROJECT_ID` (all required since 1.4.0 — publishing aborts otherwise). Details: [Release](Release).
