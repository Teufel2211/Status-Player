<#
.SYNOPSIS
    Stempelt den internen Build-Fingerprint in fertige Mod-JARs.

.DESCRIPTION
    Schreibt "statusmod-build.txt" (einzeilig, UTF-8 ohne BOM) in das JAR-Root:

        <version>-<loader>-<mc>-<sha8>

    sha8 = erste 8 Zeichen eines SHA-256 ueber den INHALT des JARs (siehe
    unten), nicht ueber die Datei-Bytes. Damit ist der Wert unabhaengig davon,
    wie das JAR gepackt wurde, und ein erneutes Stempeln ergibt denselben Wert.

    Der Fingerprint landet ausschliesslich im JAR: nicht im Dateinamen, nicht in
    den Loader-Metadaten, nicht in GUI/Chat. StatusMod.BUILD_ID liest ihn beim
    Start aus der Ressource.

    Warum kein .NET-ZIP mehr (Ursache des CI-Fehlschlags 2026-11-15):
    Jar-Archive, die "jar.exe" schreibt, markieren ihre Eintraege mit
    Datenbeschreibern (Flag 0x808). Der Update-Modus von
    System.IO.Compression.ZipArchive kam damit auf dem CI-Runner nicht klar
    ("A local file header is corrupt"), lokal aber schon. Deshalb laeuft das
    Schreiben jetzt komplett ueber das jar-Tool des JDK, und der Hash wird aus
    dem ZIP-Zentralverzeichnis gelesen (ohne ZIP-Bibliothek).

    Ablauf pro JAR:
      1. Kopie anlegen (<jar>.stamp-tmp) - das Original bleibt unangetastet.
      2. Stempelwert aus dem Zentralverzeichnis der Kopie berechnen.
      3. "jar --update" schreibt/ersetzt statusmod-build.txt in der Kopie.
      4. Kontrolle: genau ein Stempel-Eintrag, Inhalt identisch.
      5. Kopie atomar ueber das Original schieben.

.PARAMETER Jar
    Ein oder mehrere JAR-Pfade.

.PARAMETER OutputDir
    Statt -Jar: alle Statusmod-*.jar unter diesem Ordner stempeln.

.EXAMPLE
    .\scripts\local\stamp-build.ps1 -OutputDir dist/multiversion
