param(
    [string[]]$Loaders = @("fabric", "forge", "neoforge", "quilt", "datapack"),
    [string]$MatrixPath = "scripts/local/mc-matrix-26.json",
    [string]$PackFormatMapPath = "scripts/local/pack-format.json",
    [string]$LoaderVersionsPath = "scripts/local/loader-versions.json",
    [string]$OutputDir = "dist/multiversion",
    [string]$FabricMaxVersion = "1.21.11",
    [string]$FabricMinVersion = "1.21.11",
    [string[]]$FabricExtraVersions = @("26.3", "26.2", "26.1", "26.1.1", "26.1.2"),
    [string]$FabricJavaHome = "C:\Program Files\Java\jdk-21",
    [string]$FabricJava25Home = "C:\Program Files\Java\jdk-25.0.3",
    [string]$Fabric26ModuleRoot = "Loader/fabric26.1",
    [string]$Forge26ModuleRoot = "Loader/forge26.1",
    [string]$LogDir = "",
    [switch]$UseIsolatedGradleHome,
    [switch]$DryRun,
    [switch]$ContinueOnError
)

$UseIsolatedGradleHome = if ($PSBoundParameters.ContainsKey('UseIsolatedGradleHome')) { [bool]$UseIsolatedGradleHome } else { $true }
$ContinueOnError = if ($PSBoundParameters.ContainsKey('ContinueOnError')) { [bool]$ContinueOnError } else { $true }

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-FabricApiVersionsFromMaven {
    param([string]$MavenBase = "https://maven.fabricmc.net")
    $url = "$MavenBase/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml"
    try {
        $xmlText = (Invoke-WebRequest -NoProxy -Uri $url -UseBasicParsing -TimeoutSec 30).Content
        if ([string]::IsNullOrWhiteSpace($xmlText)) { return @() }
        [xml]$doc = $xmlText
        $versions = @($doc.metadata.versioning.versions.version | ForEach-Object { [string]$_ })
        # metadata is typically sorted ascending
        return $versions
    } catch {
        return @()
    }
}

function Get-McVersionParts {
    param([string]$Mc)
    if ([string]::IsNullOrWhiteSpace($Mc)) { return $null }
    $m = [regex]::Match($Mc.Trim(), '^(\d+)\.(\d+)(?:\.(\d+))?$')
    if (-not $m.Success) { return $null }
    $maj = [int]$m.Groups[1].Value
    $min = [int]$m.Groups[2].Value
    $pat = if ($m.Groups[3].Success) { [int]$m.Groups[3].Value } else { 0 }
    return @($maj, $min, $pat)
}

function Get-McVersionKey {
    param([string]$Mc)
    $parts = Get-McVersionParts -Mc $Mc
    if ($null -eq $parts) { return $null }
    return ($parts[0] * 1000000) + ($parts[1] * 1000) + $parts[2]
}

function Compare-McVersion {
    param([string]$A, [string]$B)
    $a = Get-McVersionParts -Mc $A
    $b = Get-McVersionParts -Mc $B
    if ($null -eq $a -or $null -eq $b) { return $null }
    if ($a[0] -ne $b[0]) { return [Math]::Sign($a[0] - $b[0]) }
    if ($a[1] -ne $b[1]) { return [Math]::Sign($a[1] - $b[1]) }
    if ($a[2] -ne $b[2]) { return [Math]::Sign($a[2] - $b[2]) }
    return 0
}

function Test-IsBaseRelease {
    param([string]$Mc)
    return ($Mc -match '^\d+\.\d+$')
}

function Get-PackFormatForMinecraft {
    param([string]$MinecraftVersion, [object[]]$PackFormatRanges)
    if ([string]::IsNullOrWhiteSpace($MinecraftVersion)) { return $null }
    $mcKey = Get-McVersionKey -Mc $MinecraftVersion
    if ($null -eq $mcKey) { return $null }
    foreach ($entry in @($PackFormatRanges)) {
        if ($null -eq $entry) { continue }
        $min = [string]$entry.min
        $max = [string]$entry.max
        $pf = $entry.pack_format
        if ([string]::IsNullOrWhiteSpace($min) -or [string]::IsNullOrWhiteSpace($max)) { continue }
        $minKey = Get-McVersionKey -Mc $min
        $maxKey = Get-McVersionKey -Mc $max
        if ($null -eq $minKey -or $null -eq $maxKey) { continue }
        if ($mcKey -lt $minKey) { continue }
        if ($mcKey -gt $maxKey) { continue }
        return $pf
    }
    return $null
}

