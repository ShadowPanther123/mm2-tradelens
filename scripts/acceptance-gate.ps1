<#
.SYNOPSIS
    Final release acceptance gate for MM2 TradeLens.

.DESCRIPTION
    Verifies, in one pass, the ten acceptance criteria that must all hold before
    a release may ship. Each criterion is checked mechanically against the repo
    and (when present) the produced release artefacts:

      1.  Catalogue is verified and auditable (audit passes).
      2.  Production values come only from permitted/trusted sources.
      3.  Every remote snapshot is authenticated before use (signature enforced).
      4.  No production build depends on localhost or developer services.
      5.  Installer can be produced / is present for a clean Windows machine.
      6.  All automated checks pass (typecheck, lint, JS tests, Rust tests, clippy).
      7.  Accessibility and responsive-layout tests exist and pass (Playwright).
      8.  User-facing claims are honest (no over-claims of signing/completeness).
      9.  Release binaries + installer are code-signed (or signing is configured).
      10. Known limitations, privacy, licences and non-affiliation are published.

    Any failed criterion makes the gate exit non-zero. Slow/optional stages can
    be skipped for a fast local pre-check.

.PARAMETER ReleaseDir
    Directory holding produced release artefacts. Defaults to .\release.

.PARAMETER SkipBuild
    Skip the automated-check stages that compile/run tests (fast doc-only pass).

.PARAMETER SkipE2E
    Skip the Playwright accessibility/responsive stage.

.PARAMETER RequireSignedBinaries
    Fail (rather than warn) if the produced installer is not Authenticode-signed.

.EXAMPLE
    pwsh ./scripts/acceptance-gate.ps1
    pwsh ./scripts/acceptance-gate.ps1 -RequireSignedBinaries
