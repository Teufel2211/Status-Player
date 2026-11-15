<#
.SYNOPSIS
    Stempelt den internen Build-Fingerprint in fertige Mod-JARs.

.DESCRIPTION
    Schreibt "statusmod-build.txt" (einzeilig, UTF-8 ohne BOM) in das JAR-Root:

        <version>-<loader>-<mc>-<sha8>

    sha8 = erste 8 Zeichen des SHA-256 ueber die JAR-Datei VOR dem Stempeln.
    Ein bereits vorhandener Stempel wird vorher entfernt, damit derselbe Build
    beim erneuten Lauf denselben Wert bekommt.

    Der Fingerprint landet ausschliesslich im JAR: nicht im Dateinamen, nicht in
    den Loader-Metadaten, nicht in GUI/Chat. StatusMod.BUILD_ID liest ihn beim
    Start aus der Ressource.

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
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$entryName = "statusmod-build.txt"

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

    # Bestehenden Stempel entfernen -> Hash beschreibt das ungestempelte JAR.
    $zip = [System.IO.Compression.ZipFile]::Open($jarPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $existing = $zip.GetEntry($entryName)
        if ($existing) { $existing.Delete() }
    } finally {
        $zip.Dispose()
    }

    $sha = (Get-FileHash -LiteralPath $jarPath -Algorithm SHA256).Hash.ToLowerInvariant()
    return "$version-$loader-$mc-$($sha.Substring(0, 8))"
}

function Set-Stamp([string]$jarPath) {
    $stamp = Get-StampValue $jarPath

    $zip = [System.IO.Compression.ZipFile]::Open($jarPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding($false)))
            $writer.Write($stamp + "`n")
            $writer.Flush()
        } finally {
            $stream.Dispose()
        }
    } finally {
        $zip.Dispose()
    }

    [pscustomobject]@{
        Jar     = [System.IO.Path]::GetFileName($jarPath)
        BuildId = $stamp
    }
}

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

$results = foreach ($t in $targets) { Set-Stamp $t }
$results | Format-Table -AutoSize | Out-String | Write-Host
Write-Host ("Stamped {0} JAR(s)." -f @($results).Count)
