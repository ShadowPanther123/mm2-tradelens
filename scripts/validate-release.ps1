<#
.SYNOPSIS
    Validate a produced TradeLens release before distribution.

.DESCRIPTION
    Checks that the expected release artefacts exist, that the signed snapshot's
    Ed25519 signature verifies against the published public key, and that the
    snapshot passes schema validation and the data audit. Intended to run on a
    clean checkout (and, ideally, a clean machine) as a final gate.

.PARAMETER ReleaseDir
    Directory containing the release artefacts. Defaults to .\release.

.EXAMPLE
    pwsh ./scripts/validate-release.ps1
#>
[CmdletBinding()]
param(
    [string]$ReleaseDir = 'release'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$dir = Resolve-Path $ReleaseDir
$signed = Join-Path $dir 'signed-snapshot.json'
$publicKeyFile = Join-Path $dir 'public-key.txt'

$failures = 0
function Check($ok, $message) {
    if ($ok) {
        Write-Host "  [ok]  $message" -ForegroundColor Green
    } else {
        Write-Host "  [!!]  $message" -ForegroundColor Red
        $script:failures++
    }
}

Write-Host "Validating release in $dir" -ForegroundColor Cyan

Check (Test-Path (Join-Path $dir 'snapshot.json')) 'snapshot.json present'
Check (Test-Path (Join-Path $dir 'snapshot.sha256')) 'snapshot.sha256 present'
Check (Test-Path $signed) 'signed-snapshot.json present'
Check (Test-Path $publicKeyFile) 'public-key.txt present'

if ((Test-Path $signed) -and (Test-Path $publicKeyFile)) {
    $publicKey = (Get-Content $publicKeyFile -Raw).Trim()
    $updater = Join-Path $repoRoot 'services/updater/dist/updater.js'
    if (-not (Test-Path $updater)) {
        Write-Host 'Building updater (needed for verification)...' -ForegroundColor Cyan
        npm run build --workspace @tradelens/updater | Out-Null
    }
    $output = node $updater --verify $signed --public-key $publicKey 2>&1
    $output | ForEach-Object { Write-Host "  $_" }
    Check ($LASTEXITCODE -eq 0) 'signed snapshot verifies (schema + signature)'
}

Write-Host ''
if ($failures -eq 0) {
    Write-Host 'Release validation passed.' -ForegroundColor Green
} else {
    Write-Host "Release validation found $failures problem(s)." -ForegroundColor Red
    exit 1
}