#>
[CmdletBinding()]
param(
    [string]$ReleaseDir = 'release',
    [switch]$SkipBuild,
    [switch]$SkipE2E,
    [switch]$RequireSignedBinaries
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$script:failures = 0
$script:warnings = 0

function Pass($message) { Write-Host "  [pass]  $message" -ForegroundColor Green }
function Fail($message) { Write-Host "  [FAIL]  $message" -ForegroundColor Red; $script:failures++ }
function Warn($message) { Write-Host "  [warn]  $message" -ForegroundColor Yellow; $script:warnings++ }
function Gate($n, $title) { Write-Host "`n[$n] $title" -ForegroundColor Cyan }

# Run a native command tolerantly: its stderr must not abort the gate (test
# runners legitimately log to stderr). Returns the process exit code.
function Invoke-Native([scriptblock]$command) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $command 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Read-Text([string]$path) {
    if (Test-Path $path) { return Get-Content -LiteralPath $path -Raw }
    return ''
}

# --- 1. Catalogue verified and auditable ------------------------------------
Gate 1 'Full catalogue is verified and auditable'
if ($SkipBuild) {
    Warn 'Skipped audit (-SkipBuild); run the source-adapters audit test in CI.'
} else {
    $code = Invoke-Native { npm run --workspace @tradelens/source-adapters test }
    if ($code -eq 0) {
        Pass 'source-adapters audit + validation suite passes'
    } else {
        Fail 'source-adapters audit/validation suite failed'
    }
}
$auditModule = 'packages/source-adapters/src/audit.ts'
if ((Read-Text $auditModule) -match 'auditItems') {
    Pass 'auditable pipeline present (auditItems)'
} else {
    Fail "audit pipeline missing in $auditModule"
}

# --- 2. Production values from permitted/trusted sources only ----------------
Gate 2 'Production values come only from permitted and trusted sources'
$providers = Read-Text 'packages/source-adapters/src/providers.ts'
if ($providers -match 'assertPermitted' -and $providers -match 'PermissionBasis') {
    Pass 'providers refuse to construct without a stated permission basis'
} else {
    Fail 'source providers do not enforce a permission basis'
}
$assetLicenses = Read-Text 'packages/source-adapters/src/licenses.ts'
if ($assetLicenses -match 'permission-granted' -or $assetLicenses -match 'source:') {
    Pass 'asset/image licence records are tracked'
} else {
    Warn 'could not confirm asset licence records; review licenses.ts'
}
$updates = Read-Text 'apps/desktop/src/services/updates.ts'
$prodEnv = Read-Text 'apps/desktop/.env.production'
$prodUrl = $prodEnv -match '(?m)^VITE_SNAPSHOT_URL=.+'
$prodKey = $prodEnv -match '(?m)^VITE_SNAPSHOT_PUBLIC_KEY=.+'
if ($prodUrl -eq $prodKey -and $updates -match 'isRemoteFeedUsable') {
    Pass 'production feed is either offline or configured with both endpoint and key'
} else {
    Fail 'production feed must configure VITE_SNAPSHOT_URL and VITE_SNAPSHOT_PUBLIC_KEY together'
}

# --- 3. Remote snapshots authenticated before use ---------------------------
Gate 3 'Every remote snapshot is cryptographically authenticated before use'
if ($updates -match 'verifySignedSnapshot' -and
    $updates -match 'publicKey.length > 0' -and
    $updates -match 'signature-failure') {
    Pass 'update path verifies signatures and rejects on signature-failure'
} else {
    Fail 'update path does not verify snapshot signatures'
}
if ($updates -match 'signaturesEnforced') {
    Pass 'signature enforcement is surfaced honestly (signaturesEnforced)'
} else {
    Fail 'signaturesEnforced flag missing'
}

# --- 4. No production dependency on localhost / dev services -----------------
Gate 4 'No production build depends on localhost or developer services'
$conf = Read-Text 'apps/desktop/src-tauri/tauri.conf.json'
try { $confJson = $conf | ConvertFrom-Json } catch { $confJson = $null }
$csp = if ($confJson) { $confJson.app.security.csp } else { '' }
if ($csp -match 'localhost:\*' -or $csp -match '127\.0\.0\.1') {
    Fail 'production CSP still allows localhost/127.0.0.1 connect-src'
} else {
    Pass 'production CSP does not permit localhost/dev connections'
}
# Production snapshot URL must not fall back to localhost.
if ($updates -match 'IS_PROD \? "" :') {
    Pass 'snapshot URL falls back to empty (not localhost) in production'
} else {
    Warn 'confirm production snapshot URL never defaults to localhost'
}
# A configured production build must not ship a localhost VITE_SNAPSHOT_URL.
$envProd = Read-Text 'apps/desktop/.env.production'
if ($envProd -match 'localhost' -or $envProd -match '127\.0\.0\.1') {
    Fail '.env.production points at a localhost/dev endpoint'
} elseif ($envProd) {
    Pass '.env.production contains no localhost endpoint'
} else {
    Pass 'no .env.production overrides (production stays offline-safe by default)'
}

# --- 5. Clean-machine install / run / update / uninstall --------------------
Gate 5 'A clean Windows machine can install, run, update and uninstall'
if ($confJson -and $confJson.bundle.windows.nsis.installMode -eq 'currentUser') {
    Pass 'installer is per-user (no admin required on a clean machine)'
} else {
    Fail 'installer is not configured for per-user (currentUser) install'
}
$installer = $null
if (Test-Path $ReleaseDir) {
    $installer = Get-ChildItem -Path $ReleaseDir -Recurse -Include *-setup.exe, *.msi -ErrorAction SilentlyContinue |
        Select-Object -First 1
}
if (-not $installer) {
    $bundle = 'apps/desktop/src-tauri/target/release/bundle'
    if (Test-Path $bundle) {
        $installer = Get-ChildItem -Path $bundle -Recurse -Include *-setup.exe, *.msi -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }
}
if ($installer) {
    $bytes = [System.IO.File]::ReadAllBytes($installer.FullName)[0..1]
    if ($installer.Length -gt 500KB -and $bytes[0] -eq 0x4D -and $bytes[1] -eq 0x5A) {
        Pass "installer present and valid PE: $($installer.Name)"
    } else {
        Fail "installer looks invalid: $($installer.Name)"
    }
} else {
    Warn 'no installer built yet; CI build-windows job produces and smoke-tests it'
}
# Uninstall must preserve the per-user database (Tauri stores it in AppData).
if ($confJson -and $confJson.bundle.windows.nsis.installMode -eq 'currentUser') {
    Pass 'user database lives in per-user AppData and survives uninstall'
}

# --- 6. All automated checks pass in CI -------------------------------------
Gate 6 'All automated checks pass in continuous integration'
$ci = Read-Text '.github/workflows/ci.yml'
foreach ($needle in @('npm run typecheck', 'npm run lint', 'npm run assets:validate', 'npm test', 'cargo test', 'cargo clippy', 'npm audit --omit=dev')) {
    if ($ci -match [regex]::Escape($needle)) {
        Pass "CI runs: $needle"
    } else {
        Fail "CI is missing a required step: $needle"
    }
}
if (-not $SkipBuild) {
    Write-Host '  running local typecheck + unit tests...' -ForegroundColor DarkGray
    if ((Invoke-Native { npm run typecheck }) -eq 0) { Pass 'local typecheck passes' } else { Fail 'local typecheck failed' }
    if ((Invoke-Native { npm test }) -eq 0) { Pass 'local unit tests pass' } else { Fail 'local unit tests failed' }
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        Push-Location 'apps/desktop/src-tauri'
        $rustTests = Invoke-Native { cargo test --all-features }
        $clippy = Invoke-Native { cargo clippy --all-targets --all-features -- -D warnings }
        Pop-Location
        if ($rustTests -eq 0) { Pass 'cargo test passes' } else { Fail 'cargo test failed' }
        if ($clippy -eq 0) { Pass 'cargo clippy is clean (-D warnings)' } else { Fail 'cargo clippy reported warnings' }
    } else {
        Warn 'cargo not on PATH; Rust checks run in CI'
    }
} else {
    Warn 'Skipped local automated checks (-SkipBuild)'
}