function Select-FabricApiCandidates {
    param(
        [string]$MinecraftVersion,
        [string[]]$ProvidedCandidates,
        [string[]]$AllFabricApiVersions
    )

    $out = New-Object System.Collections.Generic.List[string]
    foreach ($c in @($ProvidedCandidates)) {
        if (-not [string]::IsNullOrWhiteSpace($c)) { $out.Add($c.Trim()) | Out-Null }
    }

    if (-not $AllFabricApiVersions -or $AllFabricApiVersions.Count -eq 0) {
        return @($out | Select-Object -Unique)
    }

    $mc = if ($null -eq $MinecraftVersion) { "" } else { [string]$MinecraftVersion }
    $mc = $mc.Trim()
    if ([string]::IsNullOrWhiteSpace($mc)) {
        return @($out | Select-Object -Unique)
    }

    $exact = @($AllFabricApiVersions | Where-Object { $_ -like "*+$mc" })
    foreach ($v in ($exact | Sort-Object -Descending | Select-Object -First 12)) {
        $out.Add($v) | Out-Null
    }

    # Fallback: pick newest within same minor (e.g. 1.21.*) if exact doesn't exist.
    if ($exact.Count -eq 0) {
        $mcParts = Get-McVersionParts -Mc $mc
        if ($null -ne $mcParts) {
            $minorPrefix = "$($mcParts[0]).$($mcParts[1])."
            $escapedMinor = [Regex]::Escape($minorPrefix)
            $withinMinor = @($AllFabricApiVersions | Where-Object { $_ -match ("\+" + $escapedMinor + "\d+$") })
            if ($withinMinor.Count -gt 0) {
                $best = $withinMinor[-1] # newest (metadata asc) => last
                $out.Add($best) | Out-Null
            }
        }
    }

    return @($out | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function Test-LoaderAvailable {
    param([string]$Root, [string]$Loader)
    $moduleRoot = Resolve-LoaderModuleRoot -Root $Root -Loader $Loader
    if ([string]::IsNullOrWhiteSpace($moduleRoot)) {
        return $false
    }
    switch ($Loader) {
        "fabric" {
            return (Test-Path (Join-Path $moduleRoot "build.gradle")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/fabric.mod.json")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/quilt.mod.json"))
        }
        "forge" {
            return (Test-Path (Join-Path $moduleRoot "build.gradle")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/META-INF/mods.toml")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/META-INF/neoforge.mods.toml"))
        }
        "neoforge" {
            return (Test-Path (Join-Path $moduleRoot "build.gradle")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/META-INF/neoforge.mods.toml")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/META-INF/mods.toml"))
        }
        "quilt" {
            return (Test-Path (Join-Path $moduleRoot "build.gradle")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/quilt.mod.json")) -or
                   (Test-Path (Join-Path $moduleRoot "src/main/resources/fabric.mod.json"))
        }
        "datapack" {
            return (Test-Path (Join-Path $Root "Loader\datapack")) -or
                   (Test-Path (Join-Path $Root "datapack"))
        }
        default {
            return $false
        }
    }
}

function Resolve-LoaderModuleRoot {
    param([string]$Root, [string]$Loader)
    foreach ($candidate in @(
        (Join-Path $Root ("Loader\" + $Loader)),
        (Join-Path $Root $Loader)
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    return ""
}

function Write-TextFileWithRetry {
    param(
        [string]$Path,
        [string]$Content,
        [int]$Attempts = 10
    )
    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            Set-Content -LiteralPath $Path -Value $Content -NoNewline
            return
        } catch {
            if ($i -eq $Attempts) { throw }
            Start-Sleep -Milliseconds (150 * $i)
        }
    }
}

function Copy-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path $Source)) {
        return
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Invoke-GradleBuild {
    param(
        [string]$GradleExecutable,
        [string]$ProjectDir,
        [string]$JavaHome,
        [string]$Arguments,
        [string]$LogFile
    )
    if ([string]::IsNullOrWhiteSpace($JavaHome) -or -not (Test-Path -LiteralPath $JavaHome)) {
        throw "Java home not found: $JavaHome"
    }

    $previousJavaHome = [Environment]::GetEnvironmentVariable("JAVA_HOME", "Process")
    $previousPath = [Environment]::GetEnvironmentVariable("Path", "Process")
    try {
        [Environment]::SetEnvironmentVariable("JAVA_HOME", $JavaHome, "Process")
        [Environment]::SetEnvironmentVariable("Path", (Join-Path $JavaHome "bin") + ";" + $previousPath, "Process")
        $cmdLine = '""' + $GradleExecutable + '" -p "' + $ProjectDir + '" ' + $Arguments + '"'
        cmd /c $cmdLine 2>&1 | Tee-Object -FilePath $LogFile
    } finally {
        [Environment]::SetEnvironmentVariable("JAVA_HOME", $previousJavaHome, "Process")
        [Environment]::SetEnvironmentVariable("Path", $previousPath, "Process")
    }
}

function Resolve-FirstExistingPath {
    param([string[]]$Candidates)
    foreach ($candidate in @($Candidates)) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }

        if ($candidate -match '[\*\?\[]') {
            $matches = @(Get-ChildItem -Path $candidate -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1)
            if ($matches.Count -gt 0) {
                return $matches[0]
            }
        }
    }
    return $null
}

function Set-GradlePropertyValue {
    param(
        [string]$FilePath,
        [string]$Key,
        [string]$Value
    )
    $raw = Get-Content -LiteralPath $FilePath -Raw
    $pattern = "(?m)^$([Regex]::Escape($Key))=.*$"
    if ($raw -match $pattern) {
        $raw = [Regex]::Replace($raw, $pattern, "$Key=$Value")
    } else {
        if (-not $raw.EndsWith("`n")) {
            $raw += "`r`n"
        }
        $raw += "$Key=$Value`r`n"
    }
    Write-TextFileWithRetry -Path $FilePath -Content $raw
}

function Expand-MetadataVersion {
    param(
        [string]$RootDir,
        [string]$ModVersion
    )
    $tomlFiles = @(
        (Join-Path $RootDir "src/main/resources/META-INF/mods.toml"),
        (Join-Path $RootDir "src/main/resources/META-INF/neoforge.mods.toml")
    )
    $backups = @()
    foreach ($f in $tomlFiles) {
        if (Test-Path -LiteralPath $f) {
            $bak = "$f.bak"
            Copy-Item -LiteralPath $f -Destination $bak -Force
            $content = Get-Content -LiteralPath $f -Raw
            $content = $content.Replace('${version}', $ModVersion)
            Write-TextFileWithRetry -Path $f -Content $content
            $backups += $f
        }
    }
    return $backups
}

function Restore-MetadataVersion {
    param([string[]]$BackupFiles)
    foreach ($f in $BackupFiles) {
        $bak = "$f.bak"
        if (Test-Path -LiteralPath $bak) {
            Copy-Item -LiteralPath $bak -Destination $f -Force
            Remove-Item -LiteralPath $bak -Force
        }
    }
}

