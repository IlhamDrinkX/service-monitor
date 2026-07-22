# Service Monitor

Десктоп-приложение для полевых инженеров Fibbee / DrinkX (Windows + macOS).  
Позже — модуль Android на том же `@service-monitor/core`.

## Этапы

| Этап | Содержание | Статус |
|------|------------|--------|
| **0** | Каркас, тёмная тема, Help (`?`), Debug-логи, тесты ядра | готово |
| **1** | Access: SSH-ключ, snippet/apply `~/.ssh/config`, профили | готово (UI + core) |
| **2** | Cloud: логин ERP (`fibbee` API), список комплексов | готово |
| **3** | Connect Remote/Local, HTTP+NATS probe, красный статус | готово |
| **4** | drinkx.json + code hints + diff + discovery MAC | готово |
| **5** | Встроенный NATS, сироп `dozator`, restart cm-drv | готово |
| **6** | Сироп UI, auto NATS, flash partA/B, Android stub | готово |

Подробнее: [`docs/STAGES.md`](docs/STAGES.md). Android: [`docs/ANDROID.md`](docs/ANDROID.md).  
Сборка / GitHub Release: [`docs/BUILD_AND_PUBLISH.md`](docs/BUILD_AND_PUBLISH.md).

## Структура

```
service-monitor/
  packages/core/     # домен, SSH snippet, WriteGate, help, hints, NATS subjects
  apps/desktop/      # Electron + React (тёмная тема)
  apps/android/      # каркас + bridge contract (без native runtime)
  scripts/           # bootstrap.ps1 / bootstrap.sh — clone/pull/build/installer
  docs/STAGES.md
  docs/ANDROID.md
  docs/BUILD_AND_PUBLISH.md
```

## Запуск

```bash
cd C:\myApp\service-monitor
npm install --legacy-peer-deps
npm test
npm run build -w @service-monitor/core
npm run dev -w @service-monitor/desktop
```

Установщик (Windows / macOS) для бетатестеров — см. [`docs/BUILD_AND_PUBLISH.md`](docs/BUILD_AND_PUBLISH.md):

```bash
git clone https://github.com/IlhamDrinkX/service-monitor.git
cd service-monitor
# Windows:  scripts\bootstrap.cmd
# macOS:    bash scripts/bootstrap.sh
```

Или локально:

```bash
npm run dist:win    # → apps/desktop/release/*.exe
npm run dist:mac    # → apps/desktop/release/*.dmg
```

Если `npm install` падает с `ECONNRESET` (сеть) — повторите позже; ядро можно ставить отдельно:

```bash
npm install -w @service-monitor/core --legacy-peer-deps --prefer-offline
npm test
```

## Debug-режим

В **Настройки** включите Debug. Логи:

`%APPDATA%/service-monitor/debug-logs/` (Windows)

Кнопка «Копировать лог» — вставить в чат ассистенту при сбое.

## Что уже в UI

- Тёмная тема, навигация с `?`-хелпами
- Раздел **Справка** (приложение + как работает комплекс)
- **Доступ**: ключ, pubkey для ERP, snippet / запись ssh config (forwards `:8000` на модулях)
- **Настройки**: Debug, сервисный пароль (отдельный от ERP)
- **Сессия**: Connect SSH (общий туннель + NATS :14222), дашборд/киоск/графики
- **Модули**: DrinkX NATS (auto-connect), сироп Modbus, flash partA/B; legacy flash_obraz
- **Конфиг**: drinkx.json + restart cm-drv
- Красная подсветка, если сессия не установлена или протухла
