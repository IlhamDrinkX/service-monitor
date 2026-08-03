# Сборка и публикация Service Monitor

## Бетатестерам (обезьянья установка)

Репозиторий: https://github.com/IlhamDrinkX/service-monitor

Тестеру **не нужно** заранее ставить Git/Node и клонировать репо.  
Отдай одну команду или один файл — скрипт сам: поставит Git/Node → `git clone` → соберёт → запустит установщик.

### Windows

**Вариант 1 — одна строка в PowerShell** (Win+X → Terminal / PowerShell):

```powershell
irm https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-windows.ps1 | iex
```

**Вариант 2 — файл двойным кликом:**  
скачать [`scripts/install-windows.cmd`](https://github.com/IlhamDrinkX/service-monitor/blob/main/scripts/install-windows.cmd) → сохранить → открыть.

Проект окажется в `%USERPROFILE%\service-monitor`, установщик сам откроется из `apps\desktop\release\`.

### macOS

**Вариант 1 — одна строка в Terminal:**

```bash
curl -fsSL https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-macos.sh | bash
```

**Вариант 2 — файл двойным кликом:**  
скачать [`scripts/install-macos.command`](https://github.com/IlhamDrinkX/service-monitor/blob/main/scripts/install-macos.command) → в Finder правый клик → «Открыть» (первый раз macOS спросит подтверждение).

Проект: `~/service-monitor`, затем откроется `.dmg`.

---

## Быстрый старт (инженер / уже есть клон)

### Windows

```bat
scripts\bootstrap.cmd
```

или:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
```

### macOS

```bash
chmod +x scripts/bootstrap.sh scripts/install-macos.sh
bash scripts/bootstrap.sh
```

Скрипт bootstrap (из клона):

1. Проверяет **Git** / **Node.js ≥ 20** (ставит через winget / brew)
2. `git pull` или `git clone`
3. `npm install` (с retry) → сборка → installer

Артефакты: `apps/desktop/release/`

| Скрипт | Назначение |
|--------|------------|
| `build-local.cmd` / `.ps1` | **Локально из текущего клона** → Setup.exe (без git pull) |
| `install-windows.cmd` / `.ps1` | Бета: clone в `%USERPROFILE%\service-monitor` + Setup.exe |
| `install-macos.command` / `.sh` | Бета: clone в `~/service-monitor` + DMG |
| `bootstrap.cmd` / `.ps1` | Инженер на Windows: update + dist:win |
| `bootstrap.sh` | Инженер на macOS: update + dist:mac (Linux — без installer) |
| `electron-builder-win.cjs` | NSIS: CSC off, clean release, retry spawn UNKNOWN |
| `electron-builder-mac.cjs` | DMG: CSC off, clean release |
| `electron-builder-linux.cjs` | AppImage + deb (x64), clean release, unsigned |

Переменные:

| Env | Значение |
|-----|----------|
| `SERVICE_MONITOR_REPO` | URL (по умолчанию `https://github.com/IlhamDrinkX/service-monitor.git`) |
| `SERVICE_MONITOR_DIR` | Каталог (для install-*: `%USERPROFILE%\service-monitor` / `~/service-monitor`) |
| `SERVICE_MONITOR_SKIP_DIST=1` | Только compile, без installer |

### Windows: `spawn UNKNOWN` при NSIS

electron-builder на шаге uninstaller запускает временный `ServiceMonitor-Setup-*.exe`. Если Windows Defender (или другой AV) блокирует свежий unsigned exe, получаете `Error: spawn UNKNOWN`.

1. Windows Security → Virus & threat protection → Exclusions → добавить папку репо (или `apps\desktop\release`)
2. Удалить `apps\desktop\release`
3. `npm run dist:win -w @service-monitor/desktop` (скрипт сам чистит release и делает один retry)

### Быстрая локальная сборка (текущий клон)

```bat
scripts\build-local.cmd
```

или:

```powershell
npm run build:local
```

Соберёт core + desktop + `ServiceMonitor-Setup-*.exe` в `apps/desktop/release/` и откроет установщик.
`SERVICE_MONITOR_OPEN=0` — только собрать, не запускать Setup.
`SERVICE_MONITOR_SKIP_DIST=1` — только compile, без installer.

## Публикация в GitHub

1. Репозиторий: [IlhamDrinkX/service-monitor](https://github.com/IlhamDrinkX/service-monitor).
2. Из корня проекта:

```bash
git add .
git commit -m "Initial Service Monitor"
git branch -M main
git remote add origin https://github.com/IlhamDrinkX/service-monitor.git
git push -u origin main
```

3. Релизный тег:

```bash
git tag v0.2.1
git push origin v0.2.1
```

Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) соберёт Windows + macOS + Linux артефакты и приложит их к GitHub Release.

Линукс-сборка сейчас — только `x64` (AppImage + `.deb`). Если целевая машина (комплекс) на ARM (например, Raspberry Pi) — `x64`-сборка не запустится; нужно будет отдельно добавить `arm64`-таргет и либо нативный ARM-раннер GitHub (`ubuntu-24.04-arm`), либо QEMU-эмуляцию в electron-builder — сообщите архитектуру комплекса, если это актуально.

Локально без CI:

```bash
npm install --legacy-peer-deps
npm run dist:win -w @service-monitor/desktop   # Windows
npm run dist:mac -w @service-monitor/desktop   # macOS
npm run dist:linux -w @service-monitor/desktop # Linux (AppImage + deb, x64)
```

## После сна ноутбука

При закрытии крышки SSH/NATS обрываются. Приложение:

- сохраняет последнюю сессию (Local/Remote + серия)
- на `resume` / unlock переподключает туннель и шлёт `app:resumed`
- вкладка Модули снова поднимает NATS

Если UI всё же «пустой» — перезапустите приложение или на вкладке **Сессия** нажмите Connect.