#>
[CmdletBinding(DefaultParameterSetName = "Dir")]
param(
    [Parameter(ParameterSetName = "Jar", Mandatory = $true)]
    [string[]]$Jar,

    [Parameter(ParameterSetName = "Dir", Mandatory = $true)]
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$entryName = "statusmod-build.txt"

function Resolve-JarTool {
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME "bin\jar.exe"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $cmd = Get-Command jar -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    throw "jar.exe nicht gefunden: JAVA_HOME setzen oder <JDK>\bin in den PATH legen."
}

# Liest das ZIP-Zentralverzeichnis (EOCD + Eintraege) ohne ZIP-Bibliothek.
# Liefert pro Eintrag Name, Methode, CRC32 und Groessen - genug fuer einen
# stabilen Inhalts-Digest.
function Read-CentralDirectory([string]$path) {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $len = $fs.Length
        if ($len -lt 22) { throw "Datei ist zu klein fuer ein ZIP-Archiv: $path" }

        $tailLen = [int][Math]::Min($len, 22 + 65535)
        $tail = New-Object byte[] $tailLen
        [void]$fs.Seek($len - $tailLen, [System.IO.SeekOrigin]::Begin)
        $read = 0
        while ($read -lt $tailLen) {
            $n = $fs.Read($tail, $read, $tailLen - $read)
            if ($n -le 0) { break }
            $read += $n
        }

        $eocd = -1
        for ($i = $read - 22; $i -ge 0; $i--) {
            if ($tail[$i] -eq 0x50 -and $tail[$i + 1] -eq 0x4b -and $tail[$i + 2] -eq 0x05 -and $tail[$i + 3] -eq 0x06) {
                $eocd = $i
                break
            }
        }
        if ($eocd -lt 0) { throw "ZIP-Endverzeichnis (EOCD) nicht gefunden: $path" }

        $count = [BitConverter]::ToUInt16($tail, $eocd + 10)
        $cdSize = [BitConverter]::ToUInt32($tail, $eocd + 12)
        $cdOff = [BitConverter]::ToUInt32($tail, $eocd + 16)
        if ($count -eq 0xFFFF -or $cdSize -eq 0xFFFFFFFF -or $cdOff -eq 0xFFFFFFFF) {
            throw "ZIP64 wird nicht unterstuetzt: $path"
        }

        $cd = New-Object byte[] $cdSize
        [void]$fs.Seek($cdOff, [System.IO.SeekOrigin]::Begin)
        $read = 0
        while ($read -lt $cdSize) {
            $n = $fs.Read($cd, $read, $cdSize - $read)
            if ($n -le 0) { break }
            $read += $n
        }
        if ($read -ne $cdSize) { throw "Zentralverzeichnis unvollstaendig ($read/$cdSize): $path" }

        $entries = New-Object System.Collections.Generic.List[object]
        $p = 0
        for ($n = 0; $n -lt $count; $n++) {
            if ($p + 46 -gt $cdSize -or [BitConverter]::ToUInt32($cd, $p) -ne 0x02014b50) {
                throw "Zentralverzeichnis beschaedigt (Eintrag $n): $path"
            }
            $nameLen = [BitConverter]::ToUInt16($cd, $p + 28)
            $extraLen = [BitConverter]::ToUInt16($cd, $p + 30)
            $commentLen = [BitConverter]::ToUInt16($cd, $p + 32)
            $entries.Add([pscustomobject]@{
                    Name             = [System.Text.Encoding]::UTF8.GetString($cd, $p + 46, $nameLen)
                    Method           = [BitConverter]::ToUInt16($cd, $p + 10)
                    Crc32            = [BitConverter]::ToUInt32($cd, $p + 16)
                    CompressedSize   = [BitConverter]::ToUInt32($cd, $p + 20)
                    UncompressedSize = [BitConverter]::ToUInt32($cd, $p + 24)
                })
            $p += 46 + $nameLen + $extraLen + $commentLen
        }
        return $entries
    } finally {
        $fs.Dispose()
    }
}

# Inhalts-Digest: sortierte Liste (Name, Methode, CRC32, Groessen) aller
# Eintraege OHNE den Stempel selbst. Bewusst nicht die Datei-Bytes: ein
# erneutes Stempeln schreibt das JAR neu, die Bytes aendern sich dabei, der
# Inhalt nicht.
function Get-StampValue([string]$jarPath) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($jarPath)
    # Statusmod-<version>-<loader>-<mc>
    $m = [regex]::Match($name, '^Statusmod-(?<version>[^-]+)-(?<loader>[^-]+)-(?<mc>.+)$', 'IgnoreCase')
    if (-not $m.Success) {
        throw "Unerwarteter JAR-Name (erwartet Statusmod-<version>-<loader>-<mc>.jar): $name"
    }
    $version = $m.Groups["version"].Value
    $loader = $m.Groups["loader"].Value.ToLowerInvariant()
    $mc = $m.Groups["mc"].Value

    $entries = Read-CentralDirectory $jarPath
    $lines = $entries |
        Where-Object { $_.Name -ne $entryName } |
        Sort-Object -Property Name -CaseSensitive |
        ForEach-Object { "{0}|{1}|{2}|{3}|{4}" -f $_.Name, $_.Method, $_.Crc32, $_.CompressedSize, $_.UncompressedSize }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]::Join("`n", @($lines))))
    } finally {
        $sha.Dispose()
    }
    $hex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    return "$version-$loader-$mc-$($hex.Substring(0, 8))"
}

function Invoke-JarTool([string]$jarTool, [string[]]$arguments) {
    $output = & $jarTool @arguments 2>&1
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "jar $($arguments -join ' ') fehlgeschlagen (Exit $code): $($output -join ' ')"
    }
}

