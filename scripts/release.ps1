<#
.SYNOPSIS
    Produce a clean, signed TradeLens desktop release.

.DESCRIPTION
    Runs the full quality gate (typecheck + tests), builds every workspace,
    produces a signed value snapshot, and builds the Tauri desktop installer.

    Code-signing the installer itself requires a certificate you supply via
    Tauri's bundle configuration / environment; this script does not fabricate
    or embed any certificate.

.PARAMETER SigningKey
    Path to the Ed25519 snapshot signing private key (PEM). If omitted, a fresh
    key is generated into .\release\ (use only for local/dev builds).

.PARAMETER KeyId
    Identifier recorded alongside the signature. Defaults to today's date.

.PARAMETER SkipTauri
    Skip the (slow, toolchain-heavy) Tauri build and only produce web + service
    artefacts and the signed snapshot.

.EXAMPLE
    pwsh ./scripts/release.ps1 -SigningKey .\release\signing.pem -KeyId 2026-07
#>
[CmdletBinding()]
param(
    [string]$SigningKey,
    [string]$KeyId = (Get-Date -Format 'yyyy-MM-dd'),
    [switch]$SkipTauri
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$releaseDir = Join-Path $repoRoot 'release'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

function Step($message) { Write-Host "`n=== $message ===" -ForegroundColor Cyan }

Step 'Installing dependencies'
npm install

Step 'Typechecking all workspaces'
npm run typecheck

Step 'Running test suites'
npm test

Step 'Building all workspaces'
npm run build

# Ensure we have a signing key. Generate one for local builds if none provided.
if (-not $SigningKey) {
    Step 'Generating a snapshot signing key (development)'
    node services/updater/dist/updater.js --keygen --key-id $KeyId --out $releaseDir
    $SigningKey = Join-Path $releaseDir 'signing.pem'
    Write-Warning 'Generated a fresh signing key. For production, reuse a securely stored key.'
}

Step 'Producing signed value snapshot'
node services/updater/dist/updater.js --key $SigningKey --key-id $KeyId --out $releaseDir --fail-on-audit
Write-Host "Public key (bundle into the client as VITE_SNAPSHOT_PUBLIC_KEY):"
Get-Content (Join-Path $releaseDir 'public-key.txt') -ErrorAction SilentlyContinue

if ($SkipTauri) {
    Step 'Skipping Tauri build (--SkipTauri)'
    Write-Host 'Release artefacts written to' $releaseDir -ForegroundColor Green
    return
}

Step 'Building Tauri desktop installer'
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Warning 'cargo not found on PATH — install the Rust toolchain to build the desktop installer.'
    Write-Host 'Web + service artefacts and the signed snapshot are ready in' $releaseDir
    return
}
npm run tauri --workspace @tradelens/desktop -- build

Step 'Publishing installer checksums'
$bundleDir = Join-Path $repoRoot 'apps/desktop/src-tauri/target/release/bundle'
$checksumFile = Join-Path $releaseDir 'SHA256SUMS.txt'
if (Test-Path $bundleDir) {
    $installers = Get-ChildItem -Path $bundleDir -Recurse -Include *.exe, *.msi -ErrorAction SilentlyContinue
    if ($installers) {
        $installers |
            Get-FileHash -Algorithm SHA256 |
            ForEach-Object { "{0}  {1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } |
            Set-Content -Path $checksumFile -Encoding ascii
        Write-Host 'Installer SHA-256 checksums written to' $checksumFile -ForegroundColor Green
        Get-Content $checksumFile

        # Sign the checksum manifest with the same Ed25519 key so release metadata
        # is tamper-evident alongside the installer. Skipped when no key is given.
        if ($SigningKey) {
            node services/updater/dist/updater.js --sign-file $checksumFile --key $SigningKey --key-id $KeyId
            Write-Host 'Signed checksum manifest ->' "$checksumFile.sig.json" -ForegroundColor Green
        } else {
            Write-Warning 'No signing key provided; SHA256SUMS.txt left unsigned.'
        }
    } else {
        Write-Warning 'No .exe/.msi installer found to checksum.'
    }
} else {
    Write-Warning "Bundle directory not found ($bundleDir); skipping checksums."
}

Step 'Done'
Write-Host 'Release artefacts written to' $releaseDir -ForegroundColor Green
Write-Host 'Installer output is under apps/desktop/src-tauri/target/release/bundle/.'
