# Service Monitor - one-click install for Windows beta testers
# ASCII-only messages (avoids PowerShell parse errors on broken UTF-8).
#
# What it does:
#   1) install Git + Node via winget if missing
#   2) git clone to %USERPROFILE%\service-monitor
#   3) npm install + build + installer (.exe)
#   4) launch the setup exe
#
# Run:
#   A) Double-click install-windows.cmd
#   B) powershell: irm https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-windows.ps1 | iex

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoUrl = if ($env:SERVICE_MONITOR_REPO) {
  $env:SERVICE_MONITOR_REPO
} else {
  "https://github.com/IlhamDrinkX/service-monitor.git"
}
$Root = if ($env:SERVICE_MONITOR_DIR) {
  $env:SERVICE_MONITOR_DIR
} else {
  Join-Path $env:USERPROFILE "service-monitor"
}

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
  foreach ($extra in @(
      "${env:ProgramFiles}\Git\cmd",
      "${env:ProgramFiles}\Git\bin",
      "${env:LocalAppData}\Programs\Git\cmd",
      "${env:ProgramFiles}\nodejs",
      "${env:ProgramFiles(x86)}\nodejs"
    )) {
    if ((Test-Path $extra) -and ($env:Path -notlike "*$extra*")) {
      $env:Path = "$extra;$env:Path"
    }
  }
}

function Ensure-Command([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Ensure-Git {
  Refresh-Path
  if (Ensure-Command "git") {
    Write-Host "git: $(git --version)"
    return
  }
  Write-Step "Git not found - installing via winget"
  if (-not (Ensure-Command "winget")) {
    throw "Git and winget missing. Install Git from https://git-scm.com/download/win and re-run."
  }
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
  Start-Sleep -Seconds 2
  Refresh-Path
  if (-not (Ensure-Command "git")) {
    throw "Git installed but PATH not updated. Open a new terminal and re-run."
  }
  Write-Host "git: $(git --version)"
}

function Ensure-Node {
  Refresh-Path
  if (Ensure-Command "node") {
    $v = (node -v).TrimStart("v")
    $major = [int]($v.Split(".")[0])
    Write-Host "node: v$v"
    if ($major -lt 20) {
      throw "Node.js >= 20 required (found v$v). Update from https://nodejs.org and re-run."
    }
    return
  }
  Write-Step "Node.js not found - installing LTS via winget"
  if (-not (Ensure-Command "winget")) {
    throw "Node and winget missing. Install Node 20+ from https://nodejs.org and re-run."
  }
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
  Start-Sleep -Seconds 2
  Refresh-Path
  if (-not (Ensure-Command "node")) {
    throw "Node installed but PATH not updated. Open a new terminal and re-run."
  }
  Write-Host "node: $(node -v)"
}

function Sync-Repo {
  Write-Step "Project folder: $Root"
  New-Item -ItemType Directory -Force -Path (Split-Path $Root -Parent) | Out-Null

  if (Test-Path (Join-Path $Root ".git")) {
    Write-Step "Existing clone - git pull"
    Set-Location $Root
    git remote set-url origin $RepoUrl 2>$null
    git fetch --all --prune
    $branch = (git rev-parse --abbrev-ref HEAD)
    if ($branch -eq "HEAD") { $branch = "main" }
    git pull --ff-only origin $branch
    if ($LASTEXITCODE -ne 0) {
      git pull --rebase origin $branch
    }
  } elseif (Test-Path (Join-Path $Root "package.json")) {
    Write-Host "package.json without .git - building as-is" -ForegroundColor Yellow
    Set-Location $Root
  } else {
    if (Test-Path $Root) {
      $items = Get-ChildItem $Root -Force -ErrorAction SilentlyContinue
      if ($items) {
        throw "Folder $Root is not empty. Delete it or set SERVICE_MONITOR_DIR to another path."
      }
      Remove-Item $Root -Force -ErrorAction SilentlyContinue
    }
    Write-Step "Cloning repository"
    git clone $RepoUrl $Root
    Set-Location $Root
  }
}

function Invoke-NpmInstall {
  # Electron download often fails with ECONNRESET - retry.
  $env:npm_config_fetch_retries = "5"
  $env:npm_config_fetch_retry_mintimeout = "20000"
  $env:npm_config_fetch_retry_maxtimeout = "120000"

  $max = 3
  for ($i = 1; $i -le $max; $i++) {
    Write-Step "npm install (attempt $i/$max, please wait)"
    npm install --legacy-peer-deps
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host "npm install failed (often network/Electron). Retrying..." -ForegroundColor Yellow
    $electronDir = Join-Path $Root "node_modules\electron"
    if (Test-Path $electronDir) {
      Remove-Item $electronDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds (5 * $i)
  }
  throw "npm install failed after $max attempts. Re-run the script with a stable network."
}

function Install-And-Build {
  Set-Location $Root
  Invoke-NpmInstall

  Write-Step "Building core + desktop"
  npm run build -w @service-monitor/core
  if ($LASTEXITCODE -ne 0) { throw "core build failed" }
  npm run build -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) { throw "desktop build failed" }

  if ($env:SERVICE_MONITOR_SKIP_DIST -eq "1") {
    Write-Host "SKIP_DIST=1 - skipping installer"
    return
  }

  Write-Step "Building Windows installer (.exe)"
  npm run dist:win -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) { throw "dist:win failed" }

  $release = Join-Path $Root "apps\desktop\release"
  Write-Host ""
  Write-Host "Done. Files in: $release" -ForegroundColor Green
  if (-not (Test-Path $release)) { return }

  Get-ChildItem $release -File | ForEach-Object { Write-Host "  - $($_.FullName)" }

  $setup = Get-ChildItem $release -File -Filter "*Setup*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $setup) {
    $setup = Get-ChildItem $release -File -Filter "*.exe" |
      Where-Object { $_.Name -notmatch "uninstall|blockmap" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
  }
  if ($setup) {
    Write-Step "Launching installer: $($setup.Name)"
    Start-Process -FilePath $setup.FullName
  } else {
    Write-Host "Open the folder and run the .exe manually:" -ForegroundColor Yellow
    Start-Process explorer.exe $release
  }
}

try {
  Write-Host "Service Monitor - install for Windows tester" -ForegroundColor Green
  Write-Host "Repo: $RepoUrl"
  Ensure-Git
  Ensure-Node
  Sync-Repo
  Install-And-Build
  Write-Host ""
  Write-Host "OK. If setup did not open, check apps\desktop\release" -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Just re-run this script (network glitches are common on Electron download)." -ForegroundColor Yellow
  exit 1
}
