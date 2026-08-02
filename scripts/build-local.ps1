# Local build - current checkout only (no git clone/pull).
# ASCII-only (avoids PowerShell parse errors on broken encodings).
#
# Usage:
#   scripts\build-local.cmd
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1
#
# Env:
#   SERVICE_MONITOR_SKIP_DIST=1  - compile only (no NSIS installer)
#   SERVICE_MONITOR_OPEN=0       - do not launch the Setup.exe

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT" -and $IsWindows -ne $true) {
  Write-Host "Windows only. On macOS: bash scripts/bootstrap.sh" -ForegroundColor Yellow
  exit 1
}

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

if (-not (Test-Path (Join-Path $Root "package.json"))) {
  throw "Not a service-monitor checkout: $Root"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found. Install Node 20+ from https://nodejs.org"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm not found on PATH"
}

Write-Host "Service Monitor - local Windows build" -ForegroundColor Green
Write-Host "Root: $Root"

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:__COMPAT_LAYER = "RunAsInvoker"
$env:npm_config_fetch_retries = "5"
$env:npm_config_fetch_retry_mintimeout = "20000"
$env:npm_config_fetch_retry_maxtimeout = "120000"

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Write-Step "npm install (first time)"
  npm install --legacy-peer-deps
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

Write-Step "Build core + desktop"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

if ($env:SERVICE_MONITOR_SKIP_DIST -eq "1") {
  Write-Host "SKIP_DIST=1 - installer not built. App output: apps\desktop\out"
  exit 0
}

Write-Step "Windows installer (electron-builder NSIS)"
# Close previous run so release\win-unpacked is not locked
Get-Process -Name "ServiceMonitor","electron" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

npm run dist:win -w @service-monitor/desktop
if ($LASTEXITCODE -ne 0) {
  throw "dist:win failed. Close Service Monitor if open. If spawn UNKNOWN: Defender exclusion for $Root, delete apps\desktop\release, re-run."
}

$release = Join-Path $Root "apps\desktop\release"
if (-not (Test-Path $release)) {
  throw "No release folder: $release"
}

Write-Host ""
Write-Host "Artifacts:" -ForegroundColor Green
Get-ChildItem $release -File | ForEach-Object {
  $mb = [math]::Round($_.Length / 1MB, 1)
  Write-Host ("  {0}  ({1} MB)" -f $_.Name, $mb)
}

$setup = Get-ChildItem $release -File -Filter "*Setup*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setup) {
  # Fallback: wrapper may have left artifacts only under release-build-*
  $setup = Get-ChildItem (Join-Path $Root "apps\desktop") -Directory -Filter "release-build-*" |
    ForEach-Object { Get-ChildItem $_.FullName -File -Filter "*Setup*.exe" -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if (-not $setup) {
  Write-Host "No Setup.exe found - open $release" -ForegroundColor Yellow
  Start-Process explorer.exe $release
  exit 0
}

$minBytes = 512 * 1024
if ($setup.Length -lt $minBytes) {
  $kb = [math]::Round($setup.Length / 1024)
  throw "Installer looks incomplete (${kb}KB stub). Exclude from Defender and re-run."
}

Write-Host ""
Write-Host "Installer: $($setup.FullName)" -ForegroundColor Green

if ($env:SERVICE_MONITOR_OPEN -eq "0") {
  Write-Host "SERVICE_MONITOR_OPEN=0 - not launching Setup."
  exit 0
}

Write-Step "Launching $($setup.Name)"
Start-Process -FilePath $setup.FullName
