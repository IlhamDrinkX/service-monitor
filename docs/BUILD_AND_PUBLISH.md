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

**Одна строка в Terminal:**

```bash
curl -fsSL https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-macos.sh | bash
```

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
3. `npm install` → сборка → installer

Артефакты: `apps/desktop/release/`

Переменные:

| Env | Значение |
|-----|----------|
| `SERVICE_MONITOR_REPO` | URL (по умолчанию `https://github.com/IlhamDrinkX/service-monitor.git`) |
| `SERVICE_MONITOR_DIR` | Каталог (для install-*: `%USERPROFILE%\service-monitor` / `~/service-monitor`) |
| `SERVICE_MONITOR_SKIP_DIST=1` | Только compile, без installer |

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
