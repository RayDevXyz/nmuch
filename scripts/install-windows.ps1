<#
.SYNOPSIS
  Installs everything BrainWaves needs on Windows, then installs the project's packages.

.DESCRIPTION
  Checks each prerequisite first and only installs what is missing (via winget):

    1. Git
    2. Microsoft C++ Build Tools (Visual Studio 2022 Build Tools, "Desktop development with C++")
    3. Microsoft Edge WebView2 Runtime (already part of Windows 10/11; installed only if missing)
    4. Rust (rustup, stable MSVC toolchain)
    5. Node.js LTS (version 20 or newer)
    6. pnpm

  Then, in the repository: `pnpm install` and a first `cargo build` of the Rust workspace,
  so the first `pnpm tauri dev` starts quickly.

  Safe to run again: everything already present is skipped.

.PARAMETER Check
  Also run the test suites (cargo test + pnpm test) after installing.

.PARAMETER Build
  Also build the Windows installer (MSI + setup.exe) at the end.

.PARAMETER Run
  Start the desktop app (`pnpm tauri dev`) at the end.

.EXAMPLE
  scripts\install-windows.cmd
  scripts\install-windows.cmd -Run
  powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Check -Build
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Build,
    [switch]$Run
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$MinNodeMajor = 20
$PnpmVersion = '10.28.0' # keep in sync with "packageManager" in package.json

