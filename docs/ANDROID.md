# Android (каркас)

Целевой клиент для полевых инженеров на планшете/телефоне.

## Статус

Skeleton: [`apps/android`](../apps/android) — shared types/helpers из `@service-monitor/core/browser`.  
Полноценный RN/Kotlin runtime (SSH/NATS) — следующий трек после стабилизации desktop Stage 6.

## Принцип

- Доменная логика и типы — только из `@service-monitor/core` (export `./browser`).
- NATS subjects, device map, session helpers, SSH snippet generators, param hints — уже в core.
- Electron-специфика (`ssh2`, `nats` в main, Host `dozator`) **не** импортируется в shared UI.

## Что переносится без изменений

| Модуль | Назначение |
|--------|------------|
| `NATS_SUBJECTS` / `module-devices` | Subjects + клапаны/насосы/tenы |
| Help / control hints | UI подсказки |
| Param hints + JSON diff | drinkx |
| Session warn/health | Красный статус |
| ERP types / URL builders | Cloud fleet |

## Native bridge (нужен на Android)

1. **SSH** — jump/tunnels или companion (Termux / libssh)
2. **NATS TCP** — сокет к `nats://…:4222` или туннель
3. **Secure storage** — ERP token
4. **dozator** — отдельный SSH Host для syrup/flash (или LAN)

Контракт IPC desktop → ориентир API: `natsConnect`, `natsRequest`, `syrupCheckSsh`, `syrupModbusScan`, `flashPartA`/`flashPartB`, `drinkxRead`/`Write`, `sessionConnect`.

## Запуск каркаса

```bash
cd C:\myApp\service-monitor\apps\android
npm install
npm test
```
