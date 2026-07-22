# Сборка и публикация Service Monitor

## Быстрый старт (инженер / CI)

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
chmod +x scripts/bootstrap.sh
bash scripts/bootstrap.sh
```

Скрипт:

1. Проверяет **Git** (при отсутствии пробует `winget` / `brew` / `apt`)
2. Проверяет **Node.js ≥ 20**
3. Если есть `.git` — `git pull`; иначе `git clone`
4. `npm install --legacy-peer-deps`
5. Собирает core + desktop
6. Собирает установщик: **NSIS (.exe)** на Windows, **DMG** на macOS

Артефакты: `apps/desktop/release/`

Переменные:

| Env | Значение |
|-----|----------|
| `SERVICE_MONITOR_REPO` | URL репозитория (по умолчанию `https://github.com/IlhamDrinkX/service-monitor.git`) |
| `SERVICE_MONITOR_DIR` | Каталог установки |
| `SERVICE_MONITOR_SKIP_DIST=1` | Только compile, без installer |

Пример:

```powershell
$env:SERVICE_MONITOR_REPO = "https://github.com/IlhamDrinkX/service-monitor.git"
.\scripts\bootstrap.ps1
```

## Бетатестерам (установка с нуля)

Репозиторий: https://github.com/IlhamDrinkX/service-monitor  

Скрипты лежат в папке [`scripts/`](https://github.com/IlhamDrinkX/service-monitor/tree/main/scripts):

| ОС | Команда |
|----|---------|
| **Windows** | `scripts\bootstrap.cmd` (двойной клик) или `powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1` |
| **macOS** | `bash scripts/bootstrap.sh` |

**Windows — с нуля:**
```powershell
git clone https://github.com/IlhamDrinkX/service-monitor.git
cd service-monitor
.\scripts\bootstrap.cmd
```

**macOS — с нуля:**
```bash
git clone https://github.com/IlhamDrinkX/service-monitor.git
cd service-monitor
bash scripts/bootstrap.sh
```

Скрипт поставит зависимости (Git/Node при необходимости), соберёт приложение и установщик.  
Готовый installer: `apps/desktop/release/` (`.exe` на Windows, `.dmg` на macOS).

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
git tag v0.1.0
git push origin v0.1.0
```

Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) соберёт Windows + macOS артефакты и приложит их к GitHub Release.

Локально без CI:

```bash
npm install --legacy-peer-deps
npm run dist:win -w @service-monitor/desktop   # Windows
npm run dist:mac -w @service-monitor/desktop   # macOS
```

## После сна ноутбука

При закрытии крышки SSH/NATS обрываются. Приложение:

- сохраняет последнюю сессию (Local/Remote + серия)
- на `resume` / unlock переподключает туннель и шлёт `app:resumed`
- вкладка Модули снова поднимает NATS

Если UI всё же «пустой» — перезапустите приложение или на вкладке **Сессия** нажмите Connect.
