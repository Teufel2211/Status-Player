param(
    [string]$DistDir = "dist\multiversion",
    # CI setzt das nach dem Signierschritt: dann muss jedes JAR ein gueltiges
    # Build-Attest haben. Lokal (unobfuskierte Dev-Builds) wird das Attest nur
    # geprueft, wenn es vorhanden ist.
    [switch]$RequireAttest
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$modVersion = (Get-Content (Join-Path $root "version.txt") -Raw).Trim()
$distDir = if ([IO.Path]::IsPathRooted($DistDir)) { $DistDir } else { Join-Path $root $DistDir }

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
$attestedJars = New-Object System.Collections.Generic.List[string]

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

            # Release-Ressourcen: Build-Fingerprint (A2) + Lizenz-Kurzfassung (A1).
            $buildId = $null
            $hasLicense = $false
            foreach ($entry in $zip.Entries) {
                if ($entry.Name -eq "statusmod-build.txt") {
                    $reader = [System.IO.StreamReader]::new($entry.Open())
                    $buildId = $reader.ReadToEnd().Trim()
                    $reader.Close()
                } elseif ($entry.Name -eq "statusmod-license.txt") {
                    $hasLicense = $true
                }
            }

            if ([string]::IsNullOrWhiteSpace($buildId)) {
                Write-Warning "   FAIL: statusmod-build.txt missing or empty"
                $errors++
            } else {
                $expectedBuildId = "^$([Regex]::Escape($modVersion))-[a-z]+-[0-9.]+-[0-9a-f]{8}$"
                if ($buildId -match $expectedBuildId) {
                    Write-Host "   statusmod-build.txt $buildId OK"
                } else {
                    Write-Warning "   FAIL: statusmod-build.txt has unexpected value '$buildId'"
                    $errors++
                }
            }

            if (-not $hasLicense) {
                Write-Warning "   FAIL: statusmod-license.txt missing"
                $errors++
            }

            # Echtheitsnachweis: signiertes Build-Manifest (statusmod-attest.json
            # + statusmod-attest.sig, beide im JAR-Root). Die kryptografische
            # Pruefung laeuft gesammelt nach der Schleife.
            $attestJson = $null
            $attestSigBytes = -1
            foreach ($entry in $zip.Entries) {
                if ($entry.Name -eq "statusmod-attest.json") {
                    $reader = [System.IO.StreamReader]::new($entry.Open())
                    $attestJson = $reader.ReadToEnd()
                    $reader.Close()
                } elseif ($entry.Name -eq "statusmod-attest.sig") {
                    $attestSigBytes = $entry.Length
                }
            }

            if (-not [string]::IsNullOrEmpty($attestJson) -or $attestSigBytes -ge 0) {
                if ([string]::IsNullOrEmpty($attestJson) -or $attestSigBytes -le 0) {
                    Write-Warning "   FAIL: incomplete build attest (json and sig must both be present)"
                    $errors++
                } else {
                    $attest = $attestJson | ConvertFrom-Json
                    if ($attest.build_id -ne $buildId) {
                        Write-Warning "   FAIL: attest build_id '$($attest.build_id)' does not match statusmod-build.txt '$buildId'"
                        $errors++
                    } elseif ([string]::IsNullOrEmpty($attest.key_id)) {
                        Write-Warning "   FAIL: attest has no key_id"
                        $errors++
                    } else {
                        Write-Host "   build attest build_id=$($attest.build_id) key=$($attest.key_id) OK"
                        $attestedJars.Add($jar.FullName) | Out-Null
                    }
                }
            } elseif ($RequireAttest) {
                Write-Warning "   FAIL: build attest missing (statusmod-attest.json)"
                $errors++
            } else {
                Write-Host "   build attest not present (unsigned build, use -RequireAttest to enforce)"
            }
        } finally {
            $zip.Dispose()
        }
    } catch {
        Write-Warning "   FAIL: $($_.Exception.Message)"
        $errors++
    }
}

# Kryptografische Pruefung der Build-Attests (Ed25519 + Inhalts-Hashes) mit
# derselben Implementierung, die auch die Mod beim Start nutzt.
if ($attestedJars.Count -gt 0) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        if ($RequireAttest) {
            Write-Warning "FAIL: node is required to verify build attest"
            $errors += $attestedJars.Count
        } else {
            Write-Warning "node not found - skipping build attest signature check"
        }
    } else {
        Write-Host "==> Verifying build attest signatures ($($attestedJars.Count) JARs)"
        $signScript = Join-Path $root "scripts\ci\sign-build.mjs"
        $nodeArgs = @($signScript, "--verify")
        foreach ($attested in $attestedJars) { $nodeArgs += @("--jar", $attested) }
        # node schreibt Fehler nach stderr; PS 5.1 macht daraus unter
        # ErrorActionPreference=Stop eine terminierende Exception, bevor der
        # Exit-Code geprueft werden kann.
        $prevEap = $ErrorActionPreference
        $nodeExit = 0
        Push-Location $root
        try {
            $ErrorActionPreference = "Continue"
            & node @nodeArgs 2>&1 | ForEach-Object { Write-Host "   $_" }
            $nodeExit = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEap
            Pop-Location
        }
        if ($nodeExit -ne 0) {
            Write-Warning "   FAIL: build attest verification failed"
            $errors++
        }
    }
} elseif ($RequireAttest) {
    Write-Warning "FAIL: no JAR carries a build attest"
    $errors++
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
