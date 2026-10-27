param(
    [Parameter(Mandatory = $true)][string]$JarPath,
    [Parameter(Mandatory = $true)][ValidateSet("fabric", "forge", "neoforge", "quilt")][string]$Loader,
    [Parameter(Mandatory = $true)][string]$McVersion,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $false)][string]$JavaHome = "",
    [Parameter(Mandatory = $false)][string]$FabricApiUrl = "",
    [switch]$SkipSinglePlayer,
    [switch]$KeepServerRunning
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$loaderVersionsPath = Join-Path $root "scripts\local\loader-versions.json"

# ---------------------------------------------------------------------------
# Version resolution
# ---------------------------------------------------------------------------

function Get-StableFabricLoaderVersion {
    param([string]$Mc)
    $url = "https://meta.fabricmc.net/v2/versions/loader/$Mc"
    $j = Invoke-RestMethod -Uri $url -TimeoutSec 30
    foreach ($e in $j) {
        if ($e.loader.stable -eq $true) { return $e.loader.version }
    }
    if ($j.Count -gt 0) { return $j[0].loader.version }
    throw "No fabric loader version for MC $Mc"
}

function Get-LatestFabricApiForMc {
    param([string]$Mc)
    $q = [uri]::EscapeDataString("[`"$Mc`"]")
    $l = [uri]::EscapeDataString('["fabric"]')
    $url = "https://api.modrinth.com/v2/project/fabric-api/version?game_versions=$q&loaders=$l"
    $j = Invoke-RestMethod -Uri $url -TimeoutSec 30
    if ($j.Count -eq 0) { throw "No fabric-api version for MC $Mc on Modrinth" }
    return $j[0].version_number
}

function Get-LoaderVersionConfig {
    param([string]$Loader, [string]$Mc, $Map)
    if ($null -eq $Map -or [string]::IsNullOrWhiteSpace($Mc)) { return $null }
    $loaderObj = $Map.$Loader
    if ($null -eq $loaderObj) { return $null }
    $prop = $loaderObj.PSObject.Properties | Where-Object { $_.Name -eq $Mc } | Select-Object -First 1
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

# Quilt-JARs sind repackagte Fabric-JARs (echte 26.x-Builds, keine Umbenennungen
# mehr) und werden gegen ihre echte MC-Version getestet, nicht 1.21.11.
$testMc = $McVersion
Write-Host "Test environment: loader=$Loader jarMc=$McVersion envMc=$testMc"

if ([string]::IsNullOrWhiteSpace($JavaHome) -or -not (Test-Path $JavaHome)) {
    $candidates = @($env:JAVA_HOME, "C:\Program Files\Java\jdk-25", "C:\Program Files\Java\jdk-25.0.3", "C:\Program Files\Eclipse Adoptium\jdk-25*", "C:\Program Files\Microsoft\jdk-25*")
    $JavaHome = $null
    foreach ($c in $candidates) {
        if ([string]::IsNullOrWhiteSpace($c)) { continue }
        if (Test-Path -LiteralPath $c) { $JavaHome = (Resolve-Path $c).Path; break }
        if ($c -match '[\*\?]') {
            $m = @(Get-ChildItem -Path $c -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
            if ($m.Count -gt 0) { $JavaHome = $m[0]; break }
        }
    }
}
if ([string]::IsNullOrWhiteSpace($JavaHome) -or -not (Test-Path $JavaHome)) {
    throw "Java 25 home not found (pass -JavaHome). All StatusMod JARs are compiled with toolchain 25 (class file 69.0)."
}
$javaExe = Join-Path $JavaHome "bin\java.exe"
Write-Host "Java: $javaExe"

$loaderVersionMap = $null
if (Test-Path $loaderVersionsPath) {
    $loaderVersionMap = Get-Content -LiteralPath $loaderVersionsPath -Raw | ConvertFrom-Json
}

$resolved = [ordered]@{}
switch ($Loader) {
    "fabric" {
        $resolved.loader_version = Get-StableFabricLoaderVersion -Mc $testMc
        $resolved.installer_url = "https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.2/fabric-installer-1.1.2.jar"
        if ((-not [string]::IsNullOrWhiteSpace($FabricApiUrl)) -and ($FabricApiUrl -match '^https?://')) {
            $resolved.fabric_api_url = $FabricApiUrl
            $resolved.fabric_api_version = [System.IO.Path]::GetFileNameWithoutExtension($FabricApiUrl) -replace '^fabric-api-', ''
        } else {
            if (-not [string]::IsNullOrWhiteSpace($FabricApiUrl)) { Write-Host "WARNING: ignoring invalid -FabricApiUrl '$FabricApiUrl', resolving latest from Modrinth" }
            $apiVer = Get-LatestFabricApiForMc -Mc $testMc
            $apiEsc = $apiVer.Replace('+', '%2B')
            $resolved.fabric_api_url = "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/$apiEsc/fabric-api-$apiEsc.jar"
            $resolved.fabric_api_version = $apiVer
        }
    }
    "quilt" {
        $cfg = Get-LoaderVersionConfig -Loader "quilt" -Mc $testMc -Map $loaderVersionMap
        $resolved.loader_version = if ($cfg) { $cfg.quilt_loader_version } else { "0.30.0" }
        $resolved.installer_url = "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/0.15.0/quilt-installer-0.15.0.jar"
        if ((-not [string]::IsNullOrWhiteSpace($FabricApiUrl)) -and ($FabricApiUrl -match '^https?://')) {
            $resolved.fabric_api_url = $FabricApiUrl
            $resolved.fabric_api_version = [System.IO.Path]::GetFileNameWithoutExtension($FabricApiUrl) -replace '^fabric-api-', ''
        } else {
            if (-not [string]::IsNullOrWhiteSpace($FabricApiUrl)) { Write-Host "WARNING: ignoring invalid -FabricApiUrl '$FabricApiUrl', resolving latest from Modrinth" }
            $apiVer = Get-LatestFabricApiForMc -Mc $testMc
            $apiEsc = $apiVer.Replace('+', '%2B')
            $resolved.fabric_api_url = "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/$apiEsc/fabric-api-$apiEsc.jar"
            $resolved.fabric_api_version = $apiVer
        }
    }
    "forge" {
        $cfg = Get-LoaderVersionConfig -Loader "forge" -Mc $McVersion -Map $loaderVersionMap
        if ($null -eq $cfg -or [string]::IsNullOrWhiteSpace($cfg.forge_version)) {
            throw "No forge_version for MC $McVersion in loader-versions.json"
        }
        $resolved.forge_version = $cfg.forge_version
        $resolved.installer_url = "https://maven.minecraftforge.net/net/minecraftforge/forge/$McVersion-$($cfg.forge_version)/forge-$McVersion-$($cfg.forge_version)-installer.jar"
    }
    "neoforge" {
        $cfg = Get-LoaderVersionConfig -Loader "neoforge" -Mc $McVersion -Map $loaderVersionMap
        if ($null -eq $cfg -or [string]::IsNullOrWhiteSpace($cfg.neoforge_version)) {
            throw "No neoforge_version for MC $McVersion in loader-versions.json"
        }
        $resolved.neoforge_version = $cfg.neoforge_version
        $resolved.installer_url = "https://maven.neoforged.net/releases/net/neoforged/neoforge/$($cfg.neoforge_version)/neoforge-$($cfg.neoforge_version)-installer.jar"
    }
}

Write-Host ("Resolved: " + (($resolved.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ", "))

# ---------------------------------------------------------------------------
# Process / log helpers
# ---------------------------------------------------------------------------

# Byte offsets per log file so Wait-LogContains only matches content that
# appeared since the previous check (stale lines from earlier checks would
# otherwise cause false positives, e.g. the init line matching the modinfo
# check). Log files are truncated before each process start, so offsets
# always begin at 0 for a given run.
$script:logOffsets = @{}

function ConvertTo-ArgumentString {
    param([string[]]$Items)
    if ($null -eq $Items -or $Items.Count -eq 0) { return "" }
    return (($Items | ForEach-Object {
            if ($_ -match '[ "]') {
                '"' + ($_ -replace '"', '\"') + '"'
            } else {
                $_
            }
        }) -join " ")
}

function Start-MinecraftProcess {
    param(
        [string]$JavaPath,
        [string[]]$StartArgs,
        [string]$WorkingDir,
        [string]$StdoutFile,
        [string]$StderrFile,
        [switch]$CaptureStdout
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $JavaPath
    # ArgumentList is not reliably serialized into the child command line on some
    # .NET builds; the plain Arguments string is used instead.
    $psi.Arguments = ConvertTo-ArgumentString -Items $StartArgs
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $WorkingDir
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $CaptureStdout
    $psi.RedirectStandardError = $true

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    # Drain stdout/stderr on dedicated async runspaces. Each stream is read by
    # exactly one runspace, so appends to the log files are serialized --
    # concurrent Add-Object-Event actions raced on the same file and lost lines
    # during boot output bursts. The Process and log paths are passed in via
    # AddArgument (same AppDomain, so the object references stay valid), and
    # the try/catch isolates any reader error. Raw .NET background threads
    # (ThreadStart) are avoided: an exception there crashes powershell.exe
    # with exit code 5.
    $runspaces = @()
    if ($CaptureStdout) {
        $rsOut = [powershell]::Create()
        $null = $rsOut.AddScript({
            param($p, $logFile)
            try {
                while ($null -ne ($line = $p.StandardOutput.ReadLine())) {
                    [System.IO.File]::AppendAllText($logFile, $line + [Environment]::NewLine)
                }
            } catch {}
        }).AddArgument($p).AddArgument($StdoutFile)
        $null = $rsOut.BeginInvoke()
        $runspaces += $rsOut
    }
    $rsErr = [powershell]::Create()
    $null = $rsErr.AddScript({
        param($p, $logFile)
        try {
            while ($null -ne ($line = $p.StandardError.ReadLine())) {
                [System.IO.File]::AppendAllText($logFile, $line + [Environment]::NewLine)
            }
        } catch {}
    }).AddArgument($p).AddArgument($StderrFile)
    $null = $rsErr.BeginInvoke()
    $runspaces += $rsErr
    # Attach the drain runspaces to the Process so Stop-MinecraftProcess can
    # dispose them once the child has exited.
    $p | Add-Member -NotePropertyName "SmRunspaces" -NotePropertyValue $runspaces -Force
    return $p
}

function Wait-LogContains {
    param(
        [string]$LogFile,
        [string]$Pattern,
        [int]$TimeoutSec = 120
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $LogFile) {
            $offset = 0
            if ($script:logOffsets.ContainsKey($LogFile)) { $offset = $script:logOffsets[$LogFile] }
            $fileLen = (Get-Item -LiteralPath $LogFile).Length
            if ($fileLen -gt $offset) {
                $newContent = $null
                $next = $offset
                $fs = $null
                try {
                    $fs = [System.IO.File]::Open($LogFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                    $fs.Position = $offset
                    $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::Default)
                    $newContent = $sr.ReadToEnd()
                    $next = $fs.Position
                } finally {
                    if ($null -ne $fs) { $fs.Close() }
                }
                $script:logOffsets[$LogFile] = $next
                if ($null -ne $newContent -and $newContent -match $Pattern) { return $true }
            }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Get-LastLogLines {
    param([string]$LogFile, [int]$Count = 40)
    if (-not (Test-Path -LiteralPath $LogFile)) { return @("<no log file: $LogFile>") }
    return @(Get-Content -LiteralPath $LogFile -Tail $Count -ErrorAction SilentlyContinue)
}

function Send-ServerCommand {
    param($Process, [string]$Command, [string]$ExpectPattern, [string]$LogFile, [int]$TimeoutSec = 30, [int]$MaxAttempts = 3)
    # Die erste Konsolen-Zeile nach dem Boot kann geschluckt werden (1.21.11
    # Console-Reader). Deshalb Senden mit Wiederholung; alle Befehle hier
    # sind read-only (modinfo/preset list/config show).
    $slice = [Math]::Max(5, [int]($TimeoutSec / $MaxAttempts))
    for ($a = 1; $a -le $MaxAttempts; $a++) {
        $Process.StandardInput.WriteLine($Command)
        $Process.StandardInput.Flush()
        if (Wait-LogContains -LogFile $LogFile -Pattern $ExpectPattern -TimeoutSec $slice) { return $true }
    }
    return $false
}

function Stop-MinecraftProcess {
    param($Process)
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) {
            $Process.StandardInput.WriteLine("stop")
            $Process.StandardInput.Flush()
            if (-not $Process.WaitForExit(30000)) {
                $Process.Kill()
                [void]$Process.WaitForExit(5000)
            }
        }
    } catch {
        try { $Process.Kill() } catch { }
    }
    # Let the drain runspaces flush their final appends before the next run
    # truncates the log files.
    Start-Sleep -Milliseconds 500
    try {
        @(Get-EventSubscriber -ErrorAction SilentlyContinue) | Where-Object { $null -ne $_.SourceObject -and $_.SourceObject -eq $Process } | ForEach-Object {
            Unregister-Event -SourceIdentifier $_.SourceIdentifier -ErrorAction SilentlyContinue
        }
    } catch { }
    try {
        if ($Process.SmRunspaces) {
            foreach ($rs in $Process.SmRunspaces) {
                try { $rs.Stop() } catch { }
                try { $rs.Dispose() } catch { }
            }
        }
    } catch { }
}

function Write-TestResult {
    param(
        [bool]$Passed,
        [hashtable]$MpResult,
        [hashtable]$SpResult,
        [string]$ErrorText
    )
    $result = [ordered]@{
        jar        = $jarName
        loader     = $Loader
        mc_version = $McVersion
        env_mc     = $testMc
        passed     = $Passed
        mp         = $MpResult
        sp         = $SpResult
        error      = $ErrorText
    }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $WorkDir "result.json")
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

$jarPath = (Resolve-Path -LiteralPath $JarPath).Path
$jarName = Split-Path $jarPath -Leaf
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$serverDir = Join-Path $WorkDir "server"
$clientDir = Join-Path $WorkDir "client"
$dlDir = Join-Path $WorkDir "dl"
New-Item -ItemType Directory -Force -Path $serverDir | Out-Null
New-Item -ItemType Directory -Force -Path $clientDir | Out-Null
New-Item -ItemType Directory -Force -Path $dlDir | Out-Null

function Invoke-Download {
    param([string]$Url, [string]$OutFile)
    $p = 0
    try { $p = $ProgressPreference; $ProgressPreference = "SilentlyContinue" } catch { }
    try {
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 120
    } finally {
        try { $ProgressPreference = $p } catch { }
    }
    if (-not (Test-Path $OutFile)) { throw "Download failed: $Url" }
}

function Get-ForgeServerArgs {
    param([string]$Dir)
    # Forge/NeoForge installers produce run.bat:
    #   java @user_jvm_args.txt @libraries/net/minecraftforge/forge/<ver>/win_args.txt %*
    # We invoke java directly with the same arg files (java supports nested @argfiles).
    $runBat = Join-Path $Dir "run.bat"
    if (-not (Test-Path $runBat)) { throw "No run.bat found after Forge/NeoForge install: $Dir" }
    $batContent = Get-Content $runBat -Raw
    $m = [regex]::Match($batContent, '@(libraries[^\s"%]+win_args\.txt)')
    if (-not $m.Success) {
        throw "Could not parse win_args.txt path from run.bat: $batContent"
    }
    $winArgs = Join-Path $Dir ($m.Groups[1].Value)
    $args = @()
    $userArgs = Join-Path $Dir "user_jvm_args.txt"
    if (Test-Path $userArgs) { $args += "@$userArgs" }
    $args += "@$winArgs"
    return $args
}

function Get-MojangVersionJson {
    param([string]$Mc)
    $manifest = Invoke-RestMethod -Uri "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json" -TimeoutSec 60
    $entry = $manifest.versions | Where-Object { $_.id -eq $Mc } | Select-Object -First 1
    if ($null -eq $entry) { throw "MC $Mc not found in Mojang version manifest" }
    if ([string]::IsNullOrWhiteSpace($entry.url)) { throw "No version JSON URL for MC $Mc" }
    return Invoke-RestMethod -Uri $entry.url -TimeoutSec 60
}

function Get-LibraryClasspath {
    param($VersionJson, [string]$BaseDir, [string]$JavaExe, [string]$WorkDir)
    # Download all vanilla libraries (per Mojang version JSON) into BaseDir\libraries
    # and return the resulting classpath list. This mirrors what a launcher does.
    $paths = New-Object System.Collections.Generic.List[string]
    $libDir = Join-Path $BaseDir "libraries"
    New-Item -ItemType Directory -Force -Path $libDir | Out-Null

    $index = 0
    foreach ($lib in $VersionJson.libraries) {
        $index++
        $artifact = $null
        $downloads = $lib.downloads
        if ($null -ne $downloads -and $downloads.PSObject.Properties['artifact']) { $artifact = $downloads.artifact }
        if (-not $artifact -or -not $artifact.path) { continue }
        $relPath = $artifact.path -replace "/", "\"
        $target = Join-Path $libDir $relPath
        if (Test-Path $target) {
            $paths.Add($target)
            continue
        }

        # Determine download URL
        $url = ""
        if ($artifact.url) {
            $url = $artifact.url
        } elseif ($lib.url) {
            $url = ($lib.url.TrimEnd("/")) + "/" + ($artifact.path -replace "\\", "/")
        } else {
            $url = "https://libraries.minecraft.net/" + ($artifact.path -replace "\\", "/")
        }

        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        $downloaded = $false
        $lastErr = ""
        foreach ($candidate in @($url, ("https://repo1.maven.org/maven2/" + ($artifact.path -replace "\\", "/")))) {
            if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
            try {
                Invoke-Download -Url $candidate -OutFile $target
                $downloaded = $true
                break
            } catch { $lastErr = $_.Exception.Message }
        }
        if (-not $downloaded) {
            Write-Host "Warning: could not download library $($artifact.path): $lastErr"
            continue
        }
        $paths.Add($target)
    }
    return $paths
}

function Test-ClientStarted {
    param([string]$StdoutFile, [string]$LatestLog)
    $sources = @()
    if (Test-Path $StdoutFile) { $sources += (Get-Content $StdoutFile -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path $LatestLog) { $sources += (Get-Content $LatestLog -Raw -ErrorAction SilentlyContinue) }
    return ($sources -join "`n")
}

function Invoke-SinglePlayerTest {
    param(
        [string]$ServerDir,
        [string]$ClientDir,
        [string]$JavaExe,
        [string]$JarPath,
        [string]$JarName,
        [string]$Loader,
        [string]$Mc,
        [string]$WorkDir,
        $Resolved
    )
    $sp = @{ passed = $false; log = ""; error = ""; skipped = $false }
    $clientProc = $null

    try {
        $installerJar = Join-Path $WorkDir "dl\installer.jar"

        # 1. Install client profile via loader installer
        $profileJson = $null
        $launchArgs = $null
        switch ($Loader) {
            "fabric" {
                # -noprofile: we launch KnotClient directly; no launcher_profiles.json needed
                $p = Start-Process -FilePath $JavaExe -ArgumentList @("-jar", $installerJar, "client", "-dir", $ClientDir, "-mcversion", $Mc, "-loader", $Resolved.loader_version, "-noprofile") -Wait -PassThru -NoNewWindow
                if ($p.ExitCode -ne 0) { throw "fabric-installer client exited $($p.ExitCode)" }
                $mainClass = "net.fabricmc.loader.launch.knot.KnotClient"
            }
            "quilt" {
                $p = Start-Process -FilePath $JavaExe -ArgumentList @("-jar", $installerJar, "install", "client", $Mc, $Resolved.loader_version, "--install-dir=$ClientDir") -Wait -PassThru -NoNewWindow
                if ($p.ExitCode -ne 0) { throw "quilt-installer client exited $($p.ExitCode)" }
                $mainClass = "org.quiltmc.loader.launch.knot.KnotClient"
            }
            "forge" {
                $p = Start-Process -FilePath $JavaExe -ArgumentList @("-jar", $installerJar, "--installClient", $ClientDir) -Wait -PassThru -NoNewWindow
                if ($p.ExitCode -ne 0) { throw "forge installer client exited $($p.ExitCode)" }
                $profileDir = Get-ChildItem -Path (Join-Path $ClientDir "versions") -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$Mc-forge-*" } | Select-Object -First 1
                $profileJsonFile = if ($profileDir) { Get-ChildItem -Path $profileDir.FullName -Filter "*.json" -File | Select-Object -First 1 } else { $null }
                if (-not $profileJsonFile) { throw "Forge client profile JSON not found after --installClient" }
                $profileJson = Get-Content -LiteralPath $profileJsonFile.FullName -Raw | ConvertFrom-Json
                $mainClass = $profileJson.mainClass
            }
            "neoforge" {
                $p = Start-Process -FilePath $JavaExe -ArgumentList @("-jar", $installerJar, "--installClient", $ClientDir) -Wait -PassThru -NoNewWindow
                if ($p.ExitCode -ne 0) { throw "neoforge installer client exited $($p.ExitCode)" }
                $profileDir = Get-ChildItem -Path (Join-Path $ClientDir "versions") -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$Mc-neoforge-*" } | Select-Object -First 1
                $profileJsonFile = if ($profileDir) { Get-ChildItem -Path $profileDir.FullName -Filter "*.json" -File | Select-Object -First 1 } else { $null }
                if (-not $profileJsonFile) { throw "NeoForge client profile JSON not found after --installClient" }
                $profileJson = Get-Content -LiteralPath $profileJsonFile.FullName -Raw | ConvertFrom-Json
                $mainClass = $profileJson.mainClass
            }
        }

        # 2. Vanilla client jar, LWJGL natives, asset index from Mojang manifest
        $versionJson = Get-MojangVersionJson -Mc $Mc
        $versionsDir = Join-Path $ClientDir "versions"
        $vanillaDir = Join-Path $versionsDir $Mc
        New-Item -ItemType Directory -Force -Path $vanillaDir | Out-Null
        $clientJar = Join-Path $vanillaDir "$Mc.jar"
        if (-not (Test-Path $clientJar)) {
            Invoke-Download -Url $versionJson.downloads.client.url -OutFile $clientJar
        }

        # Headless CI machines have no GPU drivers; extract natives so LWJGL can
        # at least load its .dlls (software GL fallback is set on the JVM args).
        $nativesDir = Join-Path $vanillaDir "natives"
        New-Item -ItemType Directory -Force -Path $nativesDir | Out-Null
        foreach ($lib in $versionJson.libraries) {
            $natives = $null
            $downloads = $lib.downloads
            if ($null -ne $downloads -and $downloads.PSObject.Properties['classifiers']) {
                $natives = $downloads.classifiers.'natives-windows'
            }
            if ($null -ne $natives -and $natives.url) {
                $zip = Join-Path $vanillaDir ("natives-" + ([IO.Path]::GetFileNameWithoutExtension($natives.path) -replace "[:/\\]", "-") + ".zip")
                if (-not (Test-Path $zip)) { Invoke-Download -Url $natives.url -OutFile $zip }
                $targetName = [IO.Path]::GetFileNameWithoutExtension($zip)
                $targetDir = Join-Path $nativesDir $targetName
                if (-not (Test-Path $targetDir)) { Expand-Archive -LiteralPath $zip -DestinationPath $targetDir -Force }
            }
        }

        $assetIndexId = $versionJson.assetIndex.id
        $assetIndexUrl = $versionJson.assetIndex.url
        $assetsDir = Join-Path $ClientDir "assets"
        $indexesDir = Join-Path $assetsDir "indexes"
        New-Item -ItemType Directory -Force -Path $indexesDir | Out-Null
        $indexFile = Join-Path $indexesDir "$assetIndexId.json"
        if (-not (Test-Path $indexFile)) {
            Invoke-Download -Url $assetIndexUrl -OutFile $indexFile
        }

        # Download asset objects referenced by the index (sounds, fonts, ...).
        # Without the object store the client loops on "Failed to open pack".
        # Uses curl.exe --parallel (fast, low overhead per request).
        $objDir = Join-Path $assetsDir "objects"
        $assetStaging = Join-Path $vanillaDir "asset-dl"
        $objMap = (Get-Content -LiteralPath $indexFile -Raw | ConvertFrom-Json).objects
        $missing = @(foreach ($prop in @($objMap.PSObject.Properties)) {
            $h = [string]$prop.Value.hash
            $dst = Join-Path $objDir ($h.Substring(0, 2) + "\" + $h)
            if (-not (Test-Path -LiteralPath $dst)) { $h }
        })
        if ($missing.Count -gt 0) {
            Write-Host "Downloading $($missing.Count) asset objects..."
            New-Item -ItemType Directory -Force -Path $assetStaging, $objDir | Out-Null
            $cfg = Join-Path $assetStaging "urls.txt"
            $stagingFwd = $assetStaging.Replace('\', '/')
            $lines = @($missing | ForEach-Object {
                'url = "https://resources.download.minecraft.net/' + $_.Substring(0, 2) + "/" + $_ + '"' +
                [Environment]::NewLine +
                'output = "' + $stagingFwd + '/' + $_ + '"'
            })
            [System.IO.File]::WriteAllLines($cfg, $lines)
            $curlLog = Join-Path $assetStaging "curl.log"
            & curl.exe -s -S -f --parallel --parallel-max 32 --config $cfg *> $curlLog
            foreach ($f in @(Get-ChildItem -LiteralPath $assetStaging -File | Where-Object { $_.Name -ne 'urls.txt' -and $_.Name -ne 'curl.log' })) {
                $targetDir = Join-Path $objDir $f.Name.Substring(0, 2)
                New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
                Move-Item -LiteralPath $f.FullName -Destination (Join-Path $targetDir $f.Name) -Force
            }
            Remove-Item -LiteralPath $cfg, $curlLog, $assetStaging -Force -Recurse -ErrorAction SilentlyContinue
        }

        # 3. Copy mod + deps into client mods dir
        $clientMods = Join-Path $ClientDir "mods"
        New-Item -ItemType Directory -Force -Path $clientMods | Out-Null
        Copy-Item -LiteralPath $JarPath -Destination (Join-Path $clientMods $JarName) -Force
        # OrderedDictionary: direkter Key-Zugriff wirft unter StrictMode bei
        # fehlendem Key, PSObject.Properties sieht Dict-Einträge gar nicht.
        if ($Resolved.Contains("fabric_api_url") -and (-not [string]::IsNullOrWhiteSpace($Resolved.fabric_api_url))) {
            $apiFile = Join-Path $clientMods ("fabric-api-" + $Resolved.fabric_api_version + ".jar")
            if (-not (Test-Path $apiFile)) {
                Invoke-Download -Url $Resolved.fabric_api_url -OutFile $apiFile
            }
        }

        # 4. Build classpath: vanilla libs (downloaded) + loader libs (installed by installer) + client jar
        $cp = New-Object System.Collections.Generic.List[string]
        foreach ($libPath in @(Get-LibraryClasspath -VersionJson $versionJson -BaseDir $ClientDir -JavaExe $JavaExe -WorkDir $WorkDir)) {
            $cp.Add($libPath)
        }
        $installedLibs = @(Get-ChildItem -Path (Join-Path $ClientDir "libraries") -Recurse -Filter *.jar -File -ErrorAction SilentlyContinue)
        foreach ($lj in $installedLibs) {
            if (-not $cp.Contains($lj.FullName)) { $cp.Add($lj.FullName) }
        }
        $cp.Add($clientJar)
        $classpath = $cp -join ";"

        # 5. Seed a world from the MP test server (flat) into client saves
        $worldSrc = Join-Path $ServerDir "world"
        $worldDst = Join-Path $ClientDir "saves\testworld"
        if ((Test-Path $worldSrc) -and -not (Test-Path $worldDst)) {
            New-Item -ItemType Directory -Force -Path $worldDst | Out-Null
            Copy-Item -Path (Join-Path $worldSrc "*") -Destination $worldDst -Recurse -Force
        }

        # 6. Launch client
        $stdoutFile = Join-Path $WorkDir "sp-client.out.log"
        $stderrFile = Join-Path $WorkDir "sp-client.err.log"
        $latestLog = Join-Path $ClientDir "logs\latest.log"
        $sp.log = $stdoutFile

        # Truncate so stale lines from previous runs cannot satisfy assertions.
        Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
        $script:logOffsets[$stdoutFile] = 0
        $script:logOffsets[$stderrFile] = 0

        if ($null -ne $profileJson) {
            # forge/neoforge: use the version JSON produced by the installer
            $subs = @{
                "version_name"      = $profileJson.id
                "game_directory"    = $ClientDir
                "assets_root"       = $assetsDir
                "assets_index_name" = $assetIndexId
                "auth_player_name"  = "CI_Test"
                "auth_uuid"         = "00000000-0000-0000-0000-000000000001"
                "auth_access_token" = "0"
                "auth_session"      = "token:0:CI_Test"
                "auth_xuid"         = "0"
                "user_type"         = "msa"
                "user_properties"   = "{}"
                "clientid"          = "0"
                "resolution_width"  = "854"
                "resolution_height" = "480"
                "version_type"      = "release"
            }
            if ($profileJson.arguments -and $profileJson.arguments.game) {
                $rawArgs = $profileJson.arguments.game
            } elseif ($profileJson.minecraftArguments) {
                $rawArgs = $profileJson.minecraftArguments -split "\s+"
            } else {
                $rawArgs = @()
            }
            $launchArgs = @()
            foreach ($a in $rawArgs) {
                $expanded = $a
                foreach ($k in $subs.Keys) { $expanded = $expanded.Replace("`${$k}", $subs[$k]) }
                $launchArgs += $expanded
            }
            if ($launchArgs -notcontains "--quickPlaySingleplayer") {
                $launchArgs += @("--quickPlaySingleplayer", "testworld")
            }
        } else {
            $launchArgs = @("--gameDir", $ClientDir, "--assetsDir", $assetsDir, "--assetIndex", $assetIndexId, "--username", "CI_Test", "--quickPlaySingleplayer", "testworld")
        }

        $clientArgs = @(
            "-Xms1024M", "-Xmx2048M",
            "-Dorg.lwjgl.system.librarypath=$nativesDir",
            "-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=true",
            "-cp", $classpath,
            $mainClass
        ) + $launchArgs

        $clientProc = Start-MinecraftProcess -JavaPath $JavaExe -StartArgs $clientArgs -WorkingDir $ClientDir -StdoutFile $stdoutFile -StderrFile $stderrFile -CaptureStdout

        # 7. Assertions (poll both stdout and the client's own logs/latest.log)
        $deadline = (Get-Date).AddSeconds(240)
        $initOk = $false
        $doneOk = $false
        while ((Get-Date) -lt $deadline) {
            $text = Test-ClientStarted -StdoutFile $stdoutFile -LatestLog $latestLog
            if (-not $initOk -and $text -match "\[StatusMod\] Initializing") { $initOk = $true }
            if (-not $doneOk -and $text -match "(?:Done \(|joined the game)") { $doneOk = $true }
            if ($initOk -and $doneOk) { break }
            if ($clientProc.HasExited) { break }
            Start-Sleep -Milliseconds 1000
        }
        if (-not $initOk) {
            throw "StatusMod init line not found in client log within 240s. Last lines:`n" + ((Get-LastLogLines $stdoutFile) -join "`n")
        }
        if (-not $doneOk) {
            throw "Client world did not reach 'Done'/'joined the game' within 240s. Last lines:`n" + ((Get-LastLogLines $stdoutFile) -join "`n")
        }
        $clientText = Test-ClientStarted -StdoutFile $stdoutFile -LatestLog $latestLog
        $fatalLines = @($clientText -split "`r?`n" | Where-Object { $_ -match "(?i)Caused by:|Fatal Error|Exception in thread" })
        $realErrors = @($fatalLines | Where-Object { $_ -notmatch "(?i)MinecraftClientHttpException|InvalidCredentialsException|authlib|Unsupported JNI" })
        if ($realErrors.Count -gt 0) {
            throw "Client log contains error lines: " + ($realErrors -join "; ")
        }

        $sp.passed = $true
    } catch {
        $sp.error = $_.Exception.Message
    } finally {
        if ($clientProc) { Stop-MinecraftProcess -Process $clientProc }
    }
    return $sp
}

function Get-ServerLauncher {
    param([string]$Dir)
    $jar = Get-ChildItem -Path $Dir -Filter "fabric-server-mc*.jar" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $jar) {
        $jar = Get-ChildItem -Path $Dir -Filter "fabric-server-launch.jar" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $jar) {
        $jar = Get-ChildItem -Path $Dir -Filter "quilt-server-launch.jar" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    return $jar
}

# ---------------------------------------------------------------------------
# MP test
# ---------------------------------------------------------------------------

$mpResult = @{ passed = $false; log = ""; error = "" }
$serverProc = $null
try {
    $installerJar = Join-Path $dlDir "installer.jar"
    if (-not (Test-Path $installerJar)) {
        Invoke-Download -Url $resolved.installer_url -OutFile $installerJar
    }

    switch ($Loader) {
        "fabric" {
            # fabric-installer 1.1.x uses single-dash options and -downloadMinecraft
            # to fetch the vanilla server.jar (produces fabric-server-launch.jar + server.jar).
            $installArgs = @("-jar", $installerJar, "server", "-dir", $serverDir, "-mcversion", $testMc, "-loader", $resolved.loader_version, "-downloadMinecraft")
            $p = Start-Process -FilePath $javaExe -ArgumentList $installArgs -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -ne 0) { throw "fabric-installer server exited $($p.ExitCode)" }
        }
        "quilt" {
            # quilt-installer arg parsing does not tolerate spaces in paths; install-dir must be passed via '='.
            $installArgs = @("-jar", $installerJar, "install", "server", $testMc, $resolved.loader_version, "--install-dir=$serverDir", "--download-server", "--create-scripts")
            $p = Start-Process -FilePath $javaExe -ArgumentList $installArgs -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -ne 0) { throw "quilt-installer server exited $($p.ExitCode)" }
        }
        "forge" {
            $p = Start-Process -FilePath $javaExe -ArgumentList @("-jar", $installerJar, "--installServer") -WorkingDirectory $serverDir -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -ne 0) { throw "forge installer exited $($p.ExitCode)" }
        }
        "neoforge" {
            $p = Start-Process -FilePath $javaExe -ArgumentList @("-jar", $installerJar, "--installServer") -WorkingDirectory $serverDir -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -ne 0) { throw "neoforge installer exited $($p.ExitCode)" }
        }
    }

    # Mods
    $modsDir = Join-Path $serverDir "mods"
    New-Item -ItemType Directory -Force -Path $modsDir | Out-Null
    Copy-Item -LiteralPath $jarPath -Destination (Join-Path $modsDir $jarName) -Force
    # OrderedDictionary: direkter Key-Zugriff wirft unter StrictMode bei
    # fehlendem Key, PSObject.Properties sieht Dict-Einträge gar nicht.
    if ($resolved.Contains("fabric_api_url") -and (-not [string]::IsNullOrWhiteSpace($resolved.fabric_api_url))) {
        $apiFile = Join-Path $modsDir ("fabric-api-" + $resolved.fabric_api_version + ".jar")
        if (-not (Test-Path $apiFile)) {
            Invoke-Download -Url $resolved.fabric_api_url -OutFile $apiFile
        }
    }

    # eula + server.properties
    Set-Content -LiteralPath (Join-Path $serverDir "eula.txt") -Value "eula=true" -Encoding ASCII
    $propsPath = Join-Path $serverDir "server.properties"
    $props = @(
        "online-mode=false",
        "server-port=25565",
        "level-type=minecraft:flat",
        "spawn-protection=0",
        "view-distance=6",
        "simulation-distance=6",
        "max-players=1"
    )
    Set-Content -LiteralPath $propsPath -Value ($props -join "`n") -Encoding ASCII

    # Determine server launcher + start args
    $launcher = Get-ServerLauncher -Dir $serverDir
    if ($Loader -in @("fabric", "quilt") -and -not $launcher) {
        throw "No server launcher jar found after install in $serverDir"
    }
    Write-Host "Server launcher: $(if ($launcher) { $launcher.Name } else { '(forge/neoforge: run.bat argfiles)' })"

    $stdoutFile = Join-Path $WorkDir "mp-server.out.log"
    $stderrFile = Join-Path $WorkDir "mp-server.err.log"
    $mpResult.log = $stdoutFile

    # Truncate so each run starts clean (offset-based matching depends on it).
    Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    $script:logOffsets[$stdoutFile] = 0
    $script:logOffsets[$stderrFile] = 0

    $startArgs = switch ($Loader) {
        "fabric" { @("-Xms1024M", "-Xmx2048M", "-jar", $launcher.Name, "nogui") }
        "quilt" { @("-Xms1024M", "-Xmx2048M", "-jar", $launcher.Name, "nogui") }
        "forge" { @(Get-ForgeServerArgs -Dir $serverDir) + @("nogui") }
        "neoforge" { @(Get-ForgeServerArgs -Dir $serverDir) + @("nogui") }
    }

    $serverProc = Start-MinecraftProcess -JavaPath $javaExe -StartArgs $startArgs -WorkingDir $serverDir -StdoutFile $stdoutFile -StderrFile $stderrFile -CaptureStdout

    # Offset-based matching: the init line appears in the log BEFORE 'Done', so
    # it must be checked first -- checking 'Done' first would advance the read
    # offset past the init line and miss it.
    $initOk = Wait-LogContains -LogFile $stdoutFile -Pattern "\[StatusMod\] Initializing" -TimeoutSec 60
    if (-not $initOk) {
        throw "StatusMod init line not found in server log. Last lines:`n" + ((Get-LastLogLines $stdoutFile) -join "`n")
    }
    Write-Host "StatusMod initialized."

    $doneOk = Wait-LogContains -LogFile $stdoutFile -Pattern "Done \(" -TimeoutSec 180
    if (-not $doneOk) {
        throw "Server did not reach 'Done' within 180s. Last lines:`n" + ((Get-LastLogLines $stdoutFile) -join "`n")
    }
    Write-Host "Server reached 'Done'."
    # Console commands written around the 'Done' dispatch can race the server's
    # first tick loop and throw "An unexpected error occurred trying to execute
    # that command". Give the tick loop a short grace period first.
    Start-Sleep -Seconds 3

    # Send /modinfo via console stdin, wait for the mod response.
    # 'Status Player — Informationen' -- the em-dash is non-ASCII and gets
    # mangled by the stdout decode chain (varies per run), so allow a generous
    # number of arbitrary characters between the two words.
    $infoOk = Send-ServerCommand -Process $serverProc -Command "modinfo" -ExpectPattern "Status Player.{0,20}Informationen" -LogFile $stdoutFile -TimeoutSec 30
    if (-not $infoOk) {
        throw "No /modinfo response in server log. Last lines:`n" + ((Get-LastLogLines $stdoutFile) -join "`n")
    }
    Write-Host "modinfo command responded."

    # /status command tests (console source has admin permission; player-only
    # subcommands like /status <text> are skipped on a dedicated server).
    $presetOk = Send-ServerCommand -Process $serverProc -Command "status preset list" -ExpectPattern "Presets:" -LogFile $stdoutFile -TimeoutSec 30
    if (-not $presetOk) {
        throw "No /status preset list response in server log. Last lines:`n" + ((Get-LastLogLines $stdoutFile) -join "`n")
    }
    Write-Host "status preset list responded."

    $configOk = Send-ServerCommand -Process $serverProc -Command "status config show" -ExpectPattern "StatusMod configuration:" -LogFile $stdoutFile -TimeoutSec 30
    if (-not $configOk) {
        throw "No /status config show response in server log. Last lines:`n" + ((Get-LastLogLines $stdoutFile) -join "`n")
    }
    Write-Host "status config show responded."

    $mpResult.passed = $true
}
catch {
    $mpResult.error = $_.Exception.Message
    Write-Warning "MP test failed: $($_.Exception.Message)"
}
finally {
    if ($serverProc) { Stop-MinecraftProcess -Process $serverProc }
}

