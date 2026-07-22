# Service Monitor — one-click install for Windows beta testers
#
# Что делает сам:
#   1) ставит Git и Node (через winget), если нет
#   2) git clone в %USERPROFILE%\service-monitor
#   3) npm install + сборка + installer (.exe)
#   4) запускает установщик
#
# Запуск (любой из вариантов):
#   A) Двойной клик по install-windows.cmd (скачать из репо)
#   B) В PowerShell одной строкой:
#      irm https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-windows.ps1 | iex

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
  Write-Step "Git не найден — ставлю через winget"
  if (-not (Ensure-Command "winget")) {
    throw "Нет Git и нет winget. Поставь Git с https://git-scm.com/download/win и запусти скрипт снова."
  }
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
  Start-Sleep -Seconds 2
  Refresh-Path
  if (-not (Ensure-Command "git")) {
    throw "Git поставили, но PATH ещё не обновился. Закрой окно, открой новое PowerShell и запусти скрипт снова."
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
      throw "Нужен Node.js >= 20 (сейчас v$v). Обнови с https://nodejs.org и запусти снова."
    }
    return
  }
  Write-Step "Node.js не найден — ставлю LTS через winget"
  if (-not (Ensure-Command "winget")) {
    throw "Нет Node и нет winget. Поставь Node 20+ с https://nodejs.org и запусти снова."
  }
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
  Start-Sleep -Seconds 2
  Refresh-Path
  if (-not (Ensure-Command "node")) {
    throw "Node поставили, но PATH ещё не обновился. Закрой окно, открой новое PowerShell и запусти скрипт снова."
  }
  Write-Host "node: $(node -v)"
}

function Sync-Repo {
  Write-Step "Папка проекта: $Root"
  New-Item -ItemType Directory -Force -Path (Split-Path $Root -Parent) | Out-Null

  if (Test-Path (Join-Path $Root ".git")) {
    Write-Step "Уже есть клон — обновляю (git pull)"
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
    Write-Host "Есть package.json без .git — собираю как есть" -ForegroundColor Yellow
    Set-Location $Root
  } else {
    if (Test-Path $Root) {
      # Пустая или битая папка
      $items = Get-ChildItem $Root -Force -ErrorAction SilentlyContinue
      if ($items) {
        throw "Папка $Root уже занята. Удали её или задай SERVICE_MONITOR_DIR=другой путь."
      }
      Remove-Item $Root -Force -ErrorAction SilentlyContinue
    }
    Write-Step "Скачиваю проект (git clone)"
    git clone $RepoUrl $Root
    Set-Location $Root
  }
}

function Invoke-NpmInstall {
  # Сеть часто рвёт скачивание Electron (ECONNRESET) — повторяем.
  $env:npm_config_fetch_retries = "5"
  $env:npm_config_fetch_retry_mintimeout = "20000"
  $env:npm_config_fetch_retry_maxtimeout = "120000"

  $max = 3
  for ($i = 1; $i -le $max; $i++) {
    Write-Step "npm install (попытка $i/$max, долго — подожди)"
    npm install --legacy-peer-deps
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host "npm install не удался (часто сеть / Electron). Повтор…" -ForegroundColor Yellow
    # Битый частичный electron мешает следующей попытке
    $electronDir = Join-Path $Root "node_modules\electron"
    if (Test-Path $electronDir) {
      Remove-Item $electronDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds (5 * $i)
  }
  throw "npm install failed после $max попыток. Запусти скрипт ещё раз (нужен стабильный интернет)."
}

function Install-And-Build {
  Set-Location $Root
  Invoke-NpmInstall

  Write-Step "Сборка core + desktop"
  npm run build -w @service-monitor/core
  if ($LASTEXITCODE -ne 0) { throw "core build failed" }
  npm run build -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) { throw "desktop build failed" }

  if ($env:SERVICE_MONITOR_SKIP_DIST -eq "1") {
    Write-Host "SKIP_DIST=1 — installer не собираю"
    return
  }

  Write-Step "Сборка установщика (.exe)"
  npm run dist:win -w @service-monitor/desktop
  if ($LASTEXITCODE -ne 0) { throw "dist:win failed" }

  $release = Join-Path $Root "apps\desktop\release"
  Write-Host ""
  Write-Host "Готово. Файлы: $release" -ForegroundColor Green
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
    Write-Step "Запускаю установщик: $($setup.Name)"
    Start-Process -FilePath $setup.FullName
  } else {
    Write-Host "Открой папку вручную и запусти .exe:" -ForegroundColor Yellow
    Start-Process explorer.exe $release
  }
}

try {
  try {
    chcp 65001 | Out-Null
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    $OutputEncoding = [Console]::OutputEncoding
  } catch { }

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
