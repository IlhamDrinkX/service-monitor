# Bootstrap / update / build Service Monitor (Windows + macOS/Linux)
#
# Usage:
#   Windows:  powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
#   macOS:    bash scripts/bootstrap.sh
#
# Env:
#   SERVICE_MONITOR_REPO   — git URL (default: https://github.com/IlhamDrinkX/service-monitor.git)
#   SERVICE_MONITOR_DIR    — install dir (default: ./service-monitor next to script parent, or current)
#   SERVICE_MONITOR_SKIP_DIST — if "1", only npm build (no electron-builder installer)

$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:SERVICE_MONITOR_REPO) { $env:SERVICE_MONITOR_REPO } else { "https://github.com/IlhamDrinkX/service-monitor.git" }
$Root = if ($env:SERVICE_MONITOR_DIR) {
  $env:SERVICE_MONITOR_DIR
} else {
  # Prefer current dir if already a checkout; else sibling folder
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
  Write-Step "Git not found — trying winget install"
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
  Write-Step "Node not found — trying winget install"
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
    Write-Step "Existing checkout — git fetch/pull"
    git remote set-url origin $RepoUrl 2>$null
    git fetch --all --prune
    $branch = (git rev-parse --abbrev-ref HEAD)
    if ($branch -eq "HEAD") { $branch = "main" }
    git pull --ff-only origin $branch
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ff-only failed — trying pull --rebase" -ForegroundColor Yellow
      git pull --rebase origin $branch
    }
  } elseif (Test-Path (Join-Path $Root "package.json")) {
    Write-Host "package.json present without .git — skip clone, use as-is" -ForegroundColor Yellow
  } else {
    Write-Step "Clone $RepoUrl"
    git clone $RepoUrl $Root
    Set-Location $Root
  }
}

function Install-And-Build {
  Set-Location $Root
  Write-Step "npm install"
  npm install --legacy-peer-deps
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

  Write-Step "build core + desktop"
  npm run build -w @service-monitor/core
  if ($LASTEXITCODE -ne 0) { throw "core build failed" }
  npm run build -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) { throw "desktop build failed" }

  if ($env:SERVICE_MONITOR_SKIP_DIST -eq "1") {
    Write-Host "SKIP_DIST=1 — installer not built"
    return
  }

  Write-Step "electron-builder (Windows)"
  npm run dist:win -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) { throw "dist:win failed" }

  $release = Join-Path $Root "apps\desktop\release"
  Write-Host ""
  Write-Host "Done. Installer(s) in: $release" -ForegroundColor Green
  if (Test-Path $release) {
    Get-ChildItem $release -File | ForEach-Object { Write-Host "  - $($_.FullName)" }
  }
}

Ensure-Git
Ensure-Node
Sync-Repo
Install-And-Build