if ($mpResult.passed) {
    Write-Host "MP test PASSED"
} else {
    Write-Host "MP test FAILED: $($mpResult.error)"
}

# ---------------------------------------------------------------------------
# SP test (optional per -SkipSinglePlayer)
# ---------------------------------------------------------------------------

$spResult = @{ passed = $false; log = ""; error = ""; skipped = $false }
if ($SkipSinglePlayer) {
    $spResult.skipped = $true
    Write-Host "SP test skipped (-SkipSinglePlayer)."
} else {
    try {
        $spResult = Invoke-SinglePlayerTest -ServerDir $serverDir -ClientDir $clientDir -JavaExe $javaExe -JarPath $jarPath -JarName $jarName -Loader $Loader -Mc $testMc -WorkDir $WorkDir -Resolved $resolved
    } catch {
        $spResult.error = $_.Exception.Message
        Write-Warning "SP test failed: $($_.Exception.Message)"
    }
    if ($spResult.passed) { Write-Host "SP test PASSED" } else { Write-Host "SP test FAILED: $($spResult.error)" }
}

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

$overall = $mpResult.passed -and ($spResult.skipped -or $spResult.passed)
Write-TestResult -Passed $overall -MpResult $mpResult -SpResult $spResult -ErrorText $spResult.error

if (-not $mpResult.passed) {
    Write-Host "`n=== MP server log (last 40 lines) ==="
    Get-LastLogLines $mpResult.log | ForEach-Object { Write-Host $_ }
}
if (-not $spResult.passed -and -not $spResult.skipped) {
    Write-Host "`n=== SP client log (last 40 lines) ==="
    Get-LastLogLines $spResult.log | ForEach-Object { Write-Host $_ }
}

if (-not $overall) {
    Write-Host "`nRESULT: FAILED ($Loader $McVersion)"
    exit 1
}
Write-Host "RESULT: PASSED ($Loader $McVersion)"
exit 0
