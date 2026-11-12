param(
  [string]$Loaders = "",
  [string]$McVersions = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$modVersion = (Get-Content (Join-Path $root "version.txt") -Raw).Trim()
$distDir = Join-Path $root "dist\multiversion"

# --- changelog: kuratierter CHANGELOG.md-Abschnitt, Fallback git-log ---
$changelog = ""
$clPath = Join-Path $root "CHANGELOG.md"
if (Test-Path -LiteralPath $clPath) {
    $clText = Get-Content -LiteralPath $clPath -Raw
    $cm = [regex]::Match($clText, "(?ms)^## " + [regex]::Escape($modVersion) + "\b.*?\r?\n([\s\S]*?)(?=^## |\z)")
    if ($cm.Success) { $changelog = $cm.Groups[1].Value.Trim() }
}
if ([string]::IsNullOrWhiteSpace($changelog)) {
    $lastTag = git describe --tags --abbrev=0 2>$null
    $changelog = if ($lastTag) {
        $lines = git log "$lastTag..HEAD" --oneline 2>$null
        if ($lines) { "Changes since $lastTag`n`n$($lines -join "`n")" } else { "" }
    } else {
        $lines = git log --oneline -20 2>$null
        if ($lines) { "Changes`n`n$($lines -join "`n")" } else { "" }
    }
}
if ([string]::IsNullOrWhiteSpace($changelog)) { $changelog = "No changelog available" }

$modrinthToken = [string]$env:MODRINTH_TOKEN
$modrinthProjectId = [string]$env:MODRINTH_PROJECT_ID
$curseforgeToken = [string]$env:CURSEFORGE_TOKEN
$curseforgeProjectId = [string]$env:CURSEFORGE_PROJECT_ID

if ([string]::IsNullOrWhiteSpace($modrinthToken)) { throw "MODRINTH_TOKEN not set" }
if ([string]::IsNullOrWhiteSpace($modrinthProjectId)) { throw "MODRINTH_PROJECT_ID not set" }
if ([string]::IsNullOrWhiteSpace($curseforgeToken)) { throw "CURSEFORGE_TOKEN not set (Pflicht seit 1.4.0)" }
if ([string]::IsNullOrWhiteSpace($curseforgeProjectId)) { throw "CURSEFORGE_PROJECT_ID not set (Pflicht seit 1.4.0)" }

$hasCurseForge = $true

$pattern = "(?i)^Statusmod-$([Regex]::Escape($modVersion))-(fabric|forge|neoforge|quilt)-(\d+(?:\.\d+)*)\.jar$"

function Parse-JarName {
    param([string]$Name)
    $m = [regex]::Match($Name, $pattern)
    if (-not $m.Success) { return $null }
    return @($m.Groups[1].Value, $m.Groups[2].Value)
}

$jars = @(Get-ChildItem -Path $distDir -Recurse -File -Filter *.jar)
if ($jars.Count -eq 0) { throw "No JARs found under $distDir" }

# Fleet-Ausschluss (Release-Regel): Fleetmod-JARs duerfen NIE released werden.
# Sie leben unter dist/fleet und haben hier nichts zu suchen - Abbruch statt Skip.
$fleetStrays = @($jars | Where-Object { $_.Name -like "Fleetmod-*" })
if ($fleetStrays.Count -gt 0) { throw "Release-Stop: Fleetmod-JAR(s) unter dist/multiversion gefunden: $($fleetStrays[0].FullName) - Fleet wird nicht released" }

# Filter by Loaders parameter
if ($Loaders) {
    $allowedLoaders = $Loaders.Split(',').Trim().ToLower()
    $jars = @($jars | Where-Object {
        $parsed = Parse-JarName -Name $_.Name
        $parsed -and $allowedLoaders -contains $parsed[0]
    })
    Write-Host "Filtered to loaders: $($allowedLoaders -join ', ') → $($jars.Count) JARs"
}

# Filter by McVersions parameter
if ($McVersions) {
    $allowedVersions = $McVersions.Split(',').Trim()
    $jars = @($jars | Where-Object {
        $parsed = Parse-JarName -Name $_.Name
        $parsed -and $allowedVersions -contains $parsed[1]
    })
    Write-Host "Filtered to MC versions: $($allowedVersions -join ', ') → $($jars.Count) JARs"
}

if ($jars.Count -eq 0) { throw "No matching JARs after filtering" }

# --- CurseForge: resolve numeric game version IDs ---
$cfGameVersionCache = $null
function Get-CfVersionId {
    param([string]$Name)
    if ($null -eq $cfGameVersionCache) { return $null }
    # Die CF-Liste enthält doppelte Namen -> genau EINEN Eintrag nehmen,
    # sonst liefert $entry.id ein Array und List[int].Add() bricht ab.
    $entry = @($cfGameVersionCache | Where-Object { $_ -is [pscustomobject] -and $_.name -eq $Name }) | Select-Object -First 1
    if ($null -eq $entry) { return $null }
    return [int]$entry.id
}

if ($hasCurseForge) {
    try {
        Write-Host "Fetching CurseForge game versions..."
        $cfGameVersionCache = Invoke-RestMethod -Uri "https://minecraft.curseforge.com/api/game/versions" -Method Get `
            -Headers @{ "X-Api-Token" = $curseforgeToken } -ErrorAction Stop
        Write-Host "   OK ($($cfGameVersionCache.Count) versions)"
    } catch {
        throw "CurseForge game versions unerreichbar (Pflicht): $($_.Exception.Message)"
    }
}

# --- Modrinth: skip already-published ---
$existingVersions = @()
try {
    $existingVersions = Invoke-RestMethod -Uri "https://api.modrinth.com/v2/project/$modrinthProjectId/version" -Method Get `
        -Headers @{ "Authorization" = $modrinthToken } -ErrorAction SilentlyContinue
} catch { }
$existingVersionNumbers = New-Object System.Collections.Generic.HashSet[string]
if ($existingVersions -is [array]) {
    foreach ($v in $existingVersions) {
        $existingVersionNumbers.Add([string]$v.version_number) | Out-Null
    }
}

# --- publish ---
$ok = 0; $fail = 0; $skipped = 0

# Group jars by content hash: byte-identical files (e.g. one Forge build for
# all of 26.x) upload ONCE with the merged game versions. Duplicate uploads
# of the same bytes get rejected as copies during review (CurseForge).
$jarGroups = @{}
foreach ($jar in @($jars | Sort-Object Name)) {
    $parsed = Parse-JarName -Name $jar.Name
    if ($null -eq $parsed) { Write-Warning "Skipping unrecognized: $($jar.Name)"; continue }
    $h = (Get-FileHash -LiteralPath $jar.FullName -Algorithm SHA512).Hash
    if (-not $jarGroups.ContainsKey($h)) {
        $jarGroups[$h] = @{ file = $jar; mcs = @(); loader = $parsed[0] }
    }
    if ($jarGroups[$h].mcs -notcontains $parsed[1]) { $jarGroups[$h].mcs += $parsed[1] }
}

# Komprimiert sortierte MC-Liste zu exakten Ranges ("26.1-26.3",
# "1.21.11_26.1-26.3"). Modrinth begrenzt version_number auf 32 Zeichen
# (labrinth InitialVersionData), ausgeschriebene Merge-Listen sprengen das.
function Get-CompressedMcLabel([string[]]$sorted) {
    # Benachbarte Versionen (Patch+1 oder Minor+1 bei Patch 0) werden zu
    # Ranges ("26.1-26.3"), Lücken trennen mit "_" ("1.21.11_26.1-26.3").
    $parts = New-Object System.Collections.Generic.List[string]
    $start = $null; $prev = $null; $pr = $null
    foreach ($v in $sorted) {
        $m = [regex]::Match($v, '^(\d+)\.(\d+)(?:\.(\d+))?$')
        $cur = @([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, $(if ($m.Groups[3].Success) { [int]$m.Groups[3].Value } else { 0 }))
        $cont = $false
        if ($null -ne $prev) {
            if (($cur[0] -eq $pr[0] -and $cur[1] -eq $pr[1] -and $cur[2] -eq ($pr[2] + 1)) -or
                ($cur[0] -eq $pr[0] -and $cur[1] -eq ($pr[1] + 1) -and $cur[2] -eq 0)) { $cont = $true }
        }
        if ($null -eq $start) { $start = $v }
        elseif (-not $cont) {
            if ($start -eq $prev) { $parts.Add($start) } else { $parts.Add($start + "-" + $prev) }
            $start = $v
        }
        $prev = $v; $pr = $cur
    }
    if ($null -ne $start) {
        if ($start -eq $prev) { $parts.Add($start) } else { $parts.Add($start + "-" + $prev) }
    }
    return ($parts -join "_")
}

foreach ($group in $jarGroups.Values) {
    $jar = $group.file
    $loader = $group.loader
    $mcList = @($group.mcs | Sort-Object { [version]($_ -replace '[^\d.]', '') })
    $mcLabel = if ($mcList.Count -eq 1) { $mcList[0] } else { ($mcList -join ",") }
    $versionName = "StatusMod $modVersion ($loader $mcLabel)"
    # version_number <= 32 Zeichen (Modrinth-Limit, labrinth InitialVersionData):
    # exakte Range-Kompression ("26.1-26.3", "1.21.11_26.1-26.3").
    $versionNumber = "$modVersion+$loader+$(Get-CompressedMcLabel $mcList)"
    if ($versionNumber.Length -gt 32) {
        # Fallback: reine Spanne first-last (wie mods.toml-Ranges).
        $span = "$($mcList[0])-$($mcList[-1])"
        $versionNumber = "$modVersion+$loader+$span"
    }
    if ($versionNumber.Length -gt 32) {
        # Kein throw (wuergt alle restlichen Gruppen ab): pro Gruppe melden.
        Write-Warning "   version_number zu lang ($($versionNumber.Length)): $versionNumber"
        $fail++
        continue
    }
    $vType = if ($modVersion -match '-') { "beta" } else { "release" }

    # Skip if already published on Modrinth (CF wird trotzdem versucht,
    # sonst bliebe eine halbfertige Gruppe ewig halbfertig).
    $mrSkipped = $false
    if ($existingVersionNumbers.Contains($versionNumber)) {
        Write-Host "==> $versionName (already published, skipping)"
        $mrSkipped = $true
    }

    Write-Host "==> $versionName"

    # --- Modrinth (v2 API: POST /v2/version) ---
    $mrOk = $false
    if ($mrSkipped) {
        Write-Host "   Modrinth: bereits vorhanden"
    } else {
    $body = @{
        project_id = $modrinthProjectId
        file_parts = @("file")
        name = $versionName
        version_number = $versionNumber
        changelog = $changelog
        game_versions = @($mcList)
        version_type = $vType
        loaders = @($loader)
        featured = $false
        dependencies = @()
        primary_file = "file"
    }
    try {
        Write-Host "   Modrinth... ($mcLabel)"
        $response = Invoke-RestMethod -Uri "https://api.modrinth.com/v2/version" -Method Post `
            -Headers @{ "Authorization" = $modrinthToken } `
            -Form @{
                data = ($body | ConvertTo-Json -Depth 4 -Compress)
                file = $jar
            }
        Write-Host "   OK id=$($response.id)"
        $mrOk = $true
    } catch {
        # Body aus drei Kanaelen ziehen (PS7: ErrorDetails, sonst
        # HttpResponseMessage direkt oder in InnerExceptions bei EAP=Stop).
        $detail = $_.Exception.Message
        try {
            $errBody = $null
            if ($null -ne $_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace([string]$_.ErrorDetails.Message)) {
                $errBody = [string]$_.ErrorDetails.Message
            } else {
                $ex = $_.Exception
                while ($null -ne $ex) {
                    if ($ex.Response -is [System.Net.Http.HttpResponseMessage]) {
                        $r = $ex.Response
                        $b = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                        $errBody = "HTTP $([int]$r.StatusCode): $b"
                        break
                    }
                    $ex = $ex.InnerException
                }
            }
            if (-not [string]::IsNullOrWhiteSpace($errBody)) { $detail = $errBody }
        } catch { }
        Write-Warning "   Modrinth FAILED: $detail"
        Write-Warning "   Request war: version_number=$versionNumber loaders=$loader game_versions=$($mcList -join ',') datei=$($jar.Name) ($([int]($jar.Length/1KB))KB)"
        $fail++
        # Kein continue: CurseForge ist unabhaengig Pflicht und wird trotzdem versucht.
    }
    }

    # --- CurseForge (Pflicht seit 1.4.0) ---

    $cfOk = $false
    $cfGameVersions = New-Object System.Collections.Generic.List[int]
    # Pro Gruppe frisch: sonst zeigt die Fehlerdiagnose unten die Werte der
    # vorherigen Gruppe (PowerShell-Variablen leaken aus der Schleife).
    $mcId = $null
    $envId = $null
    $mcIds = @()
    foreach ($mcVersion in $mcList) {
        # Diagnose: alle Treffer pro Name zeigen (CF-Liste hat Dubletten).
        $hits = @($cfGameVersionCache | Where-Object { $_ -is [pscustomobject] -and $_.name -eq $mcVersion } | ForEach-Object { $_.id })
        $mcId = Get-CfVersionId -Name $mcVersion
        Write-Host "   CF mc '$mcVersion': $($hits.Count) Treffer [$($hits -join ',')], nutze $mcId"
        if ($mcId) { $cfGameVersions.Add($mcId); $mcIds += $mcId }
    }
    $loaderId = Get-CfVersionId -Name ($loader.Substring(0,1).ToUpper() + $loader.Substring(1))
    if (-not $loaderId) {
        $cfAliases = @{ "fabric" = "Fabric"; "forge" = "Forge"; "neoforge" = "NeoForge"; "quilt" = "Quilt" }
        $loaderId = Get-CfVersionId -Name $cfAliases[$loader]
    }
    if ($loaderId) { $cfGameVersions.Add($loaderId); Write-Host "   CF loader '$loader': id $loaderId" }
    # Env-Eintrag: exakter Name variiert ("Client and Server" existiert nicht
    # in der CF-Liste) -> erst Kombi-Namen, sonst Client+Server einzeln
    # (Superset-Deklaration). Fehlt alles, wirft der Code unten mit
    # ähnlichen Namen zur Selbstdiagnose.
    $envIds = @()
    foreach ($cand in @("Client and Server", "Client & Server", "Server and Client")) {
        $eid = Get-CfVersionId -Name $cand
        if ($eid) { Write-Host "   CF env: '$cand' (id $eid)"; $envIds = @($eid); break }
    }
    if ($envIds.Count -eq 0) {
        foreach ($cand in @("Client", "Server")) {
            $eid = Get-CfVersionId -Name $cand
            if ($eid) { Write-Host "   CF env: '$cand' (id $eid)"; $envIds += $eid }
        }
    }
    if ($envIds.Count -eq 0) {
        $similar = @($cfGameVersionCache | Where-Object { $_ -is [pscustomobject] -and ($_.name -match 'client|server') } | ForEach-Object { "$($_.name)=$($_.id)" } | Select-Object -Unique | Sort-Object | Select-Object -First 20) -join ', '
        Write-Warning "CurseForge: keine Env-Version gefunden (Kandidaten probiert). Ähnliche Einträge: $similar - Gruppe übersprungen"
        $fail++
        continue
    }
    foreach ($eid in $envIds) { $cfGameVersions.Add([int]$eid) }
    $envId = ($envIds -join ',')

    if ($cfGameVersions.Count -lt 3) {
        Write-Warning "CurseForge: game version IDs unvollständig (gefunden $($cfGameVersions.Count)/3; MC=$($mcIds -join ','), Loader=$loaderId, Env=$envId) - Gruppe übersprungen"
        $fail++
        continue
    }

    try {
        Write-Host "   CurseForge..."
        $cfMetadata = @{
            changelog = $changelog
            changelogType = "markdown"
            displayName = $versionName
            releaseType = $vType
            gameVersions = @($cfGameVersions)
        }
        $null = Invoke-RestMethod -Uri "https://minecraft.curseforge.com/api/projects/$curseforgeProjectId/upload-file" -Method Post `
            -Headers @{ "X-Api-Token" = $curseforgeToken } `
            -Form @{
                metadata = ($cfMetadata | ConvertTo-Json -Depth 4 -Compress)
                file = $jar
            }
        Write-Host "   CurseForge OK"
        $cfOk = $true
    } catch {
        $detail = $_.Exception.Message
        try {
            $errBody = $null
            if ($null -ne $_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace([string]$_.ErrorDetails.Message)) {
                $errBody = [string]$_.ErrorDetails.Message
            } else {
                $ex = $_.Exception
                while ($null -ne $ex) {
                    if ($ex.Response -is [System.Net.Http.HttpResponseMessage]) {
                        $r = $ex.Response
                        $b = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                        $errBody = "HTTP $([int]$r.StatusCode): $b"
                        break
                    }
                    $ex = $ex.InnerException
                }
            }
            if (-not [string]::IsNullOrWhiteSpace($errBody)) { $detail = $errBody }
        } catch { }
        # Datei steht bereits auf CF (Retry nach Teilerfolg) -> Skip statt Fail.
        # War Modrinth in DIESEM Lauf neu oben, zählt die Gruppe als ok.
        if ($detail -match '(?i)duplicat') {
            Write-Host "   CurseForge: bereits vorhanden, skipping"
            if ($mrOk) { $ok++ } else { $skipped++ }
            continue
        }
        $fail++
        Write-Warning "   CurseForge FAILED: $detail"
        continue
    }
    if (($mrOk -or $mrSkipped) -and $cfOk) { $ok++ }
}

Write-Host "Published: $ok, Skipped: $skipped, Failed: $fail"
if ($fail -gt 0) { exit 1 }
