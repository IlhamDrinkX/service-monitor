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

## Stage 6 — Syrup panel / polish / flash / Android stub

- Полная UI-панель сиропа: scan/motor params + лог
- Общий `dozator-ssh` helper (syrup + flash)
- Auto-connect NATS на вкладке Модули при готовой сессии
- In-app **flash_sirup** partA/partB + stream лога; `flash_obraz` — legacy launch + справка
- Каркас `apps/android` + контракт native bridge (`docs/ANDROID.md`)
- electron-builder релиз-пайплайн — отложен

## Дальше

- Полный port `flash_obraz` (ansible) in-app
- NATS cleaning / расширенный brew UI
- Android native SSH/NATS runtime
- Подпись кода (Apple notarization / Windows Authenticode) для публичных релизов
