# Этапы разработки Service Monitor

## Stage 0 — Foundation

- Monorepo: `packages/core`, `apps/desktop`
- Доменные типы, debug-логгер, help-контент, генератор SSH-фрагментов
- Electron + React, тёмная тема, `?`-хелпы, раздел Help
- Тесты: `node --test` после `tsc`

## Stage 1 — Access

- Генерация ed25519 ключа (ssh-keygen)
- Показ pubkey для вставки в ERP → Профиль → SSH key
- Профили комплексов (серия `4.15` → порт `22415`)
- Apply / Copy snippet для `~/.ssh/config` (эталонные LocalForward на `:8000`)
- WriteGate + хеш сервисного пароля (разблокировка правок позже)

## Stage 2 — Cloud fleet

- Адаптер API из `C:\myApp\fibbee` (email/password → `x-auth-token`)
- Список sales points + статус + поиск
- Открытие ERP dashboard URL с JWT
- Токен в userData (пароль не храним)
- Тесты: `npm run test:stage2 -w @service-monitor/core`

## Stage 3 — Live session

- Local: **HTTP**-probe `192.168.1.43–46` + отдельный **NATS** `:4222` (не голый TCP)
- Remote: LocalForward + HTTP через `127.0.0.1:808x` + NATS `:14222`
- **Красная подсветка**, если модули/NATS недоступны
- Вкладка **Модули** / **Конфиг** используют ту же сессию

## Stage 4 — Write + hints

- Вкладка **Конфиг**: load/save `drinkx.json` (пароль `pi` через ssh2)
- Подсказки параметров с **codeRef** из cm-drv (`drinkx.js` / `pid.js`) + KB
- Diff верхнего уровня перед сохранением; audit-лог в userData
- Discovery: ARP с MAC, sticky TTL 5 мин (не мигают)

## Stage 5 — Built-in NATS + syrup + restart

- Встроенный NATS-клиент в Electron main (`nats` npm): muster / status / status-notification
- UI **Модули**: полный Industrial Control (клапаны / насос / нагреватели / flush / пена / температуры) без окна `module_test`
- Сироп: SSH Host `dozator` → remote `modbus-cli.js` (scan / motor)
- После записи `drinkx.json` — best-effort `systemctl`/`pm2` restart cm-drv
- Subjects + device map в `@service-monitor/core` (`nats/subjects.ts`, `nats/module-devices.ts`)

## Stage 6 — Syrup panel / polish / flash / Android stub ✅

Порядок 3 → 4 → 1 → 5 (закрыто):

- **3** Полная UI-панель сиропа (Дозатор → стенд): scan/motor params + лог; `dozator-ssh`
- **4** Auto-connect NATS на вкладке Модули (`useModulesLabNats`); docs обновлены
- **1** In-app flash partA/partB + `flash:log`; legacy `flash_sirup`/`sirup_test` свёрнуты; `flash_obraz` — launch + справка
- **5** Каркас `apps/android` + bridge contract (`docs/ANDROID.md`)
- electron-builder релиз-пайплайн — отложен (вне скоупа)

## Stage 7 — ComplexOS + Lab terminal / complex telemetry

- Вкладка **ComplexOS**: `complexos.core.*` / dashboard dump / cleaning-config, pause, transitions, dismiss alerts, Big Wash через `devices.cm.action`, grace/force restart; запись timings через `coffeemachine.update-config` (после сервисного пароля)
- Сворачиваемая боковая навигация; `?` на кнопках и параметрах ComplexOS / Lab
- **Конфиг**: блок cleaning timings ComplexOS рядом с drinkx.json
- Modules Lab:
  - parallel complex status (tuple replies milk/coffee/water), valve verify, chart grid по модулям
  - треки модулей/датчиков, CSV лог, пакеты клапанов, прогрев тенов, реверс насоса (если cm-drv поддерживает)
  - **Терминал**: крупные subject + JSON textarea; пресеты с ассоциациями subject→payload; свои ★ + удаление; sticky scroll; Enter / Ctrl+Enter; правила payload
- Core: `nats/complexos-subjects.ts`, `nats/complex-status.ts`, `nats/terminal-presets.ts`, `nats/chart-layout.ts`, `nats/valve-packages.ts`, `nats/heater-warmup.ts`
- Help: статья «NATS subjects и payload»

## Stage 8 — Lab scenarios / Cos orders+bus / Brew Lab

- Modules: панель **Сценарии** (status, micro/long milkrinse, Stop CM) + **Brew Lab**; хелпы `?` + подписи ETA
- milkrinse: реальные ERP payload; timeout = tubesLength×150 + reverse; опрос датчиков не блокируется (priority poll) → виден `pump_R_IS`
- Core: `nats/lab-scenarios.ts` (`LAB_SCENARIOS`, `buildBrewLabPayload`, `expectedSec`)
- NATS bus: `natsSubscribeBus` / `onNatsBus` → ComplexOS live alerts
- ComplexOS: **Orders**, **Stop CM**, автообновление orders ~7с
- Навигация: **Дозатор** (syrup Modbus/flash + flash_obraz) вынесена из Modules
- Help: статья «Сценарии Lab и milkrinse»

## Stage 9 — LabTelemetry / DX UI currents / actuator stability (dev2)

- Один владелец опроса: `LabTelemetryController` + `useLabTelemetry`
  - NATS ~800ms (active + other tracked): status + valves + pumps + heaters
  - DX UI ~1s: только `pump_R_IS` / `pump_L_IS` (HTTP :8000 / туннель; SSH fallback)
  - `pause` abort только NATS; DX ток не стопорится на START насоса