# ---------------------------------------------------------------- output helpers

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    [ok] $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Warn2([string]$Text) { Write-Host "    [!] $Text" -ForegroundColor Yellow }
function Fail([string]$Text) {
    Write-Host "`n[x] $Text" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------- environment helpers

# winget installs update PATH in the registry, not in this PowerShell session. Re-read it.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    if ((Test-Path $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) { $env:Path = "$cargoBin;$env:Path" }
    $npmBin = Join-Path $env:APPDATA 'npm'
    if ((Test-Path $npmBin) -and ($env:Path -notlike "*$npmBin*")) { $env:Path = "$env:Path;$npmBin" }
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Install a package with winget. Exit code -1978335189 means "already installed / no newer version".
function Install-WithWinget([string]$Id, [string]$Name, [string[]]$Extra = @()) {
    Write-Info "Installing $Name with winget (a Windows permission prompt may appear)..."
    $wingetArgs = @('install', '--id', $Id, '--exact', '--source', 'winget',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') + $Extra
    & winget @wingetArgs
    $code = $LASTEXITCODE
    if ($code -ne 0 -and $code -ne -1978335189) {
        Fail "winget could not install $Name (exit code $code). Install it by hand, then run this script again."
    }
    Update-SessionPath
}

# Run a native command and stop the script if it fails.
function Invoke-Checked([string]$Description, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { Fail "$Description failed (exit code $LASTEXITCODE)." }
}

# ---------------------------------------------------------------- preflight

Write-Host 'BrainWaves - Windows setup' -ForegroundColor Magenta
Write-Info "Repository: $RepoRoot"

if (-not [Environment]::Is64BitOperatingSystem) { Fail 'BrainWaves needs 64-bit Windows.' }
if ([Environment]::OSVersion.Version.Major -lt 10) { Fail 'BrainWaves needs Windows 10 or 11.' }
if (-not (Test-Path (Join-Path $RepoRoot 'Cargo.toml')) -or -not (Test-Path (Join-Path $RepoRoot 'pnpm-workspace.yaml'))) {
    Fail "Run this script from inside the BrainWaves repository (expected Cargo.toml and pnpm-workspace.yaml in $RepoRoot)."
}
if (-not (Test-Command 'winget')) {
    Fail ("winget was not found. Install 'App Installer' from the Microsoft Store " +
        '(https://apps.microsoft.com/detail/9NBLGGH4NNS1), then run this script again.')
}
Update-SessionPath

# ---------------------------------------------------------------- 1. Git

Write-Step '1/6  Git'
if (Test-Command 'git') {
    Write-Ok (git --version)
} else {
    Install-WithWinget 'Git.Git' 'Git'
    if (-not (Test-Command 'git')) { Fail 'Git was installed but is not on PATH yet. Open a new terminal and run this script again.' }
    Write-Ok (git --version)
}

# ---------------------------------------------------------------- 2. C++ Build Tools

Write-Step '2/6  Microsoft C++ Build Tools (needed to compile Rust on Windows)'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
function Find-VcTools {
    if (-not (Test-Path $vswhere)) { return $null }
    $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($path) { return $path }
    return $null
}
$vc = Find-VcTools
if ($vc) {
    Write-Ok "C++ build tools found in $vc"
} else {
    Write-Info 'This is a large download (several GB) and can take a while.'
    Install-WithWinget 'Microsoft.VisualStudio.2022.BuildTools' 'Visual Studio 2022 Build Tools' @(
        '--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
    $vc = Find-VcTools
    if (-not $vc) {
        Fail ("The C++ build tools are still missing. Open 'Visual Studio Installer', choose Modify on " +
            "'Build Tools 2022', tick 'Desktop development with C++', install, then run this script again.")
    }
    Write-Ok "C++ build tools installed in $vc"
}

# ---------------------------------------------------------------- 3. WebView2

Write-Step '3/6  Microsoft Edge WebView2 Runtime (the window BrainWaves draws in)'
$webview2Keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$webview2 = $webview2Keys | ForEach-Object { (Get-ItemProperty -Path $_ -Name pv -ErrorAction SilentlyContinue).pv } |
    Where-Object { $_ -and $_ -ne '0.0.0.0' } | Select-Object -First 1
if ($webview2) {
    Write-Ok "WebView2 $webview2"
} else {
    Install-WithWinget 'Microsoft.EdgeWebView2Runtime' 'WebView2 Runtime'
    Write-Ok 'WebView2 installed'
}

# ---------------------------------------------------------------- 4. Rust

Write-Step '4/6  Rust (rustup, stable MSVC toolchain)'
if (-not (Test-Command 'rustup')) {
    Install-WithWinget 'Rustlang.Rustup' 'Rust (rustup)'
    if (-not (Test-Command 'rustup')) { Fail 'rustup was installed but is not on PATH yet. Open a new terminal and run this script again.' }
}
# Make sure the MSVC toolchain is the default and current (BrainWaves' dependencies need a recent compiler).
Invoke-Checked 'Installing the stable Rust toolchain' { rustup toolchain install stable-msvc --profile minimal --component rustfmt --component clippy }
Invoke-Checked 'Selecting the stable Rust toolchain' { rustup default stable-msvc }
Write-Ok ((rustc --version) + ' / ' + (cargo --version))

# ---------------------------------------------------------------- 5. Node.js

Write-Step "5/6  Node.js ($MinNodeMajor or newer)"
function Get-NodeMajor {
    if (-not (Test-Command 'node')) { return 0 }
    $v = (node --version) -replace '^v', ''
    return [int]($v.Split('.')[0])
}
$nodeMajor = Get-NodeMajor
if ($nodeMajor -ge $MinNodeMajor) {
    Write-Ok "Node.js $(node --version)"
} else {
    if ($nodeMajor -gt 0) { Write-Warn2 "Node.js $(node --version) is too old; installing the current LTS." }
    Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    if ((Get-NodeMajor) -lt $MinNodeMajor) {
        Fail ("Node.js $MinNodeMajor+ is still not the one on PATH (found: $(if (Test-Command 'node') { node --version } else { 'none' })). " +
            'Open a new terminal and run this script again, or uninstall the old Node.js first.')
    }
    Write-Ok "Node.js $(node --version)"
}

# ---------------------------------------------------------------- 6. pnpm

Write-Step "6/6  pnpm $PnpmVersion"
$havePnpm = if (Test-Command 'pnpm') { (pnpm --version) } else { '' }
if ($havePnpm -eq $PnpmVersion) {
    Write-Ok "pnpm $havePnpm"
} else {
    Invoke-Checked 'Installing pnpm' { npm install --global "pnpm@$PnpmVersion" --no-fund --no-audit }
    Update-SessionPath
    if (-not (Test-Command 'pnpm')) { Fail 'pnpm was installed but is not on PATH yet. Open a new terminal and run this script again.' }
    Write-Ok "pnpm $(pnpm --version)"
}

# ---------------------------------------------------------------- project setup

Push-Location $RepoRoot
try {
    Write-Step 'Installing the project''s JavaScript packages (pnpm install)'
    Invoke-Checked 'pnpm install' { pnpm install --frozen-lockfile }

    Write-Step 'Compiling the Rust workspace once (first time takes a few minutes)'
    Invoke-Checked 'cargo build' { cargo build --workspace }
    Write-Ok 'Rust workspace builds'

    if ($Check) {
        Write-Step 'Running the tests'
        Invoke-Checked 'cargo test' { cargo test --workspace }
        Invoke-Checked 'pnpm test' { pnpm -r test }
        Write-Ok 'All tests pass'
    }

    if ($Build) {
        Write-Step 'Building the Windows installer (pnpm tauri build)'
        Push-Location (Join-Path $RepoRoot 'apps\desktop')
        try { Invoke-Checked 'tauri build' { pnpm tauri build } } finally { Pop-Location }
        $bundle = Join-Path $RepoRoot 'target\release\bundle'
        Write-Ok "Installers are in $bundle"
        Get-ChildItem -Path $bundle -Recurse -Include *.msi, *.exe -ErrorAction SilentlyContinue |
            ForEach-Object { Write-Info "  $($_.FullName)" }
    }
} finally {
    Pop-Location
}

# ---------------------------------------------------------------- done

Write-Host "`nAll set." -ForegroundColor Green
Write-Host @"

  Start the desktop app:
      cd "$RepoRoot\apps\desktop"
      pnpm tauri dev

  Build an installer:
      scripts\install-windows.cmd -Build

  Coming from Nimbus? Your notes are imported automatically on first start,
  or later via Settings > Import from Nimbus.

  If a command isn't found in an old terminal window, open a new one
  (installers only update PATH for new terminals).
"@

if ($Run) {
    Write-Step 'Starting BrainWaves (pnpm tauri dev) - close the window or press Ctrl+C to stop'
    Set-Location (Join-Path $RepoRoot 'apps\desktop')
    pnpm tauri dev
}
