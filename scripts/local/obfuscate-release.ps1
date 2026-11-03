<#
.SYNOPSIS
    Obfuscates the Status Player release JARs.

.DESCRIPTION
    A4 release-only step. ProGuard computes the class mapping for com.teufel.statusmod.**,
    then scripts/local/ObfuscateRemap.java applies that mapping with ASM to the original
    (unmodified) JAR. ProGuard's own output is discarded on purpose: ProGuard 7.10.0 writes
    broken StackMapTable frames for class file version 69 (Java 25), which makes the JAR fail
    with "VerifyError: Bad type on operand stack". Remapping the original JAR keeps the
    original, valid frames and only rewrites class references.

    Debug information (SourceFile, LineNumberTable, LocalVariableTable) is stripped.
    Only class names are obfuscated; method and field names stay readable. That keeps
    loader entrypoints, reflection targets, ServiceLoader entries and Gson models intact.

    The script never overwrites an input JAR in-place. It writes temporary output,
    validates it, and only then replaces the release artifact.

.PARAMETER InputDir
    Release directory. Defaults to dist/multiversion.

.PARAMETER MirrorDir
    Optional second directory receiving the validated JARs, e.g. D:\Mods\StatusMod.

.PARAMETER ProguardJar
    Path to proguard-base.jar. Defaults to the approved local cache path.

.PARAMETER AsmVersion
    ASM version resolved from the Gradle module cache. Defaults to 9.10.1.

.PARAMETER DryRun
    Print the 24 targets without modifying them.
#>
[CmdletBinding()]
param(
    [string]$InputDir = "dist/multiversion",
    [string]$MirrorDir = "",
    [string]$ProguardJar = "$env:TEMP\opencode\proguard\proguard-base-7.10.0.jar",
    [string]$ProguardCoreJar = "$env:TEMP\opencode\proguard\proguard-core-9.4.0.jar",
    [string]$ProguardDependencyDir = "$env:TEMP\opencode\proguard",
    [string]$AsmVersion = "9.10.1",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$inputRoot = (Resolve-Path (Join-Path $root $InputDir)).Path
$version = (Get-Content -LiteralPath (Join-Path $root "version.txt") -Raw).Trim()
$workRoot = Join-Path $env:TEMP "opencode\statusmod-a4-$([guid]::NewGuid().ToString('N'))"
$backupRoot = Join-Path $root "dist\a4-backup-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
$stampScript = Join-Path $PSScriptRoot "stamp-build.ps1"
$remapTool = Join-Path $PSScriptRoot "ObfuscateRemap.java"

if (-not (Test-Path -LiteralPath $ProguardJar)) { throw "ProGuard JAR not found: $ProguardJar" }
if (-not (Test-Path -LiteralPath $ProguardCoreJar)) { throw "ProGuard core JAR not found: $ProguardCoreJar" }
if (-not (Test-Path -LiteralPath $remapTool)) { throw "Remap tool not found: $remapTool" }
$proguardDeps = @(Get-ChildItem -LiteralPath $ProguardDependencyDir -File -Filter "*.jar" | ForEach-Object { $_.FullName })
$proguardClasspath = (($ProguardJar, $ProguardCoreJar) + $proguardDeps | Select-Object -Unique) -join [IO.Path]::PathSeparator

# ASM is only used by ObfuscateRemap.java; resolve the three artifacts from the Gradle cache.
$asmCache = Join-Path $env:USERPROFILE ".gradle\caches\modules-2\files-2.1\org.ow2.asm"
function Resolve-AsmJar([string]$Artifact) {
    $dir = Join-Path $asmCache $Artifact
    if (-not (Test-Path -LiteralPath $dir)) { throw "ASM cache directory missing: $dir" }
    $jar = Get-ChildItem -LiteralPath $dir -Recurse -File -Filter "$Artifact-$AsmVersion.jar" | Select-Object -First 1
    if (-not $jar) { throw "ASM $Artifact $AsmVersion not found in $dir" }
    return $jar.FullName
}
$asmClasspath = ((Resolve-AsmJar "asm"), (Resolve-AsmJar "asm-commons"), (Resolve-AsmJar "asm-tree")) -join [IO.Path]::PathSeparator

$jars = @(Get-ChildItem -LiteralPath $inputRoot -Recurse -File -Filter "Statusmod-$version-*.jar" |
    Where-Object { $_.FullName -notmatch "\\.gradle-user-home\\|\\logs\\" })
if ($jars.Count -ne 24) { throw "Expected 24 release JARs, found $($jars.Count)" }

if ($DryRun) {
    $jars | ForEach-Object { Write-Host $_.FullName }
    exit 0
}

New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

# Guard: never obfuscate an already obfuscated artifact (double obfuscation
# destroys keep-rule guarantees and cannot be undone without the original).
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($jar in $jars) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($jar.FullName)
    try {
        $already = $zip.Entries | Where-Object { $_.FullName -match '^com/teufel/statusmod/[a-z]/' } | Select-Object -First 1
    } finally {
        $zip.Dispose()
    }
    if ($already) { throw "Input JAR is already obfuscated ($($jar.Name)); restore the unobfuscated original first." }
}