function Set-Stamp([string]$jarPath, [string]$jarTool) {
    $stamp = Get-StampValue $jarPath
    $work = "$jarPath.stamp-tmp"
    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("statusmod-stamp-" + [guid]::NewGuid().ToString("N"))
    $checkDir = Join-Path $tmpDir "check"

    try {
        Copy-Item -LiteralPath $jarPath -Destination $work -Force
        New-Item -ItemType Directory -Force -Path $tmpDir, $checkDir | Out-Null

        # UTF-8 ohne BOM, eine Zeile mit Abschluss (wie bisher).
        [System.IO.File]::WriteAllText((Join-Path $tmpDir $entryName), $stamp + "`n", (New-Object System.Text.UTF8Encoding($false)))
        Invoke-JarTool $jarTool @("--update", "--file", $work, "-C", $tmpDir, $entryName)

        # Kontrolle 1: genau ein Stempel-Eintrag (kein Duplikat durch --update).
        $stampEntries = @(Read-CentralDirectory $work | Where-Object { $_.Name -eq $entryName })
        if ($stampEntries.Count -ne 1) {
            throw "JAR enthaelt $($stampEntries.Count)x $entryName (erwartet 1)"
        }

        # Kontrolle 2: Inhalt im JAR == berechneter Stempel.
        Push-Location $checkDir
        try {
            Invoke-JarTool $jarTool @("--extract", "--file", $work, $entryName)
            $actual = [System.IO.File]::ReadAllText((Join-Path $checkDir $entryName)).TrimEnd("`r", "`n")
        } finally {
            Pop-Location
        }
        if ($actual -ne $stamp) {
            throw "Stempel im JAR weicht ab: '$actual' != '$stamp'"
        }

        Move-Item -LiteralPath $work -Destination $jarPath -Force

        [pscustomobject]@{
            Jar     = [System.IO.Path]::GetFileName($jarPath)
            BuildId = $stamp
        }
    } finally {
        if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$jarTool = Resolve-JarTool

$targets = @()
if ($PSCmdlet.ParameterSetName -eq "Jar") {
    $targets = $Jar | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }
} else {
    $root = Resolve-Path -LiteralPath $OutputDir
    $targets = Get-ChildItem -LiteralPath $root.Path -Filter "Statusmod-*.jar" -File -Recurse |
        Where-Object { $_.Name -notlike "*-sources.jar" } |
        ForEach-Object { $_.FullName }
}

if (-not $targets -or $targets.Count -eq 0) {
    throw "Keine JARs zum Stempeln gefunden."
}

Write-Host ("Stamping {0} JAR(s) with {1} ..." -f $targets.Count, $jarTool)
# Namen vorab listen: scheitert das Stempeln, ist sonst nicht nachvollziehbar,
# welche Dateien ueberhaupt gefunden wurden (dist kann Altstaende enthalten).
$targets | ForEach-Object { Write-Host ("  target: {0} ({1} bytes)" -f $_, (Get-Item -LiteralPath $_).Length) }
$results = foreach ($t in $targets) {
    # Ein einzelner Fehlversuch darf den Release nicht kippen (transiente
    # Datei-/Virenscanner-Locks auf dem Runner). Das Original wird erst am Ende
    # ersetzt, ein Fehlversuch hinterlaesst also nie ein halb geschriebenes JAR.
    $attempt = 0
    while ($true) {
        $attempt++
        try {
            Set-Stamp $t $jarTool
            break
        } catch {
            if ($attempt -ge 3) {
                throw "Stempeln fehlgeschlagen fuer '$t' nach $attempt Versuchen: $($_.Exception.Message)"
            }
            Write-Host ("  WARN: Stempeln von '{0}' fehlgeschlagen (Versuch {1}/3): {2}" -f $t, $attempt, $_.Exception.Message)
            Start-Sleep -Milliseconds 750
        }
    }
}
$results | Format-Table -AutoSize | Out-String | Write-Host
Write-Host ("Stamped {0} JAR(s)." -f @($results).Count)
