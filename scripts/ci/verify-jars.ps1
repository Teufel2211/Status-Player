param()

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$modVersion = (Get-Content (Join-Path $root "version.txt") -Raw).Trim()
$distDir = Join-Path $root "dist\multiversion"

if (-not (Test-Path $distDir)) {
    throw "dist directory not found: $distDir"
}

$allJars = @(Get-ChildItem -Path $distDir -Recurse -File -Filter *.jar |
    Where-Object { $_.FullName -notmatch "\\.gradle-user-home\\|\\logs\\" })
if ($allJars.Count -eq 0) {
    throw "No JARs found under $distDir"
}

# Stale artifacts from older local builds must not make verification fail.
# CI starts with a clean dist directory, so this only affects local runs.
$versionPattern = "^Statusmod-$([Regex]::Escape($modVersion))-"
$jars = @($allJars | Where-Object { $_.Name -match $versionPattern })
$skipped = $allJars.Count - $jars.Count
if ($skipped -gt 0) {
    Write-Host "Skipping $skipped JAR(s) that are not Statusmod-$modVersion-*"
}
if ($jars.Count -eq 0) {
    throw "No Statusmod-$modVersion JARs found under $distDir"
}

$expected = @(
    "fabric-1.21.11", "fabric-26.3", "fabric-26.2", "fabric-26.1", "fabric-26.1.1", "fabric-26.1.2",
    "forge-1.21.11", "forge-26.3", "forge-26.2", "forge-26.1", "forge-26.1.1", "forge-26.1.2",
    "neoforge-1.21.11", "neoforge-26.3", "neoforge-26.2", "neoforge-26.1", "neoforge-26.1.1", "neoforge-26.1.2",
    "quilt-1.21.11", "quilt-26.3", "quilt-26.2", "quilt-26.1", "quilt-26.1.1", "quilt-26.1.2"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

$foundKeys = New-Object System.Collections.Generic.HashSet[string]
$errors = 0

$pattern = "(?i)^Statusmod-$([Regex]::Escape($modVersion))-(fabric|forge|neoforge|quilt)-(\d+(?:\.\d+)*)\.jar$"

foreach ($jar in $jars) {
    $relPath = $jar.FullName.Substring($distDir.Length).TrimStart("\")
    Write-Host "==> $relPath"

    $m = [regex]::Match($jar.Name, $pattern)
    if ($m.Success) {
        $loader = $m.Groups[1].Value.ToLowerInvariant()
        $mc = $m.Groups[2].Value
        $foundKeys.Add("$loader-$mc") | Out-Null
    }

    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($jar.FullName)
        try {
            $checked = $false
            foreach ($entry in $zip.Entries) {
                if ($entry.Name -eq "fabric.mod.json") {
                    $reader = [System.IO.StreamReader]::new($entry.Open())
                    $json = $reader.ReadToEnd() | ConvertFrom-Json
                    $reader.Close()
                    if ($json.version -ne $modVersion) {
                        throw "fabric.mod.json version is '$($json.version)', expected '$modVersion'"
                    }
                    Write-Host "   fabric.mod.json version=$($json.version) OK"
                    $checked = $true
                    break
                }
                if ($entry.Name -eq "quilt.mod.json") {
                    $reader = [System.IO.StreamReader]::new($entry.Open())
                    $json = $reader.ReadToEnd() | ConvertFrom-Json
                    $reader.Close()
                    if ($json.quilt_loader.version -ne $modVersion) {
                        throw "quilt.mod.json version is '$($json.quilt_loader.version)', expected '$modVersion'"
                    }
                    Write-Host "   quilt.mod.json version=$($json.quilt_loader.version) OK"
                    $checked = $true
                    break
                }
                if ($entry.Name -eq "mods.toml" -or $entry.Name -eq "neoforge.mods.toml") {
                    $reader = [System.IO.StreamReader]::new($entry.Open())
                    $content = $reader.ReadToEnd()
                    $reader.Close()
                    if ($content -match '\bversion\s*=\s*"([^"]+)"') {
                        $v = $matches[1]
                        if ($v -ne $modVersion) {
                            throw "$($entry.Name) version is '$v', expected '$modVersion'"
                        }
                        Write-Host "   $($entry.Name) version=$v OK"
                        $checked = $true
                        break
                    }
                }
            }
            if (-not $checked) {
                Write-Warning "   no version metadata found in JAR"
                $errors++
            }
        } finally {
            $zip.Dispose()
        }
    } catch {
        Write-Warning "   FAIL: $($_.Exception.Message)"
        $errors++
    }
}

$missed = $expected | Where-Object { -not $foundKeys.Contains($_) }
if ($missed.Count -gt 0) {
    Write-Warning "Missing combinations: $($missed -join ', ')"
    $errors += $missed.Count
}

if ($errors -gt 0) {
    throw "$errors JAR(s) failed verification"
}

Write-Host "All $($jars.Count) JARs verified OK (version=$modVersion)"