- Heater PWM в Lab = оценка PidClassic.start (25–75%), не DX graph lastlog
- Pump START/STOP: session cancel, optimistic power %, burst DX
- Water charts: `waterPressure` + `waterTotalPulses` в события графиков
- Flush шлёт явный `power` 100% (не ERP default PWM 100)
- Reverse status power: величина % (отрицательный speed ERP)
- IPC: `dxUi:pumpCurrents`, `profiles:hashServicePassword`
- Локальные требования агента: `.agent-notes/REQUIREMENTS.md` (gitignored)

## Дальше

- Полный port `flash_obraz` (ansible) in-app
- Расширенный brew UI (tweaks/menu items) поверх Brew Lab
- ~~Split ModulesPage (terminal / scenarios / actuators)~~ **done** (commit `bfb3fba`) — `ModulesPage.tsx` теперь composition root (~400 строк), логика разнесена по `components/modules/*Panel.tsx` (валвы/насос/тены/сервис/терминал/сценарии/сенсоры) + хукам `lab/modulesLab/*`. Крупнейший оставшийся файл в этой области — `components/ModulesLabCharts.tsx` (~600 строк, окно графиков), не смешивает terminal/scenarios/actuators.
- ~~LabTelemetryController unit tests~~ **done** (2026-08-02) — 13 тестов, `apps/desktop/src/lab/LabTelemetryController.test.ts`.
- Health Report (вкладка «Сессия») — **done** (2026-08-02) — одна кнопка опрашивает NATS/модули/DX/ComplexOS/сироп/ККТ/lab-logger.
- ~~XOR-настройка (отключение плотного опроса с ноутбука при активном бортовом realtime)~~ **done** (2026-08-03) — Настройки → «Опрос модулей: ноутбук vs бортовой» (Авто/Всегда плотный/Всегда сниженный). Авто снижает частоту опроса `LabTelemetryController` (~800мс → ~4с), когда фоновая проверка (`useOnboardRealtimeGate`, раз в ~20с) подтверждает, что бортовой lab-logger установлен и активен. Не меняет источник данных для Modules (та же laptop NATS/DX труба, просто реже) — полноценная замена источника на бортовой SSH-фид остаётся отдельным будущим шагом.
- CI: сборка релизов под Linux — **done** (2026-08-03) — `.github/workflows/release.yml` собирает Windows + macOS + **Linux (AppImage + deb, x64)**; `npm run dist:linux`. Архитектура `arm64` для встраиваемых Linux-плат комплекса — не добавлена, ждём подтверждения реального железа.
- ~~Справка «Thermometers» (ADS1115) в подсказках Конфига~~ **done** (2026-08-03) — `packages/core/src/hints/param-hints.ts`: раскрыта общая запись `Thermometers` (формула NTC, назначение блока, путь `~/.config/andromeda/drinkx.json`, оговорка про ansible `manual_drinkx_json_update`) + добавлены точечные записи под конкретные ключи, которые реально participate в PID/защитах: `Thermometers.milk_input` (вход PID heater1), `Thermometers.heater1_out` (факт h1 / вход heater2), `Thermometers.heater2_out` (факт h2 = цель рецепта — сюда же кейс «напиток горячее цели» из завышенного B), `Thermometers.heater1_overheat`/`heater2_overheat` (PT100, защита, не цель), `Thermometers.pump_R_IS`/`pump_L_IS` (Type V, ток насоса, не температура), `Thermometers.water_pressure` (Type P, линейная интерполяция). Почему: пользователь прислал развёрнутую справку по этому блоку (роли датчиков, формула, эталонные B/R0, типовые кейсы вроде «не догревает» / «скачет на старте») — механизм показа уже существовал (`ConfigPage.tsx` → панель «Подсказки из кода» рендерит любой path из `listParamHints()`), не хватало только контента под конкретные ключи `Thermometers.*`; отдельного экрана строить не потребовалось. 166/166 core-тестов зелёные после правки.
- Троттлинг опроса DX UI в бортовом логгере (независимо от базового `interval_ms`). **Почему**: `sm_lab_logger.NatsSource.poll()` (`tools/complexos-lab-logger/sm_lab_logger/poller.py`) на каждом тике поллинга (по умолчанию `interval_ms=200`, т.е. 5 раз/сек) делает обычный HTTP GET корневой страницы DX UI (`fetch_dx_ui_snapshot` → `dx_ui.py`) на всех трёх модулях (`http://192.168.1.44/.45/.46:8000/`) — а это, предположительно, та же страница/бэкенд, что рендерит kiosk-экран кассы для покупателя. 2026-08-03: пользователь сообщил о визуальных глюках на кассе (наслоение картинок между экранами, ложное «ингредиент закончился», залипший автокомплит поверх сетки ингредиентов — скриншоты в чате); данные с DX и раньше были признаны нестабильными под нашим опросом (см. Stage 9 / task #23 — пила на ШИМ тэнов). 5 запросов/сек на общий с живым UI сервер — правдоподобный источник конкуренции за ресурсы на Pi-class железе. План: (1) развязать интервал DX-запроса от основного `interval_ms` (например, раз в 1–2 сек вместо каждого тика — данные DX и так уже второстепенные/оценочные), (2) до/вместо кода — попросить пользователя выполнить изоляционный тест (временно остановить `sm-lab-logger` и понаблюдать за кассой без нашего опроса), чтобы подтвердить или опровергнуть причинную связь прежде чем считать это закрытым. Пока не реализовано — ждём подтверждения от пользователя, делать троттлинг сейчас или сначала проверить гипотезу.
- Android native SSH/NATS runtime
- Подпись кода (Apple notarization / Windows Authenticode) для публичных релизов
