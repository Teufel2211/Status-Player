# Laedt die ProGuard-Toolchain (7.10.0 + Dependencies) fuer die A4-Obfuskation
# in ein Zielverzeichnis. Jede Datei wird gegen einen festen SHA256 geprueft;
# bereits vorhandene, gueltige Dateien werden nicht erneut geladen.
#
# Wird von .github/workflows/build.yml und fuer lokale Reproduktionen genutzt.
param(
    [string]$TargetDir = "$env:TEMP\opencode\proguard"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$artifacts = @(
    @{ Name = "proguard-base-7.10.0.jar"; Url = "https://repo1.maven.org/maven2/com/guardsquare/proguard-base/7.10.0/proguard-base-7.10.0.jar"; Sha256 = "022854EB4C6F4BD761B2E3FF19D832E98227FF498FD8FCC788B313F55810A555" },
    @{ Name = "proguard-core-9.4.0.jar"; Url = "https://repo1.maven.org/maven2/com/guardsquare/proguard-core/9.4.0/proguard-core-9.4.0.jar"; Sha256 = "7AF7C47C173711ACA9EDEE7482EC27B33EB0A20345279D88022CB34F71710407" },
    @{ Name = "gson-2.11.0.jar"; Url = "https://repo1.maven.org/maven2/com/google/code/gson/gson/2.11.0/gson-2.11.0.jar"; Sha256 = "57928D6E5A6EDEB2ABD3770A8F95BA44DCE45F3B23B7A9DC2B309C581552A78B" },
    @{ Name = "json-20231013.jar"; Url = "https://repo1.maven.org/maven2/org/json/json/20231013/json-20231013.jar"; Sha256 = "0F18192DF289114E17AA1A0D0A7F8372CC9F5C7E4F7E39ADCF8906FE714FA7D3" },
    @{ Name = "kotlin-stdlib-2.4.0.jar"; Url = "https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.4.0/kotlin-stdlib-2.4.0.jar"; Sha256 = "CCB14FF83FABCB11458B798DBC9824748CCDFFEEC79C9ABA789E6ED1CDA86B1C" },
    @{ Name = "log4j-api-2.26.1.jar"; Url = "https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-api/2.26.1/log4j-api-2.26.1.jar"; Sha256 = "F1810A4704CCCE019D02BBA029DC02A4F2AC0C997F647B465E7D409C1927F822" },
    @{ Name = "log4j-core-2.26.1.jar"; Url = "https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-core/2.26.1/log4j-core-2.26.1.jar"; Sha256 = "2EC8C3BF5A6D7C89BE8620116A2FC973F7DDA1AD0261AD393C4D4726EDFD3DCB" },
    # ASM wird nur von ObfuscateRemap.java benutzt. Ohne diese Kopien haengt A4 am
    # Gradle-Modul-Cache, der auf einem frischen CI-Runner (kalter Cache) fehlen kann.
    @{ Name = "asm\asm-9.10.1.jar"; Url = "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar"; Sha256 = "ED825D10AB1399C8C0CB669E688CF0C8C82629B4C8399B58352B68E92CA10FCB" },
    @{ Name = "asm\asm-commons-9.10.1.jar"; Url = "https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.10.1/asm-commons-9.10.1.jar"; Sha256 = "6D0ABEFB7CBF972EA16EDB37EC14835372505063A45F976AB7EA889ED9497895" },
    @{ Name = "asm\asm-tree-9.10.1.jar"; Url = "https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.10.1/asm-tree-9.10.1.jar"; Sha256 = "3DFB0D5B6A106CD40B5B250E39935FBF2F927F4477546A5369A3AC609CF0506B" }
)

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

foreach ($a in $artifacts) {
    $path = Join-Path $TargetDir $a.Name
    $parent = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if (Test-Path -LiteralPath $path) {
        $existing = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        if ($existing -eq $a.Sha256) {
            Write-Host "OK (cached): $($a.Name)"
            continue
        }
        Write-Host "Hash mismatch, re-downloading: $($a.Name)"
        Remove-Item -LiteralPath $path -Force
    }

    $tmp = "$path.download"
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $a.Url -OutFile $tmp -TimeoutSec 120 -UseBasicParsing
            break
        } catch {
            if ($attempt -eq 3) { throw "Download failed: $($a.Url) - $($_.Exception.Message)" }
            Start-Sleep -Seconds (5 * $attempt)
        }
    }

    $hash = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash
    if ($hash -ne $a.Sha256) {
        Remove-Item -LiteralPath $tmp -Force
        throw "SHA256 mismatch for $($a.Name): got $hash, expected $($a.Sha256)"
    }
    Move-Item -LiteralPath $tmp -Destination $path -Force
    Write-Host "Downloaded: $($a.Name)"
}

Write-Host "ProGuard toolchain ready: $TargetDir"