# Back up BEFORE processing so an interrupted run never loses the originals.
foreach ($jar in $jars) {
    $relative = $jar.FullName.Substring($inputRoot.Length).TrimStart('\')
    $backup = Join-Path $backupRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
    Copy-Item -LiteralPath $jar.FullName -Destination $backup -Force
}
Write-Host "Backup: $backupRoot"

# A4: Only obfuscate com.teufel.statusmod.**. Keep loader entrypoints, API, reflection targets,
# ServiceLoader implementations, Gson model fields, and Minecraft/Loader/Floodgate/LuckPerms untouched.
# ProGuard output is thrown away: only the -printmapping result is used.
$keep = @'
-dontoptimize
-dontshrink
-dontwarn **
-ignorewarnings
-dontpreverify
# Loader entrypoints (loaded by name from fabric.mod.json / mods.toml / quilt.mod.json)
-keep public class com.teufel.statusmod.fabric.StatusModFabric { *; }
-keep public class com.teufel.statusmod.fabric.StatusModFabricClient { *; }
-keep public class com.teufel.statusmod.forge.StatusModForge { *; }
-keep public class com.teufel.statusmod.neoforge.StatusModNeoForge { *; }
# Loaded by name: Class.forName("com.teufel.statusmod.gui.ClickablePlayerHeadMenu")
-keep public class com.teufel.statusmod.gui.ClickablePlayerHeadMenu { *; }
# Public API surface
-keep public class com.teufel.statusmod.api.StatusModAPI { *; }
# Core entry class (IdentityCheck reads its constants)
-keep public class com.teufel.statusmod.StatusMod { *; }
# Platform interface + ServiceLoader implementations (names live in META-INF/services)
-keep class com.teufel.statusmod.platform.** { *; }
-keep class com.teufel.statusmod.fabric.platform.** { *; }
-keep class com.teufel.statusmod.forge.platform.** { *; }
-keep class com.teufel.statusmod.neoforge.platform.** { *; }
# Gson models: field names are persisted in JSON
-keep class com.teufel.statusmod.storage.ModConfig { *; }
-keep class com.teufel.statusmod.storage.ModConfig$StaffBadge { *; }
-keep class com.teufel.statusmod.storage.PlayerSettings { *; }
-keep class com.teufel.statusmod.storage.BlockedPlayers$BlockEntry { *; }
-keep class com.teufel.statusmod.storage.WarningStore$WarnInfo { *; }
-keep class com.teufel.statusmod.storage.ServerPresets$ServerPreset { *; }
-keep class com.teufel.statusmod.storage.CustomPresets$* { *; }
# Every mod field name stays readable (Gson + JSON persistence).
-keepclassmembers class com.teufel.statusmod.** { <fields>; }
# Public/protected signatures are kept for reflective callers and plugins.
-keepclassmembers class com.teufel.statusmod.** { public <methods>; protected <methods>; }
-printmapping __MAPPING__
'@

function Get-JarFileEntries([string]$Path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        return @($zip.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) } | ForEach-Object { $_.FullName })
    } finally {
        $zip.Dispose()
    }
}

try {
    foreach ($jar in $jars) {
        $relative = $jar.FullName.Substring($inputRoot.Length).TrimStart('\')
        $out = Join-Path $workRoot $relative
        $outDir = Split-Path -Parent $out
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
        $cfg = Join-Path $workRoot ($relative + ".proguard.txt")
        $mapping = Join-Path $workRoot ($relative + ".mapping.txt")
        $discard = Join-Path $workRoot ($relative + ".proguard.jar")
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cfg) | Out-Null
        $rules = $keep.Replace("__MAPPING__", ($mapping -replace '\\','/'))
        [IO.File]::WriteAllText($cfg, $rules, [Text.UTF8Encoding]::new($false))
        $inputPath = ($jar.FullName -replace '\\','/')
        Write-Host "A4 $relative"

        & java -Xmx768m -XX:+UseSerialGC -cp $proguardClasspath proguard.ProGuard "@$($cfg)" "-injars" $inputPath "-outjars" ($discard -replace '\\','/')
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $mapping)) { throw "ProGuard mapping failed for $relative" }
        Remove-Item -LiteralPath $discard -Force -ErrorAction SilentlyContinue

        # Apply the mapping to the untouched original JAR so the original stack map
        # frames (which ProGuard would corrupt on class file version 69) stay valid.
        & java -cp $asmClasspath $remapTool $jar.FullName $mapping $out
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $out)) { throw "ASM remap failed for $relative" }

        $inEntries = Get-JarFileEntries $jar.FullName
        $outEntries = Get-JarFileEntries $out
        if ($inEntries.Count -ne $outEntries.Count) {
            throw "Entry count changed for $relative ($($inEntries.Count) -> $($outEntries.Count))"
        }
        if ($outEntries -notcontains 'statusmod-build.txt') { throw "statusmod-build.txt lost in $relative" }
    }

    # Replace dist artifacts only after all 24 runs succeeded.
    # Originals were already copied to the backup directory before processing.
    foreach ($jar in $jars) {
        $relative = $jar.FullName.Substring($inputRoot.Length).TrimStart('\')
        Copy-Item -LiteralPath (Join-Path $workRoot $relative) -Destination $jar.FullName -Force
    }

    & $stampScript -OutputDir $inputRoot
    if ($LASTEXITCODE -ne 0) { throw "Fingerprint stamping failed" }

    if (-not [string]::IsNullOrWhiteSpace($MirrorDir)) {
        $mirrorPath = if ([IO.Path]::IsPathRooted($MirrorDir)) { $MirrorDir } else { Join-Path $root $MirrorDir }
        $mirrorRoot = (Resolve-Path $mirrorPath -ErrorAction Stop).Path
        foreach ($jar in $jars) {
            $relative = $jar.FullName.Substring($inputRoot.Length).TrimStart('\')
            $mirror = Join-Path $mirrorRoot $relative
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $mirror) | Out-Null
            Copy-Item -LiteralPath $jar.FullName -Destination $mirror -Force
        }
    }

    Write-Host "A4 complete: $($jars.Count) JARs. Backup: $backupRoot"
} finally {
    if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