function ConvertTo-MarkdownTableValue {
    param([string]$Value)
    if ($null -eq $Value) { return "" }
    return $Value.Replace("\", "\\").Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
}

function Write-MarkdownBuildReport {
    param(
        $ReportPath,
        $Results,
        $LogRoot,
        $JsonReportPath,
        $ModVersion,
        $DryRun
    )

    $lines = New-Object System.Collections.ArrayList
    $lines.Add("# StatusMod Build Report") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("- Generated: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))") | Out-Null
    $lines.Add("- Mod version: $ModVersion") | Out-Null
    $lines.Add("- JSON report: ``$JsonReportPath``") | Out-Null
    $lines.Add("- Log directory: ``$LogRoot``") | Out-Null
    $lines.Add("- Dry run: $([bool]$DryRun)") | Out-Null
    $lines.Add("") | Out-Null

    $lines.Add("## Results") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("| Loader | Minecraft | Status | Note | Artifact |") | Out-Null
    $lines.Add("| --- | --- | --- | --- | --- |") | Out-Null
    foreach ($result in @($Results)) {
        $lines.Add("| $(ConvertTo-MarkdownTableValue ([string]$result.loader)) | $(ConvertTo-MarkdownTableValue ([string]$result.minecraft)) | $(ConvertTo-MarkdownTableValue ([string]$result.status)) | $(ConvertTo-MarkdownTableValue ([string]$result.note)) | $(ConvertTo-MarkdownTableValue ([string]$result.artifact)) |") | Out-Null
    }
    $lines.Add("") | Out-Null

    $logPaths = New-Object System.Collections.Generic.List[string]
    foreach ($result in @($Results)) {
        $note = [string]$result.note
        foreach ($match in [regex]::Matches($note, 'log=([^;]+)|\(log:\s*([^)]+)\)')) {
            $candidate = if (-not [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) {
                $match.Groups[1].Value.Trim()
            } else {
                $match.Groups[2].Value.Trim()
            }
            if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
                $logPaths.Add($candidate) | Out-Null
            }
        }
    }
    $logFiles = @($logPaths | Select-Object -Unique | ForEach-Object { Get-Item -LiteralPath $_ } | Sort-Object Name)

    $lines.Add("## Logs") | Out-Null
    $lines.Add("") | Out-Null
    if ($logFiles.Count -eq 0) {
        $lines.Add('No `.log` files were generated.') | Out-Null
    } else {
        foreach ($logFile in $logFiles) {
            $lines.Add("### $($logFile.Name)") | Out-Null
            $lines.Add("") | Out-Null
            $lines.Add("Path: ``$($logFile.FullName)``") | Out-Null
            $lines.Add("") | Out-Null
            $lines.Add('```text') | Out-Null
            try {
                $content = Get-Content -LiteralPath $logFile.FullName -Raw
                if ([string]::IsNullOrWhiteSpace($content)) {
                    $lines.Add("<empty log>") | Out-Null
                } else {
                    $content.TrimEnd([char[]]"`r`n").Split("`n") | ForEach-Object {
                        $lines.Add($_.TrimEnd([char[]]"`r")) | Out-Null
                    }
                }
            } catch {
                $lines.Add("Failed to read log: $($_.Exception.Message)") | Out-Null
            }
            $lines.Add('```') | Out-Null
            $lines.Add("") | Out-Null
        }
    }

    Write-TextFileWithRetry -Path $ReportPath -Content (((@($lines) | ForEach-Object { [string]$_ }) -join "`r`n") + "`r`n")
}

$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$gradlew = Join-Path $root "gradlew.bat"
$gradleProps = Join-Path $root "gradle.properties"
$matrixFile = Join-Path $root $MatrixPath
$packFormatFile = Join-Path $root $PackFormatMapPath
$loaderVersionsFile = Join-Path $root $LoaderVersionsPath
$outputRoot = Join-Path $root $OutputDir
$reportFile = Join-Path $outputRoot "build-report.json"
$markdownReportFile = Join-Path $outputRoot "build-report.md"
$modVersion = (Get-Content -LiteralPath (Join-Path $root "version.txt") -Raw).Trim()
$logRoot = if ([string]::IsNullOrWhiteSpace($LogDir)) { Join-Path $outputRoot "logs" } else { Join-Path $root $LogDir }
$isolatedGradleHome = Join-Path $outputRoot ".gradle-user-home"

if (-not (Test-Path $matrixFile)) {
    throw "Matrix file not found: $matrixFile"
}
if (-not (Test-Path $packFormatFile)) {
    Write-Host "Warning: pack format mapping not found: $packFormatFile"
}
if (-not (Test-Path $loaderVersionsFile)) {
    Write-Host "Warning: loader versions mapping not found: $loaderVersionsFile"
}
if (-not (Test-Path $gradleProps)) {
    throw "gradle.properties not found: $gradleProps"
}
if (-not (Test-Path $gradlew)) {
    throw "gradlew.bat not found: $gradlew"
}

$matrix = Get-Content -LiteralPath $matrixFile -Raw | ConvertFrom-Json
if (-not $matrix -or $matrix.Count -eq 0) {
    throw "Matrix file is empty: $matrixFile"
}
$packFormatRanges = @()
if (Test-Path $packFormatFile) {
    try {
        $packFormatRanges = Get-Content -LiteralPath $packFormatFile -Raw | ConvertFrom-Json
    } catch {
        Write-Host "Warning: failed to parse pack format mapping: $packFormatFile"
        $packFormatRanges = @()
    }
}
$loaderVersionMap = $null
if (Test-Path $loaderVersionsFile) {
    try {
        $loaderVersionMap = Get-Content -LiteralPath $loaderVersionsFile -Raw | ConvertFrom-Json
    } catch {
        Write-Host "Warning: failed to parse loader versions mapping: $loaderVersionsFile"
        $loaderVersionMap = $null
    }
}

function Get-LoaderVersionConfig {
    param(
        [string]$Loader,
        [string]$MinecraftVersion,
        $Map
    )
    if ($null -eq $Map -or [string]::IsNullOrWhiteSpace($Loader) -or [string]::IsNullOrWhiteSpace($MinecraftVersion)) {
        return $null
    }
    $loaderObj = $Map.$Loader
    if ($null -eq $loaderObj) { return $null }    $prop = $loaderObj.PSObject.Properties | Where-Object { $_.Name -eq $MinecraftVersion } | Select-Object -First 1
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

function Get-CfgValue {
    # StrictMode-sicherer Zugriff auf Loader-Config-Keys (direktes $cfg.xxx
    # wirft bei fehlendem Key statt $null -> Gesamt-Abbruch statt Skip).
    param($Cfg, [string]$Name)
    if ($null -eq $Cfg) { return "" }
    $p = $Cfg.PSObject.Properties[$Name]
    if ($null -eq $p -or $null -eq $p.Value) { return "" }
    return [string]$p.Value
}

function Get-TargetMinecraftVersion {
    param([object]$Entry)
    if ($null -eq $Entry) { return "" }
    $mc = ([string]$Entry.minecraft_version).Trim()
    if ($null -ne $Entry.PSObject.Properties["target_minecraft_version"]) {
        $target = [string]$Entry.target_minecraft_version
        if (-not [string]::IsNullOrWhiteSpace($target)) {
            return $target.Trim()
        }
    }
    if ($mc -match '^26\.') {
        return "1.21.11"
    }
    return $mc
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$originalGradleProps = Get-Content -LiteralPath $gradleProps -Raw
$oldGradleUserHome = [Environment]::GetEnvironmentVariable("GRADLE_USER_HOME", "Process")
$results = New-Object System.Collections.Generic.List[object]
$allFabricApiVersions = @(Get-FabricApiVersionsFromMaven)

try {
    if ($UseIsolatedGradleHome) {
        New-Item -ItemType Directory -Force -Path $isolatedGradleHome | Out-Null
        [Environment]::SetEnvironmentVariable("GRADLE_USER_HOME", $isolatedGradleHome, "Process")
        Write-Host "Using isolated GRADLE_USER_HOME: $isolatedGradleHome"
    }
    $resolvedFabricJavaHome = Resolve-FirstExistingPath -Candidates @($FabricJavaHome, $env:JAVA_HOME, "C:\Program Files\Java\jdk-21", "C:\Program Files\Java\jdk-21.0.0", "C:\Program Files\Eclipse Adoptium\jdk-21*", "C:\Program Files\Microsoft\jdk-21")
    $resolvedFabricJava25Home = Resolve-FirstExistingPath -Candidates @($FabricJava25Home, $env:JAVA_25_HOME, $env:JAVA_HOME, "C:\Program Files\Java\jdk-25", "C:\Program Files\Java\jdk-25.0.3", "C:\Program Files\Java\latest", "C:\Program Files\Eclipse Adoptium\jdk-25*", "C:\Program Files\Microsoft\jdk-25")
    if ([string]::IsNullOrWhiteSpace($resolvedFabricJavaHome)) {
        throw "No usable Java 21 home found for Fabric base versions."
    }
    if ([string]::IsNullOrWhiteSpace($resolvedFabricJava25Home)) {
        throw "No usable Java 25 home found for Fabric 26.1 builds."
    }
    if ($allFabricApiVersions.Count -gt 0) {
        Write-Host "Resolved Fabric API version list from maven.fabricmc.net ($($allFabricApiVersions.Count) entries)."
    } else {
        Write-Host "Warning: could not fetch Fabric API version list; using provided candidates only."
    }

    $normalizedLoaders = @($Loaders | ForEach-Object {
        if ($null -eq $_) { return }
        ([string]$_).Split(",") | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    })

    foreach ($loaderRaw in $normalizedLoaders) {
        $loader = if ($null -eq $loaderRaw) { "" } else { [string]$loaderRaw }
        $loader = $loader.Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($loader)) {
            continue
        }

        if (-not (Test-LoaderAvailable -Root $root -Loader $loader)) {
            Write-Host "[skip] Loader '$loader' is not configured in this repository."
            $results.Add([pscustomobject]@{
                loader = $loader
                minecraft = "-"
                status = "skipped"
                note = "loader not configured in repository"
                artifact = ""
            }) | Out-Null
            continue
        }

        # Clean Loom cache between loaders to prevent cross-contamination.
        # Each Loom variant (Fabric, Forge, NeoForge, Quilt) creates different artifacts
        # in the shared caches/fabric-loom/ directory. When Forge builds first, it leaves
        # SRG-merged JARs that Quilt Loom picks up during MC setup, causing "Failed to
        # remap minecraft". A fresh cache per loader avoids this entirely.
        if ($UseIsolatedGradleHome) {
            $loomCache = Join-Path $isolatedGradleHome "caches\fabric-loom"
            if (Test-Path $loomCache) {
                Remove-Item -LiteralPath $loomCache -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "  Cleaned Loom cache for loader '$loader'"
            }
        }

        if ($loader -eq "datapack") {
            $loaderOut = Join-Path $outputRoot $loader
            New-Item -ItemType Directory -Force -Path $loaderOut | Out-Null

            foreach ($entry in $matrix) {
                $mc = [string]$entry.minecraft_version
                $targetMc = Get-TargetMinecraftVersion -Entry $entry
                $packFormat = Get-PackFormatForMinecraft -MinecraftVersion $mc -PackFormatRanges $packFormatRanges
                if ($null -eq $packFormat -and $targetMc -ne $mc) {
                    $packFormat = Get-PackFormatForMinecraft -MinecraftVersion $targetMc -PackFormatRanges $packFormatRanges
                }
                Write-Host "==> [datapack] Minecraft $mc"

                if ($null -eq $packFormat) {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "skipped"
                        note = "pack_format not mapped"
                        artifact = ""
                    }) | Out-Null
                    continue
                }

                if ($DryRun) {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "dry-run"
                        note = "datapack build skipped by -DryRun; pack_format=$packFormat"
                        artifact = ""
                    }) | Out-Null
                    continue
                }

                $tempDir = Join-Path $outputRoot ".tmp-datapack-$mc"
                if (Test-Path $tempDir) {
                    Remove-Item -LiteralPath $tempDir -Recurse -Force
                }
                New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
                $sourcePack = Join-Path $root "Loader\datapack"
                if (Test-Path $sourcePack) {
                    Copy-Item -Path (Join-Path $sourcePack "*") -Destination $tempDir -Recurse -Force
                }

                $mcmeta = @{
                    pack = @{
                        pack_format = [int]$packFormat
                        description = "StatusMod datapack for MC $mc (v$modVersion)"
                    }
                } | ConvertTo-Json -Depth 4

                Set-Content -LiteralPath (Join-Path $tempDir "pack.mcmeta") -Value $mcmeta -NoNewline

                $artifactName = "statusmod-$modVersion-$loader-$mc.zip"
                $artifactPath = Join-Path $loaderOut $artifactName
                if (Test-Path $artifactPath) {
                    Remove-Item -LiteralPath $artifactPath -Force
                }
                Compress-Archive -Path (Join-Path $tempDir "*") -DestinationPath $artifactPath -Force

                $results.Add([pscustomobject]@{
                    loader = $loader
                    minecraft = $mc
                    status = "ok"
                    note = "pack_format=$packFormat"
                    artifact = $artifactPath
                }) | Out-Null
            }
            continue
        }

        if ($loader -ne "fabric") {
            $moduleRoot = Resolve-LoaderModuleRoot -Root $root -Loader $loader
            $loaderOut = Join-Path $outputRoot $loader
            New-Item -ItemType Directory -Force -Path $loaderOut | Out-Null

            foreach ($entry in $matrix) {
                $mc = [string]$entry.minecraft_version
                $targetMc = Get-TargetMinecraftVersion -Entry $entry
                $yarn = [string]$entry.yarn_mappings
                $cfg = Get-LoaderVersionConfig -Loader $loader -MinecraftVersion $mc -Map $loaderVersionMap
                if ($null -eq $cfg) {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "skipped"
                        note = "missing loader version mapping"
                        artifact = ""
                    }) | Out-Null
                    continue
                }

                if ($loader -eq "forge") {
                    if ([string]::IsNullOrWhiteSpace((Get-CfgValue $cfg "forge_version"))) {
                        $results.Add([pscustomobject]@{
                            loader = $loader
                            minecraft = $mc
                            status = "skipped"
                            note = "forge_version missing"
                            artifact = ""
                        }) | Out-Null
                        continue
                    }
                    # Forge 26.x uses standalone ForgeGradle (Loom can't handle unobfuscated MC 26.x)
                    $mcPartsForForge = Get-McVersionParts -Mc $mc
                    if ($null -ne $mcPartsForForge -and $mcPartsForForge[0] -ge 26) {
                        $forge26Root = Join-Path $root $Forge26ModuleRoot
                        if (-not (Test-Path $forge26Root)) {
                            $results.Add([pscustomobject]@{
                                loader = $loader
                                minecraft = $mc
                                status = "skipped"
                                note = "standalone ForgeGradle project not found: $forge26Root"
                                artifact = ""
                            }) | Out-Null
                            continue
                        }
                        if ($DryRun) {
                            $results.Add([pscustomobject]@{
                                loader = $loader
                                minecraft = $mc
                                status = "dry-run"
                                note = "build skipped by -DryRun (standalone ForgeGradle)"
                                artifact = ""
                            }) | Out-Null
                            continue
                        }
                        $javaToUse = $resolvedFabricJava25Home
                        Write-Host "==> [$loader] Minecraft $mc (standalone ForgeGradle)"
                        $logFile = Join-Path $logRoot "$loader-$mc-fg.log"
                        $expandedToml = @()
                        $result = Expand-MetadataVersion -RootDir $forge26Root -ModVersion $modVersion
                        if ($result) { $expandedToml = @($result) }
                        $prevEap = $ErrorActionPreference
                        $ErrorActionPreference = "Continue"
                        try {
                            $buildArgs = "-Pversion=$modVersion clean build writeVersion --no-daemon"
                            Invoke-GradleBuild -GradleExecutable $gradlew -ProjectDir $forge26Root -JavaHome $javaToUse -Arguments $buildArgs -LogFile $logFile
                        } finally {
                            $ErrorActionPreference = $prevEap
                            if ($expandedToml.Count -gt 0) {
                                Restore-MetadataVersion -BackupFiles $expandedToml
                            }
                        }
                        $exit = if (Test-Path Variable:\LASTEXITCODE) { $LASTEXITCODE } else { 0 }
                        if ($exit -eq 0) {
                            $jarSearchRoot = Join-Path $forge26Root "build/libs"
                            $jar = Get-ChildItem -Path $jarSearchRoot -Filter *.jar -File |
                                Where-Object { $_.Name -notlike "*-sources.jar" } |
                                Sort-Object Name |
                                Select-Object -First 1
                            if (-not $jar) {
                                $results.Add([pscustomobject]@{
                                    loader = $loader
                                    minecraft = $mc
                                    status = "failed"
                                    note = "no runtime jar found in $jarSearchRoot"
                                    artifact = ""
                                }) | Out-Null
                                continue
                            }
                            $artifactName = "Statusmod-$modVersion-$loader-$mc.jar"
                            $artifactPath = Join-Path $loaderOut $artifactName
                            Copy-Item -LiteralPath $jar.FullName -Destination $artifactPath -Force
                            $results.Add([pscustomobject]@{
                                loader = $loader
                                minecraft = $mc
                                status = "ok"
                                note = "log=$logFile (standalone ForgeGradle)"
                                artifact = $artifactPath
                            }) | Out-Null
                        } else {
                            $results.Add([pscustomobject]@{
                                loader = $loader
                                minecraft = $mc
                                status = "failed"
                                note = "gradle exit code $exit; log=$logFile"
                                artifact = ""
                            }) | Out-Null
                            if (-not $ContinueOnError) {
                                throw "Build failed for loader=$loader mc=$mc (exit $exit)"
                            }
                        }
                        continue
                    }
                }
                if ($loader -eq "neoforge") {
                    if ([string]::IsNullOrWhiteSpace((Get-CfgValue $cfg "neoforge_version")) -or [string]::IsNullOrWhiteSpace((Get-CfgValue $cfg "neogradle_version"))) {
                        $results.Add([pscustomobject]@{
                            loader = $loader
                            minecraft = $mc
                            status = "skipped"
                            note = "neoforge_version/neogradle_version missing"
                            artifact = ""
                        }) | Out-Null
                        continue
                    }
                }
                if ($loader -eq "quilt") {
                    if ([string]::IsNullOrWhiteSpace((Get-CfgValue $cfg "quilt_loader_version")) -or
                        [string]::IsNullOrWhiteSpace((Get-CfgValue $cfg "quilt_mappings")) -or
                        [string]::IsNullOrWhiteSpace((Get-CfgValue $cfg "quilt_loom_version"))) {
                        $results.Add([pscustomobject]@{
                            loader = $loader
                            minecraft = $mc
                            status = "skipped"
                            note = "quilt_loader_version/quilt_mappings/quilt_loom_version missing"
                            artifact = ""
                        }) | Out-Null
                        continue
                    }
                }

                if ($DryRun) {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "dry-run"
                        note = "build skipped by -DryRun"
                        artifact = ""
                    }) | Out-Null
                    continue
                }

                Set-GradlePropertyValue -FilePath $gradleProps -Key "minecraft_version" -Value $targetMc
                if (-not [string]::IsNullOrWhiteSpace($yarn)) {
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "yarn_mappings" -Value $yarn
                }

                if ($loader -eq "forge") {
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "forge_version" -Value (Get-CfgValue $cfg "forge_version")
                } elseif ($loader -eq "neoforge") {
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "neoforge_version" -Value (Get-CfgValue $cfg "neoforge_version")
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "neogradle_version" -Value (Get-CfgValue $cfg "neogradle_version")
                } elseif ($loader -eq "quilt") {
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "quilt_loader_version" -Value (Get-CfgValue $cfg "quilt_loader_version")
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "quilt_mappings" -Value (Get-CfgValue $cfg "quilt_mappings")
                    if ($null -ne $cfg.PSObject.Properties["qsl_version"]) {
                        Set-GradlePropertyValue -FilePath $gradleProps -Key "qsl_version" -Value ([string]$cfg.qsl_version)
                    }
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "quilt_loom_version" -Value (Get-CfgValue $cfg "quilt_loom_version")
                }
                # Tell settings.gradle to only include this loader's subproject,
                # preventing cross-loader Loom config failures (e.g. Quilt blocking NeoForge).
                Write-Host "==> [$loader] Minecraft $mc"

                # Quilt: repackage the Fabric JAR (Quilt Loom 1.15.1 has TinyRemapper
                # "Unfixable conflicts" bug with Mojang layered mappings).
                # Quilt Loader natively supports Fabric mods, so we take the Fabric JAR,
                # remove fabric.mod.json, inject quilt.mod.json, and repackage.
                if ($loader -eq "quilt") {
                    $fabricJarDir = Join-Path $outputRoot "fabric"
                    # WICHTIG: exakt auf diese Version filtern. Liegen im dist-Ordner
                    # noch Staende aelterer Versionen (z. B. 1.4.0), gewinnt sonst
                    # alphabetisch der aelteste Jar und Quilt wuerde Altcode verpacken.
                    $fabricJar = Get-ChildItem -Path $fabricJarDir -Filter "Statusmod-$modVersion-fabric-$mc.jar" -File -Recurse -ErrorAction SilentlyContinue |
                        Where-Object { $_.Name -notlike "*-sources.jar" } |
                        Select-Object -First 1
                    if (-not $fabricJar) {
                        $results.Add([pscustomobject]@{
                            loader = $loader
                            minecraft = $mc
                            status = "failed"
                            note = "no Fabric JAR found at $fabricJarDir for mc $mc"
                            artifact = ""
                        }) | Out-Null
                        if (-not $ContinueOnError) {
                            throw "Build failed for loader=$loader mc=$mc (no Fabric JAR to repackage)"
                        }
                        continue
                    }
                    $quiltJsonSrc = Join-Path $root "quilt\src\main\resources\quilt.mod.json"
                    $quiltJsonContent = (Get-Content $quiltJsonSrc -Raw) `
                        -replace '\$\{version\}', $modVersion `
                        -replace '\$\{quilt_loader_version\}', ([string]$cfg.quilt_loader_version)
                    $tempDir = Join-Path $env:TEMP "quilt-repack-$([guid]::NewGuid().ToString('N').Substring(0,8))"
                    try {
                        New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
                        Push-Location $tempDir
                        & jar xf $fabricJar.FullName 2>$null
                        if (Test-Path (Join-Path $tempDir "fabric.mod.json")) {
                            Remove-Item (Join-Path $tempDir "fabric.mod.json") -Force
                        }
                        [System.IO.File]::WriteAllText((Join-Path $tempDir "quilt.mod.json"), $quiltJsonContent)
                        $artifactName = "Statusmod-$modVersion-$loader-$mc.jar"
                        $artifactPath = Join-Path $loaderOut $artifactName
                        & jar cf $artifactPath -C $tempDir . 2>$null
                        $results.Add([pscustomobject]@{
                            loader = $loader
                            minecraft = $mc
                            status = "ok"
                            note = "repackaged from $($fabricJar.Name)"
                            artifact = $artifactPath
                        }) | Out-Null
                    } finally {
                        Pop-Location -ErrorAction SilentlyContinue
                        if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
                    }
                    continue
                }

                Set-GradlePropertyValue -FilePath $gradleProps -Key "target_loader" -Value $loader

                $javaToUse = $resolvedFabricJavaHome
                $mcParts = Get-McVersionParts -Mc $mc
                if ($null -ne $mcParts -and $mcParts[0] -ge 26) {
                    $javaToUse = $resolvedFabricJava25Home
                }
                $logFile = Join-Path $logRoot "$loader-$mc.log"
                $expandedToml = @()
                if ($loader -eq "forge" -or $loader -eq "neoforge") {
                    $result = Expand-MetadataVersion -RootDir $moduleRoot -ModVersion $modVersion
                    if ($result) { $expandedToml = @($result) }
                }
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                try {
                    $gradlewToUse = $gradlew
                    Invoke-GradleBuild -GradleExecutable $gradlewToUse -ProjectDir $moduleRoot -JavaHome $javaToUse -Arguments 'clean build writeVersion --no-daemon' -LogFile $logFile
                } finally {
                    $ErrorActionPreference = $prevEap
                    if ($expandedToml.Count -gt 0) {
                        Restore-MetadataVersion -BackupFiles $expandedToml
                    }
                }
                $exit = if (Test-Path Variable:\LASTEXITCODE) { $LASTEXITCODE } else { 0 }
                if ($exit -eq 0) {
                    $jarSearchRoot = Join-Path $moduleRoot "build/libs"
                    $jar = Get-ChildItem -Path $jarSearchRoot -Filter *.jar -File |
                        Where-Object { $_.Name -notlike "*-sources.jar" } |
                        Sort-Object Name |
                        Select-Object -First 1
                    if (-not $jar) {
                        $results.Add([pscustomobject]@{
                            loader = $loader
                            minecraft = $mc
                            status = "failed"
                            note = "no runtime jar found in $jarSearchRoot"
                            artifact = ""
                        }) | Out-Null
                        continue
                    }
                    $artifactName = "Statusmod-$modVersion-$loader-$mc.jar"
                    $artifactPath = Join-Path $loaderOut $artifactName
                    Copy-Item -LiteralPath $jar.FullName -Destination $artifactPath -Force
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "ok"
                        note = "log=$logFile"
                        artifact = $artifactPath
                    }) | Out-Null
                } else {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "failed"
                        note = "gradle exit code $exit; log=$logFile"
                        artifact = ""
                    }) | Out-Null
                    if (-not $ContinueOnError) {
                        throw "Build failed for loader=$loader mc=$mc (exit $exit)"
                    }
                }
            }
            continue
        }

        $loaderOut = Join-Path $outputRoot $loader
        New-Item -ItemType Directory -Force -Path $loaderOut | Out-Null
        $sharedFabricRoot = Resolve-LoaderModuleRoot -Root $root -Loader "fabric"
        $fabric26Root = Join-Path $root $Fabric26ModuleRoot

        foreach ($entry in $matrix) {
            $mc = [string]$entry.minecraft_version
            $targetMc = Get-TargetMinecraftVersion -Entry $entry
            $isFabricExtra = $false
            foreach ($extra in @($FabricExtraVersions)) {
                if (-not [string]::IsNullOrWhiteSpace($extra) -and $mc -eq $extra.Trim()) {
                    $isFabricExtra = $true
                    break
                }
            }
            try {
                $mcVersion = [version]$mc
                $maxVersion = [version]$FabricMaxVersion
                $minVersion = [version]$FabricMinVersion
            } catch {
                $mcVersion = $null
                $maxVersion = $null
                $minVersion = $null
            }
            if (-not $isFabricExtra -and ($null -eq $mcVersion -or $mcVersion -gt $maxVersion -or $mcVersion -lt $minVersion)) {
                Write-Host "==> [fabric] Minecraft $mc (skipped: outside requested range $FabricMinVersion..$FabricMaxVersion)"
                continue
            }
            $yarn = [string]$entry.yarn_mappings
            $apiCandidates = Select-FabricApiCandidates -MinecraftVersion $targetMc -ProvidedCandidates @($entry.fabric_api_candidates) -AllFabricApiVersions $allFabricApiVersions

            $versionOut = Join-Path $loaderOut $mc
            New-Item -ItemType Directory -Force -Path $versionOut | Out-Null
            $moduleRoot = if ($isFabricExtra) { $fabric26Root } else { Join-Path $outputRoot ".fabric-work\$mc" }
            $fabricBuildVersion = if ($isFabricExtra) {
                $targetMc
            } else {
                $targetMc
            }

            Write-Host "==> [$loader] Minecraft $mc"
            if ($DryRun) {
                $candidateCount = 0
                try { $candidateCount = @($apiCandidates).Count } catch { $candidateCount = 0 }
                $results.Add([pscustomobject]@{
                    loader = $loader
                    minecraft = $mc
                    status = "dry-run"
                    note = "build skipped by -DryRun; candidates=$candidateCount"
                    artifact = ""
                }) | Out-Null
                continue
            }

            # Fabric 26.x: unobfuscated, no Mojang mappings on piston-meta -> plain
            # javac build (Mojang names, no remap). The standalone Loom module
            # (Loader/fabric26.1) no longer exists.
            if ($isFabricExtra) {
                $plainScript = Join-Path $PSScriptRoot "build-fabric26-plain.ps1"
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                try {
                    & $plainScript -McVersion $mc -ModVersion $modVersion -JavaHome $resolvedFabricJava25Home
                } finally {
                    $ErrorActionPreference = $prevEap
                }
                $exit = if (Test-Path Variable:\LASTEXITCODE) { $LASTEXITCODE } else { 0 }
                $artifactPath = Join-Path $versionOut "Statusmod-$modVersion-$loader-$mc.jar"
                if (($exit -eq 0) -and (Test-Path -LiteralPath $artifactPath)) {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "ok"
                        note = "plain javac build (Mojang names, no remap)"
                        artifact = $artifactPath
                    }) | Out-Null
                } else {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "failed"
                        note = "plain javac build failed (exit $exit)"
                        artifact = ""
                    }) | Out-Null
                    if (-not $ContinueOnError) {
                        throw "Build failed for loader=$loader mc=$mc (plain javac)"
                    }
                }
                continue
            } else {
                if (Test-Path $moduleRoot) {
                    Remove-Item -LiteralPath $moduleRoot -Recurse -Force
                }
                New-Item -ItemType Directory -Force -Path $moduleRoot | Out-Null

                # Create an isolated source snapshot for this Minecraft version.
                Copy-DirectoryContents -Source (Join-Path $sharedFabricRoot "src") -Destination (Join-Path $moduleRoot "src")
                Copy-DirectoryContents -Source (Join-Path $sharedFabricRoot $mc) -Destination $moduleRoot
            }

            $built = $false
            $lastError = ""
            foreach ($apiVersion in $apiCandidates) {
                Set-GradlePropertyValue -FilePath $gradleProps -Key "minecraft_version" -Value $fabricBuildVersion
                # Use Mojang mappings consistently (code uses Mojang names).
                Set-GradlePropertyValue -FilePath $gradleProps -Key "mappings_mode" -Value "mojang"
                Set-GradlePropertyValue -FilePath $gradleProps -Key "yarn_mappings" -Value ""
                Set-GradlePropertyValue -FilePath $gradleProps -Key "fabric_api_version" -Value ([string]$apiVersion)
                # Only include fabric + common in settings.gradle to avoid Quilt Loom cascade.
                if (-not $isFabricExtra) {
                    Set-GradlePropertyValue -FilePath $gradleProps -Key "target_loader" -Value "fabric"
                }

                Write-Host "   trying fabric_api_version=$apiVersion"
                $safeApi = ([string]$apiVersion).Replace("+", "_").Replace(":", "_").Replace("/", "_")
                $logFile = Join-Path $logRoot "$loader-$mc-$safeApi.log"
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                try {
                    $javaHomeToUse = if ($isFabricExtra) { $resolvedFabricJava25Home } else { $resolvedFabricJavaHome }
                    $projectDirToUse = if ($isFabricExtra) { $moduleRoot } else { $root }
                    $gradleArgs = if ($isFabricExtra) {
                        "-Pversion=$modVersion clean build writeVersion --no-daemon"
                    } else {
                        '-Pfabric_module_root="' + $moduleRoot + '" clean build writeVersion --no-daemon'
                    }
                    Invoke-GradleBuild -GradleExecutable $gradlew -ProjectDir $projectDirToUse -JavaHome $javaHomeToUse -Arguments $gradleArgs -LogFile $logFile
                } finally {
                    $ErrorActionPreference = $prevEap
                }
                $exit = if (Test-Path Variable:\LASTEXITCODE) { $LASTEXITCODE } else { 0 }
                if ($exit -eq 0) {
                    $jarSearchRoot = if ($isFabricExtra) {
                        Join-Path $moduleRoot "build/devlibs"
                    } else {
                        Join-Path $root "fabric/build/libs"
                    }
                    $jar = Get-ChildItem -Path $jarSearchRoot -Filter *.jar -File |
                        Where-Object { $_.Name -notlike "*-sources.jar" } |
                        Sort-Object Name |
                        Select-Object -First 1
                    if (-not $jar) {
                        $lastError = "No runtime JAR found in build/libs."
                        continue
                    }
                    $artifactName = "Statusmod-$modVersion-$loader-$mc.jar"
                    $artifactPath = Join-Path $versionOut $artifactName
                    Copy-Item -LiteralPath $jar.FullName -Destination $artifactPath -Force
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "ok"
                        note = "fabric_api_version=$apiVersion; log=$logFile"
                        artifact = $artifactPath
                    }) | Out-Null
                    $built = $true
                    break
                } else {
                    $lastError = "gradle exit code $exit with fabric_api_version=$apiVersion (log: $logFile)"
                    try {
                        if (Test-Path $logFile) {
                            $logText = Get-Content -LiteralPath $logFile -Raw
                            if ($logText -match "Failed to find minecraft version") {
                                $lastError = "minecraft version not available"
                                break
                            }
                        }
                    } catch { }
                }
            }

            if (-not $built) {
                if ($lastError -eq "minecraft version not available") {
                    $results.Add([pscustomobject]@{
                        loader = $loader
                        minecraft = $mc
                        status = "skipped"
                        note = $lastError
                        artifact = ""
                    }) | Out-Null
                    continue
                }
                $candidateCount = 0
                try { $candidateCount = @($apiCandidates).Count } catch { $candidateCount = 0 }
                $results.Add([pscustomobject]@{
                    loader = $loader
                    minecraft = $mc
                    status = "failed"
                    note = "$lastError; candidates_tried=$candidateCount"
                    artifact = ""
                }) | Out-Null
                if (-not $ContinueOnError) {
                    throw "Build failed for loader=$loader mc=$mc ($lastError)"
                }
            }

            if (-not $isFabricExtra -and (Test-Path $moduleRoot)) {
                Remove-Item -LiteralPath $moduleRoot -Recurse -Force
            }
        }
    }
}
finally {
    [Environment]::SetEnvironmentVariable("GRADLE_USER_HOME", $oldGradleUserHome, "Process")
    Write-TextFileWithRetry -Path $gradleProps -Content $originalGradleProps
}

$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportFile
try {
    $markdownResults = @($results | ForEach-Object { $_ })
    $markdownReportArgs = @{
        ReportPath = $markdownReportFile
        Results = $markdownResults
        LogRoot = $logRoot
        JsonReportPath = $reportFile
        ModVersion = $modVersion
        DryRun = ([bool]$DryRun)
    }
    Write-MarkdownBuildReport @markdownReportArgs
} catch {
    Write-Host "Warning: failed to write markdown report: $($_.Exception.Message)"
    Write-Host $_.ScriptStackTrace
}
Write-Host ""
Write-Host "Build report: $reportFile"
Write-Host "Markdown report: $markdownReportFile"
$results | Format-Table -AutoSize | Out-String | Write-Host

$failed = @($results | Where-Object { $_.status -eq "failed" }).Count
if ($failed -gt 0 -and -not $ContinueOnError) {
    exit 1
}