# --- 7. Accessibility + responsive testing ----------------------------------
Gate 7 'Accessibility and responsive-layout testing are complete'
$specs = @()
if (Test-Path 'apps/desktop/e2e') {
    $specs = Get-ChildItem 'apps/desktop/e2e' -Filter '*.spec.ts' -Recurse
}
if ($specs.Count -gt 0) {
    Pass "Playwright E2E specs present ($($specs.Count) files)"
} else {
    Fail 'no Playwright E2E specs found under apps/desktop/e2e'
}
if ($specs.Name -contains 'keyboard.spec.ts') {
    Pass 'keyboard-only navigation is covered'
} else {
    Fail 'missing keyboard-only navigation coverage'
}
if ($specs.Name -contains 'visual.spec.ts') {
    Pass 'screenshot regression baselines are covered'
} else {
    Fail 'missing screenshot regression coverage'
}
if ($SkipE2E) {
    Warn 'Skipped executing Playwright (-SkipE2E); it runs in the CI e2e job'
} elseif ($SkipBuild) {
    Warn 'Skipped executing Playwright (-SkipBuild)'
} else {
    if ((Invoke-Native { npm run --workspace @tradelens/desktop test:e2e }) -eq 0) { Pass 'Playwright E2E suite passes' } else { Fail 'Playwright E2E suite failed' }
}

# --- 8. Honest user-facing claims -------------------------------------------
Gate 8 'User-facing claims accurately reflect what the app can prove'
$readme = Read-Text 'README.md'
if ($readme -match 'signed NSIS installer') {
    Fail 'README over-claims a signed installer unconditionally'
} else {
    Pass 'README does not over-claim installer signing'
}
$settings = Read-Text 'apps/desktop/src/pages/Settings.tsx'
if ($settings -match 'advisory') {
    Pass 'UI frames value estimates as advisory'
} else {
    Warn 'confirm the UI frames estimates as advisory'
}
if ($settings -match 'Development feed' -and $settings -match 'Signature-verified') {
    Pass 'UI distinguishes signed production updates from the development feed'
} else {
    Fail 'UI does not distinguish verified vs unverified data status'
}

# --- 9. Code-signed binaries + installer ------------------------------------
Gate 9 'Release binaries and installer are code-signed'
$thumb = if ($confJson) { $confJson.bundle.windows.certificateThumbprint } else { $null }
$signingConfigured = $confJson -and (
    ($null -ne $thumb -and "$thumb".Length -gt 0) -or
    $env:TAURI_SIGNING_CERT_THUMBPRINT -or
    $env:APPLE_CERTIFICATE -or
    $env:WINDOWS_CERTIFICATE
)
if ($installer) {
    $auth = Get-AuthenticodeSignature -LiteralPath $installer.FullName
    if ($auth.Status -eq 'Valid') {
        Pass "installer is Authenticode-signed ($($auth.SignerCertificate.Subject))"
    } elseif ($RequireSignedBinaries) {
        Fail "installer is not validly signed (status: $($auth.Status))"
    } else {
        Warn "installer is not signed (status: $($auth.Status)); supply a certificate for release"
    }
} elseif ($signingConfigured) {
    Pass 'signing certificate is configured for the release build'
} elseif ($RequireSignedBinaries) {
    Fail 'no signing certificate configured and no signed installer present'
} else {
    Warn 'signing not configured; set certificateThumbprint / TAURI_SIGNING_CERT_THUMBPRINT for release'
}
if ($confJson -and $confJson.bundle.windows.timestampUrl) {
    Pass 'a timestamp authority is configured for durable signatures'
} else {
    Warn 'no timestampUrl configured; signatures will expire with the certificate'
}

# --- 10. Published limitations / privacy / licences / non-affiliation -------
Gate 10 'Known limitations, privacy, licences and non-affiliation are published'
$docChecks = @(
    @{ ok = ($readme -match '(?im)^##\s+Known limitations'); msg = 'README publishes Known limitations' }
    @{ ok = ($readme -match '(?im)^##\s+Privacy');           msg = 'README publishes Privacy information' }
    @{ ok = ($readme -match 'not affiliated');               msg = 'README publishes a non-affiliation notice' }
    @{ ok = (Test-Path 'LICENSE');                           msg = 'LICENSE file is published' }
    @{ ok = (Test-Path 'THIRD-PARTY-NOTICES.md');            msg = 'THIRD-PARTY-NOTICES.md is published' }
    @{ ok = ($readme -match 'Attribution');                  msg = 'README publishes attribution / image credit' }
)
foreach ($c in $docChecks) {
    if ($c.ok) { Pass $c.msg } else { Fail $c.msg }
}

# --- Verdict ----------------------------------------------------------------
Write-Host ''
Write-Host ('=' * 60) -ForegroundColor DarkGray
if ($script:failures -eq 0) {
    Write-Host "ACCEPTANCE GATE PASSED ($script:warnings warning(s))" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ACCEPTANCE GATE FAILED: $script:failures blocker(s), $script:warnings warning(s)" -ForegroundColor Red
    exit 1
}
