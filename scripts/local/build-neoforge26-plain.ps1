# Plain-javac NeoForge build for unobfuscated MC 26.x (no Loom, no mappings needed).
# Compiles common/ + neoforge/ sources (Mojang names) against the vanilla 26.x jar
# + NeoForge universal jar and packages a runtime-ready jar (NOT remapped).
param(
    [string]$McVersion = "26.2",
    [string]$ModVersion = "",
    [string]$NeoForgeVersion = "",
    [string]$JavaHome = "",
    [string]$OutRoot = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ([string]::IsNullOrWhiteSpace($ModVersion)) { $ModVersion = (Get-Content (Join-Path $root "version.txt") -Raw).Trim() }
if ([string]::IsNullOrWhiteSpace($OutRoot)) { $OutRoot = Join-Path $root "dist/multiversion/neoforge" }
# Exact vanilla lib versions per MC (compile-only; newest cached is fallback).
$McLibMap = @{
    "26.2" = @{ gson = "2.14.0"; authlib = "9.0.75"; brigadier = "1.3.10" }
}

if ([string]::IsNullOrWhiteSpace($JavaHome)) {
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_25_HOME) -and (Test-Path -LiteralPath (Join-Path $env:JAVA_25_HOME "bin\javac.exe"))) {
        $JavaHome = $env:JAVA_25_HOME
    } else {
        $cand = Get-ChildItem "C:\Program Files\Java" -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "^jdk-25" } | Sort-Object Name -Descending | Select-Object -First 1
        if (-not $cand) { throw "No JDK 25 found (pass -JavaHome)" }
        $JavaHome = $cand.FullName
    }
}
$javac = Join-Path $JavaHome "bin\javac.exe"
$jarTool = Join-Path $JavaHome "bin\jar.exe"
if (-not (Test-Path $javac)) { throw "javac not found: $javac" }

$gradleCache = Join-Path $env:USERPROFILE ".gradle\caches\modules-2\files-2.1"
$libDir = Join-Path $root ".plain-libs"
New-Item -ItemType Directory -Force -Path $libDir | Out-Null

function Test-DirExists([string]$p) { return [System.IO.Directory]::Exists($p) }
function Test-FileExists([string]$p) { return [System.IO.File]::Exists($p) }
# Downloads mit Retry: CI-Egress ist flaky (vereinzelte 404/Timeouts bei ~130 Dateien).
function Invoke-DownloadWithRetry([string]$url, [string]$dst, [int]$timeoutSec = 300, [int]$tries = 4) {
    for ($i = 1; $i -le $tries; $i++) {
        try {
            $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
            if ($curl) {
                & curl.exe -fsSL --retry 0 --max-time $timeoutSec -o $dst $url 2>$null
                if (($LASTEXITCODE -eq 0) -and (Test-FileExists $dst)) { return }
                throw "curl exit $LASTEXITCODE"
            }
            Invoke-WebRequest -NoProxy $url -OutFile $dst -TimeoutSec $timeoutSec
            if (Test-FileExists $dst) { return }
            throw "download produced no file"
        } catch {
            if ($i -eq $tries) { throw }
            Start-Sleep -Seconds (5 * $i)
        }
    }
}

function Get-CachedJar([string]$subPath, [string]$version) {
    $base = Join-Path $gradleCache $subPath
    $dir = $null
    if (-not [string]::IsNullOrWhiteSpace($version)) {
        $d = Join-Path $base $version
        if (Test-DirExists $d) { $dir = $d }
    }
    if (-not $dir) {
        $dir = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($dir) { $dir = $dir.FullName } else { return $null }
    }
    $j = Get-ChildItem -LiteralPath $dir -Recurse -File -Filter "*.jar" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike "*sources*" -and $_.Name -notlike "*javadoc*" } | Select-Object -First 1
    if ($j) { return $j.FullName } else { return $null }
}

