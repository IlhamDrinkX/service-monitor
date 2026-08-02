# Bootstrap / update / build Service Monitor (Windows)
#
# Usage:
#   scripts\bootstrap.cmd
#   powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
#
# On macOS/Linux use: bash scripts/bootstrap.sh
#
# Env:
#   SERVICE_MONITOR_REPO      — git URL (default: https://github.com/IlhamDrinkX/service-monitor.git)
#   SERVICE_MONITOR_DIR       — install dir (default: cwd if checkout, else ../service-monitor)
#   SERVICE_MONITOR_SKIP_DIST — if "1", only npm build (no electron-builder installer)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT" -and $IsWindows -ne $true) {
  Write-Host "This script is for Windows. On macOS/Linux run: bash scripts/bootstrap.sh" -ForegroundColor Yellow
  exit 1
}

$RepoUrl = if ($env:SERVICE_MONITOR_REPO) { $env:SERVICE_MONITOR_REPO } else { "https://github.com/IlhamDrinkX/service-monitor.git" }
$Root = if ($env:SERVICE_MONITOR_DIR) {
  $env:SERVICE_MONITOR_DIR
} else {
  if (Test-Path (Join-Path (Get-Location) "package.json")) {
    (Resolve-Path (Get-Location)).Path
  } else {
    Join-Path (Split-Path $PSScriptRoot -Parent) "service-monitor"
  }
}

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Ensure-Command([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Ensure-Git {
  if (Ensure-Command "git") {
    Write-Host "git: $(git --version)"
    return
  }
  Write-Step "Git not found - trying winget install"
  if (Ensure-Command "winget") {
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
      [System.Environment]::GetEnvironmentVariable("Path", "User")
  } elseif (Ensure-Command "choco") {
    choco install git -y
  } else {
    throw "Git is required. Install from https://git-scm.com/download/win and re-run."
  }
  if (-not (Ensure-Command "git")) {
    throw "Git still not on PATH. Open a new terminal and re-run."
  }
}

function Ensure-Node {
  if (Ensure-Command "node") {
    $v = (node -v).TrimStart("v")
    $major = [int]($v.Split(".")[0])
    Write-Host "node: v$v"
    if ($major -lt 20) {
      throw "Node.js >= 20 required (found v$v). Install from https://nodejs.org"
    }
    return
  }
  Write-Step "Node not found - trying winget install"
  if (Ensure-Command "winget") {
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
      [System.Environment]::GetEnvironmentVariable("Path", "User")
  } else {
    throw "Node.js >= 20 required. Install from https://nodejs.org and re-run."
  }
  if (-not (Ensure-Command "node")) {
    throw "Node still not on PATH. Open a new terminal and re-run."
  }
}

function Sync-Repo {
  Write-Step "Repo dir: $Root"
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Set-Location $Root

  if (Test-Path (Join-Path $Root ".git")) {
    Write-Step "Existing checkout - git fetch/pull"
    git remote set-url origin $RepoUrl 2>$null
    git fetch --all --prune
    $branch = (git rev-parse --abbrev-ref HEAD)
    if ($branch -eq "HEAD") { $branch = "main" }
    git pull --ff-only origin $branch
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ff-only failed - trying pull --rebase" -ForegroundColor Yellow
      git pull --rebase origin $branch
    }
  } elseif (Test-Path (Join-Path $Root "package.json")) {
    Write-Host "package.json present without .git - skip clone, use as-is" -ForegroundColor Yellow
  } else {
    Write-Step "Clone $RepoUrl"
    git clone $RepoUrl $Root
    Set-Location $Root
  }
}

function Invoke-NpmInstall {
  $env:npm_config_fetch_retries = "5"
  $env:npm_config_fetch_retry_mintimeout = "20000"
  $env:npm_config_fetch_retry_maxtimeout = "120000"

  $max = 3
  for ($i = 1; $i -le $max; $i++) {
    Write-Step "npm install (attempt $i/$max)"
    npm install --legacy-peer-deps
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host "npm install failed (often network/Electron). Retrying..." -ForegroundColor Yellow
    $electronDir = Join-Path $Root "node_modules\electron"
    if (Test-Path $electronDir) {
      Remove-Item $electronDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds (5 * $i)
  }
  throw "npm install failed after $max attempts."
}

function Assert-RealWinInstaller([string]$release) {
  $setup = Get-ChildItem $release -File -Filter "*Setup*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $setup) {
    throw "No *Setup*.exe in $release"
  }
  # Incomplete NSIS stub left after spawn UNKNOWN is typically <512KB; full installer ~80MB+
  if ($setup.Length -lt 512KB) {
    throw "Installer looks incomplete ($([math]::Round($setup.Length/1KB))KB stub). Defender may have blocked NSIS. Exclude $Root and re-run."
  }
  return $setup
}

function Install-And-Build {
  Set-Location $Root
  Invoke-NpmInstall

  Write-Step "build core + desktop"
  npm run build -w @service-monitor/core
  if ($LASTEXITCODE -ne 0) { throw "core build failed" }
  npm run build -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) { throw "desktop build failed" }

  if ($env:SERVICE_MONITOR_SKIP_DIST -eq "1") {
    Write-Host "SKIP_DIST=1 - installer not built"
    return
  }

  Write-Step "electron-builder (Windows)"
  # Wrapper scripts/electron-builder-win.cjs also sets these + cleans release + retries
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  $env:__COMPAT_LAYER = "RunAsInvoker"
  npm run dist:win -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) {
    throw "dist:win failed (if spawn UNKNOWN: exclude repo from Defender, delete apps\desktop\release, re-run)"
  }

  $release = Join-Path $Root "apps\desktop\release"
  $null = Assert-RealWinInstaller $release
  Write-Host ""
  Write-Host "Done. Installer(s) in: $release" -ForegroundColor Green
  if (Test-Path $release) {
    Get-ChildItem $release -File | ForEach-Object { Write-Host "  - $($_.FullName)" }
  }
}

try {
  Ensure-Git
  Ensure-Node
  Sync-Repo
  Install-And-Build
} catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.Exception.Message -match "spawn UNKNOWN|dist:win|incomplete|Defender") {
    Write-Host "NSIS stub often blocked by Windows Defender." -ForegroundColor Yellow
    Write-Host "Add exclusion for: $Root" -ForegroundColor Yellow
  }
  exit 1
}
