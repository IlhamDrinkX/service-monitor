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
| **7** | ComplexOS, Lab terminal presets, complex status/charts | готово |

Подробнее: [`docs/STAGES.md`](docs/STAGES.md). Android: [`docs/ANDROID.md`](docs/ANDROID.md).  
Сборка / GitHub Release: [`docs/BUILD_AND_PUBLISH.md`](docs/BUILD_AND_PUBLISH.md).  
Полевая шпаргалка NATS / ComplexOS: [`docs/FIELD_NATS.md`](docs/FIELD_NATS.md).

## Структура

```
service-monitor/
  packages/core/     # домен, SSH, WriteGate, help, NATS subjects / ComplexOS / terminal presets
  apps/desktop/      # Electron + React (тёмная тема)
  apps/android/      # каркас + bridge contract (без native runtime)
  scripts/           # install-windows / install-macos (бета), bootstrap.*
  docs/STAGES.md
  docs/ANDROID.md
  docs/BUILD_AND_PUBLISH.md
  docs/FIELD_NATS.md
```

## Запуск

```bash
cd C:\myApp\service-monitor
npm install --legacy-peer-deps
npm test
npm run build -w @service-monitor/core
npm run dev -w @service-monitor/desktop
```

Установщик для бетатестеров (сам ставит Git/Node, клонирует, собирает):

**Windows** — в PowerShell:
```powershell
irm https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-windows.ps1 | iex
```
или двойной клик по [`scripts/install-windows.cmd`](scripts/install-windows.cmd).

**macOS** — в Terminal:
```bash
curl -fsSL https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-macos.sh | bash
```
или двойной клик по [`scripts/install-macos.command`](scripts/install-macos.command).

Подробнее: [`docs/BUILD_AND_PUBLISH.md`](docs/BUILD_AND_PUBLISH.md).

Локально (если репо уже есть):

```bash
npm run dist:win    # → apps/desktop/release/*.exe
npm run dist:mac    # → apps/desktop/release/*.dmg
# scripts\bootstrap.cmd  /  bash scripts/bootstrap.sh
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

- Тёмная тема, сворачиваемая навигация с `?`-хелпами
- Раздел **Справка** (приложение, архитектура комплекса, NATS subjects/payload)
- **Доступ**: ключ, pubkey для ERP, snippet / запись ssh config (forwards `:8000` на модулях)
- **Настройки**: Debug, сервисный пароль (отдельный от ERP)
- **Сессия**: Connect SSH (общий туннель + NATS :14222), дашборд/киоск/графики
- **Модули (Lab)**: DrinkX NATS (auto-connect), клапаны/насос/тены/flush, треки датчиков, графики комплекса, сироп Modbus, flash partA/B
- **Терминал NATS**: пресеты subject/payload с ассоциациями, свои ★ + удаление, крупные поля, Enter / Ctrl+Enter, правила payload из ERP
- **ComplexOS**: status / dump / pause / режимы / alerts, Big Wash, cleaning timings (runtime), grace/force restart (после сервисного пароля)
- **Конфиг**: drinkx.json + timings мойки ComplexOS + restart cm-drv
- Красная подсветка, если сессия не установлена или протухла

## Полевые заметки (Stage 7)

- Опасные команды ComplexOS и запись timings требуют разблокировки в **Настройки** (сервисный пароль приложения, не ERP).
- Payload brew: `qty` у coffee/milk — **миллисекунды насоса**, не мл; facade `hwid: "dx"`.
- Источники subjects в ERP release: `cm-drv` expose list, `complexos/api/dashboard-api.ts`, Dashboard → Logs.