function Get-MavenJar([string]$repo, [string]$groupPath, [string]$artifact, [string]$version, [switch]$NoCache) {
    # NOTE: groupPath must already include the artifact directory.
    $local = $null
    if (-not $NoCache) { $local = Get-CachedJar $groupPath $version }
    if ($local) { return $local }
    $file = "$artifact-$version.jar"
    # groupPath ist Cache-Layout ("a.b.c\artifact"): Gruppe zu Maven-Pfad wandeln.
    # artDir (letztes Segment) IST bereits das artifact-Verzeichnis -> nicht doppelt anhaengen.
    $gp = $groupPath.Replace('\','/')
    $sep = $gp.LastIndexOf('/')
    if ($sep -ge 0) { $groupUrl = $gp.Substring(0,$sep).Replace('.','/'); $artDir = $gp.Substring($sep+1) } else { $groupUrl = $gp.Replace('.','/'); $artDir = $artifact }
    # + als %2B: manche Egress-Proxies dekodieren + im Pfad zu Leerzeichen (404).
    $versionEsc = $version.Replace('+','%2B')
    $url = "$repo/$groupUrl/$artDir/$versionEsc/$artifact-$versionEsc.jar"
    $dst = Join-Path $libDir "$artifact-$version.jar"
    if (-not (Test-FileExists $dst)) {
        Write-Host "Downloading $artifact $version ..."
        Invoke-DownloadWithRetry $url $dst 300
    }
    return $dst
}

function Test-MojangNamedJar([string]$path) {
    # True, wenn das Jar Mojang-benannte MC-Klassen enthält. Schützt vor
    # Loom-Cache-Kontamination (anderer Loader legte intermediary/SRG-jar ab).
    if (-not (Test-FileExists $path)) { return $false }
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $z = $null
    try {
        $z = [System.IO.Compression.ZipFile]::OpenRead($path)
        return (@($z.Entries | Where-Object { $_.FullName -eq "net/minecraft/commands/CommandSourceStack.class" }).Count -gt 0)
    } catch { return $false }
    finally { if ($z) { $z.Dispose() } }
}

function Resolve-BundledServerJar([string]$bundleJar, [string]$mcVersion) {
    # Mojangs server.jar ist ein Bundler: die echten Klassen liegen in
    # META-INF/versions/<mc>/server-<mc>.jar (26.x bereits Mojang-benannt).
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $probe = "net/minecraft/server/MinecraftServer.class"
    $z = [System.IO.Compression.ZipFile]::OpenRead($bundleJar)
    try {
        $top = @($z.Entries | Where-Object { $_.FullName -eq $probe }).Count
        if ($top -gt 0) { return $bundleJar }
        $inner = $z.Entries | Where-Object { $_.FullName -like "META-INF/versions/*/server-*.jar" } | Select-Object -First 1
        if (-not $inner) { throw "kein Bundler-Inhalt in $bundleJar" }
        $dst = Join-Path $libDir "minecraft-server-inner-$mcVersion.jar"
        $needExtract = $true
        if (Test-FileExists $dst) {
            $zi = [System.IO.Compression.ZipFile]::OpenRead($dst)
            try { $needExtract = (@($zi.Entries | Where-Object { $_.FullName -eq "net/minecraft/commands/CommandSourceStack.class" }).Count -eq 0) }
            finally { $zi.Dispose() }
        }
        if ($needExtract) {
            Write-Host "Extracting bundled server jar ($($inner.FullName)) ..."
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($inner, $dst, $true)
        }
        $zi = [System.IO.Compression.ZipFile]::OpenRead($dst)
        try {
            $ok = (@($zi.Entries | Where-Object { $_.FullName -eq "net/minecraft/commands/CommandSourceStack.class" }).Count -gt 0)
            if (-not $ok) { throw "MC $mcVersion braucht Mappings/Remap - Vanilla-Jar ist obfuskiert" }
        } finally { $zi.Dispose() }
        return $dst
    } finally {
        $z.Dispose()
    }
}

# 1. Minecraft jar: loom deobf cache first, else vanilla server jar (unobfuscated).
$mcLibDir = Join-Path $libDir "mc-$McVersion"
New-Item -ItemType Directory -Force -Path $mcLibDir | Out-Null
$pkgFile = Join-Path $libDir "mc-$McVersion-package.json"
if (-not (Test-FileExists $pkgFile)) {
    $manifest = Invoke-RestMethod -NoProxy "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json" -TimeoutSec 60
    $entry = @($manifest.versions | Where-Object { $_.id -eq $McVersion })[0]
    if (-not $entry) { throw "MC $McVersion not in Mojang manifest" }
    Invoke-DownloadWithRetry $entry.url $pkgFile 60
}
$pkg = Get-Content -LiteralPath $pkgFile -Raw | ConvertFrom-Json
$mcLibCount = 0
$cpJars = @()
foreach ($lib in $pkg.libraries) {
    if (-not $lib.downloads -or -not $lib.downloads.artifact) { continue }
    $u = $lib.downloads.artifact.url
    if ([string]::IsNullOrWhiteSpace($u)) { continue }
    $fname = [System.IO.Path]::GetFileName($u)
    if ($fname -notlike "*.jar") { continue }
    $dst = Join-Path $mcLibDir $fname
    if (-not (Test-FileExists $dst)) {
        Write-Host "Downloading MC lib $fname ..."
        Invoke-DownloadWithRetry $u $dst 300
    }
    $cpJars += $dst
    $mcLibCount++
}
Write-Host "MC libraries: $mcLibCount"
$mcJar = Join-Path $env:USERPROFILE ".gradle\caches\fabric-loom\minecraftMaven\net\minecraft\minecraft-merged-deobf\$McVersion\minecraft-merged-deobf-$McVersion.jar"
if ((-not (Test-FileExists $mcJar)) -or (-not (Test-MojangNamedJar $mcJar))) {
    if ((Test-FileExists $mcJar)) { Write-Host "Loom deobf jar ist nicht Mojang-benannt, ignoriere Cache: $mcJar" }
    $mcJar = Join-Path $env:USERPROFILE ".gradle\caches\fabric-loom\$McVersion\minecraft-merged.jar"
}
if ((-not (Test-FileExists $mcJar)) -or (-not (Test-MojangNamedJar $mcJar))) {
    if ((Test-FileExists $mcJar)) { Write-Host "Loom merged jar ist nicht Mojang-benannt, ignoriere Cache: $mcJar" }
    $mcJar = Join-Path $libDir "minecraft-server-$McVersion.jar"
    if (-not (Test-Path $mcJar)) {
        Write-Host "MC jar not cached, downloading vanilla server $McVersion ..."
        $manifest = Invoke-RestMethod -NoProxy "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json" -TimeoutSec 60
        $entry = @($manifest.versions | Where-Object { $_.id -eq $McVersion })[0]
        if (-not $entry) { throw "MC $McVersion not in Mojang manifest" }
        $pkg = Invoke-RestMethod -NoProxy $entry.url -TimeoutSec 60
        Invoke-DownloadWithRetry $pkg.downloads.server.url $mcJar 300
    }
    $mcJar = Resolve-BundledServerJar $mcJar $McVersion
}
Write-Host "MC: $mcJar"
$cpJars += $mcJar

# Client-JAR: das Server-JAR enthaelt keine Client-Klassen (net.minecraft.client.*,
# com.mojang.blaze3d.*). Die common-Quellen enthalten aber Client-Code
# (StatusMenuKeybind, ClientRuntime). Nur MC 26.x liefert ein Mojang-benanntes
# Client-JAR (keine Obfuskation) - dieser Pfad wird nur fuer 26.x benutzt.
# Server-JAR bleibt zuerst auf dem Classpath, das Client-JAR ergaenzt nur.
$mcClientJar = Join-Path $libDir "minecraft-client-$McVersion.jar"
if (-not (Test-FileExists $mcClientJar)) {
    if ([string]::IsNullOrWhiteSpace($pkg.downloads.client.url)) { throw "MC ${McVersion}: Version-JSON ohne Client-Download" }
    Write-Host "Downloading vanilla client $McVersion ..."
    Invoke-DownloadWithRetry $pkg.downloads.client.url $mcClientJar 600
}
$ziClient = [System.IO.Compression.ZipFile]::OpenRead($mcClientJar)
try {
    $hasClient = (@($ziClient.Entries | Where-Object { $_.FullName -eq "net/minecraft/client/Minecraft.class" }).Count -gt 0)
} finally {
    $ziClient.Dispose()
}
if (-not $hasClient) { throw "Client-JAR $McVersion ist nicht Mojang-benannt (net/minecraft/client/Minecraft.class fehlt)" }
$cpJars += $mcClientJar
Write-Host "MC client: $mcClientJar"

# 2. NeoForge universal jar (Mojang-named for 26.x).
$NeoMap = @{
    "26.1"   = "26.1.0.19-beta"
    "26.1.1" = "26.1.1.15-beta"
    "26.1.2" = "26.1.2.114"
    "26.2"   = "26.2.0.88"
    "26.3"   = "26.3.0.48-beta"
}
if ([string]::IsNullOrWhiteSpace($NeoForgeVersion)) {
    if (-not $NeoMap.ContainsKey($McVersion)) { throw "No NeoForge mapping for MC $McVersion (pass -NeoForgeVersion)" }
    $NeoForgeVersion = $NeoMap[$McVersion]
}
$neoJar = Join-Path $libDir "neoforge-$NeoForgeVersion-universal.jar"
if (-not (Test-FileExists $neoJar)) {
    Write-Host "Downloading NeoForge $NeoForgeVersion ..."
    Invoke-DownloadWithRetry "https://maven.neoforged.net/releases/net/neoforged/neoforge/$NeoForgeVersion/neoforge-$NeoForgeVersion-universal.jar" $neoJar 600
}
Write-Host "NeoForge: $neoJar"
$cpJars += $neoJar
# Event bus + FML launcher (compile-only; API stable across 26.x).
$busJar = Join-Path $libDir "bus-8.0.5.jar"
if (-not (Test-FileExists $busJar)) {
    Invoke-DownloadWithRetry "https://maven.neoforged.net/releases/net/neoforged/bus/8.0.5/bus-8.0.5.jar" $busJar 300
}
$cpJars += $busJar
$fmlJar = Join-Path $libDir "fml-loader-11.0.16.jar"
if (-not (Test-FileExists $fmlJar)) {
    Invoke-DownloadWithRetry "https://maven.neoforged.net/releases/net/neoforged/fancymodloader/loader/11.0.16/loader-11.0.16.jar" $fmlJar 300
}
$cpJars += $fmlJar
# Distmarker-API (net.neoforged.api.distmarker.Dist) liegt in KEINEM der Laufzeit-Jars
# (weder universal noch fml-loader). NeoForge nutzt dafuer das mergetool-*-api.jar
# (enthalt nur Annotationen/Enums, compile-only). Ohne dieses Jar scheitert der
# NeoForge-Plain-Build an StatusModNeoForgeClient (import ...Dist).
$distJar = Join-Path $libDir "mergetool-2.0.0-api.jar"
if (-not (Test-FileExists $distJar)) {
    Invoke-DownloadWithRetry "https://maven.neoforged.net/releases/net/neoforged/mergetool/2.0.0/mergetool-2.0.0-api.jar" $distJar 300
}
$cpJars += $distJar

# 3. Vanilla libs.
$pins = $null
if ($McLibMap.ContainsKey($McVersion)) { $pins = $McLibMap[$McVersion] }
$gsonV = if ($pins) { $pins.gson } else { "" }
$authV = if ($pins) { $pins.authlib } else { "" }
$brigV = if ($pins) { $pins.brigadier } else { "" }
$g = Get-CachedJar "com.google.code.gson\gson" $gsonV
if (-not $g) { $g = Get-MavenJar "https://repo1.maven.org/maven2" "com.google.code.gson\gson" "gson" "2.14.0" }
$cpJars += $g
$a = Get-CachedJar "com.mojang\authlib" $authV
if (-not $a) { $a = Get-MavenJar "https://libraries.minecraft.net" "com.mojang\authlib" "authlib" "9.0.75" }
$cpJars += $a
$b = Get-CachedJar "com.mojang\brigadier" $brigV
if (-not $b) { $b = Get-MavenJar "https://libraries.minecraft.net" "com.mojang\brigadier" "brigadier" "1.3.10" }
$cpJars += $b
# Nullability annotations referenced by MC signatures (compile-only).
$jb = Get-CachedJar "org.jetbrains\annotations" ""
if ($jb) { $cpJars += $jb }
$js = Get-CachedJar "com.google.code.findbugs\jsr305" ""
if ($js) { $cpJars += $js }
# JSpecify (org.jspecify.annotations.Nullable) - used by MC 26.x signatures.
$jsp = Get-CachedJar "org.jspecify\jspecify" ""
if (-not $jsp) { $jsp = Get-MavenJar "https://repo1.maven.org/maven2" "org.jspecify\jspecify" "jspecify" "1.0.0" }
$cpJars += $jsp
# Lenient JSpecify shim (compile-only, FIRST on cp): Mojang 26.x bytecode carries
# @Nullable in FIELD/METHOD declaration position (ECJ style), but real jspecify
# 1.0.0 is TYPE_USE-only -> javac would fail with "cannot be attached".
# The shim has broadened @Targets; it is never packaged (annotations only).
$lenientJar = Join-Path $libDir "jspecify-lenient.jar"
if (-not (Test-FileExists $lenientJar)) {
    $lsrc = Join-Path $libDir "jspecify-lenient-src\org\jspecify\annotations"
    New-Item -ItemType Directory -Force -Path $lsrc | Out-Null
    foreach ($ann in @("Nullable", "NonNull")) {
        Set-Content -LiteralPath (Join-Path $lsrc "$ann.java") -Value @"
package org.jspecify.annotations;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
@Documented
@Target({ElementType.TYPE_USE, ElementType.METHOD, ElementType.FIELD, ElementType.PARAMETER, ElementType.LOCAL_VARIABLE, ElementType.TYPE, ElementType.PACKAGE})
@Retention(RetentionPolicy.RUNTIME)
public @interface $ann {}
"@
    }
    foreach ($ann in @("NullMarked", "NullUnmarked")) {
        Set-Content -LiteralPath (Join-Path $lsrc "$ann.java") -Value @"
package org.jspecify.annotations;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
@Documented
@Target({ElementType.TYPE_USE, ElementType.METHOD, ElementType.FIELD, ElementType.PARAMETER, ElementType.LOCAL_VARIABLE, ElementType.TYPE, ElementType.PACKAGE, ElementType.MODULE, ElementType.CONSTRUCTOR})
@Retention(RetentionPolicy.RUNTIME)
public @interface $ann {}
"@
    }
    $lcls = Join-Path $libDir "jspecify-lenient-classes"
    if (Test-Path $lcls) { Remove-Item $lcls -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $lcls | Out-Null
    & $javac -d $lcls (Join-Path $lsrc "*.java")
    if ($LASTEXITCODE -ne 0) { throw "lenient jspecify compile failed" }
    Push-Location $lcls
    & $jarTool --create --file $lenientJar .
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw "lenient jspecify jar failed" }
}
$cp = ($cpJars | Select-Object -Unique) -join ";"
$cp = "$lenientJar;" + $cp
Write-Host "Classpath entries: $(@($cpJars | Select-Object -Unique).Count)"

# 4. Compile.
$work = Join-Path ([System.IO.Path]::GetTempPath()) "statusmod-plain-neoforge-$McVersion"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$cls = Join-Path $work "classes"; New-Item -ItemType Directory -Force -Path $cls | Out-Null
$srcList = Join-Path $work "sources.txt"
$srcs = @()
foreach ($s in @("common\src\main\java", "neoforge\src\main\java")) {
    $d = Join-Path $root $s
    if (Test-Path $d) { $srcs += @(Get-ChildItem $d -Recurse -File -Filter "*.java" | ForEach-Object { $_.FullName }) }
}
if ($srcs.Count -eq 0) { throw "No sources found" }
Set-Content -LiteralPath $srcList -Value $srcs
Write-Host "Compiling $($srcs.Count) sources (JDK $JavaHome) ..."
& $javac -encoding UTF-8 -nowarn -cp $cp -d $cls "@$srcList"
if ($LASTEXITCODE -ne 0) { throw "javac failed (exit $LASTEXITCODE)" }

# 5. Resources (neoforge.mods.toml expanded).
foreach ($r in @("common\src\main\resources", "neoforge\src\main\resources")) {
    $d = Join-Path $root $r
    if (Test-Path $d) {
        Get-ChildItem $d -Recurse -File | Where-Object { $_.Name -ne "neoforge.mods.toml" } | ForEach-Object {
            $rel = $_.FullName.Substring($d.Length + 1)
            $dst = Join-Path $cls $rel
            New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
            Copy-Item $_.FullName $dst -Force
        }
    }
}
$toml = (Get-Content (Join-Path $root "neoforge\src\main\resources\META-INF\neoforge.mods.toml") -Raw) `
    -replace '\$\{version\}', $ModVersion
$tomlDir = Join-Path $cls "META-INF"
New-Item -ItemType Directory -Force -Path $tomlDir | Out-Null
[System.IO.File]::WriteAllText((Join-Path $tomlDir "neoforge.mods.toml"), $toml)

# 6. Gate: no intermediary names in bytecode.
$bad = $false
$latin1 = [System.Text.Encoding]::GetEncoding("ISO-8859-1")
Get-ChildItem -LiteralPath $cls -Recurse -File -Filter "*.class" | ForEach-Object {
    $b = [System.IO.File]::ReadAllBytes($_.FullName)
    $t = $latin1.GetString($b)
    if ($t -match "net/minecraft/class_") { Write-Host "INTERMEDIARY: $($_.Name)"; $bad = $true }
}
if ($bad) { throw "Intermediary refs found - refusing to package" }
Write-Host "Mapping gate passed (no net/minecraft/class_* refs)."

# 7. Package.
$outDir = $OutRoot; New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "Statusmod-$ModVersion-neoforge-$McVersion.jar"
if (Test-Path $out) { Remove-Item $out -Force }
Push-Location $cls
& $jarTool --create --file $out .
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "jar failed" }
$h = (Get-FileHash $out -Algorithm SHA256).Hash.Substring(0, 12)
Write-Host "OK: $out (sha12=$h)"
