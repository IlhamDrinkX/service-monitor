# ComplexOS и NATS-терминал (полевая шпаргалка)

Кратко для инженера. Детали subjects — в UI (**Справка → NATS subjects и payload**, блок «Правила payload» в Модули → Терминал) и в ERP release.

## ComplexOS

Вкладка после **Модули**. Нужна живая сессия + NATS.

| Действие | Subject (ориентир) | Примечание |
|----------|-------------------|------------|
| Status | `complexos.core.status` | mode, pause, alerts, transitions |
| Dump devices | `complexos.dashboard.dump-devices` | взять `coffeeMachineId` (часто `dx`) |
| Orders | `complexos.dashboard.orders` | waiting / progress / ready / taked |
| Cleaning config | `complexos.dashboard.cleaning-config` | чтение timings |
| Pause / Resume | `complexos.core.pause` | `{ pause: true\|false }` |
| Transition | `complexos.core.transition` | `{ transition }` из status |
| Big Wash | `complexos.devices.cm.action` | `start-cleaning` · сервисный пароль |
| Stop CM | `complexos.devices.cm.action` | `{ action: "stop" }` · fallback `coffeemachine.stop` |
| Live alerts | `complexos.bus.alertCreated/Cleared/helpNeeded` | авто refresh status |
| Запись timings | `coffeemachine.update-config` | runtime merge, не osconfig ERP |
| Grace / Force restart | `complexos.core.grace-restart` / `restart` | сервисный пароль |

## Modules Lab — телеметрия (Stage 9)

| Показатель | Источник |
|------------|----------|
| Температуры / pressure / pulses | NATS `coffeemachine.status` **`{ hwid: "dx" }`** (fallback many `{}`) |
| Холодильник msValve 1…6 | status `milkValves`/`coffeeValves` (idle `[]` = все OFF) + bus `complexos.valves.switched` |
| Сиропы / дозатор (поле) | NATS `complexos.sirup.muster` / `status|pump|unpump|stop.<id>` — status = `forward\|reverse\|stopped` только (ток/В нет); см. ниже |
| Сироп flash / Modbus scan | SSH Host `dozator` (стенд) — вкладка **Дозатор**; там же ток/регистры плат при наличии CLI |
| Мощность насоса % | NATS `pumps.status.{milk,coffee,water}` (+ optimistic cmd) |
| R_IS / L_IS | HTTP DX UI `:8000` (туннель 8082–8084) — вольты АЦП; milk=.44 (**не** `.33`) |
| ШИМ тэнов | оценка `(target−temp)×1.5` clamp 25–75; **не** DX graph; **не** status `*_heater*_power` (дубль temp) |
| Health per host | snapshot `hostHealth`: NATS (pump/status) vs DX HTTP |

Опрос: `LabTelemetryController` — NATS ~800ms (active + other tracked), DX ~1s отдельно. Pause на команду не стопит DX.

### Сиропы: muster 30 vs «нет ответа»

На 4.x `muster` часто отвечает **30 раз** (hwid `"1"`…`"30"`, `MAX_MOTORS`) — это список слотов драйвера, **не** «все моторы живы».

На практике три случая, которые инженер видит в дашборде / на железе:

| Случай | Status NATS | Как выглядит в SM |
|--------|-------------|-------------------|
| Включён (есть на шине) | `forward` / `reverse` / `stopped` | чип стоп/стрелка, строка в логе |
| Заблокирован в дашборде | часто отвечает при спокойном опросе | чип стоп/стрелка (как включённый) |
| Физически нет | **timeout** | чип `?` · «нет ответа» |

Параллельный bulk status перегружает `ft-sirup-drv` / шину и даёт **ложные** timeout даже на живых моторах. Физически отсутствующие всё равно timeout; NATS сам по себе «заблокирован vs нет» не маркирует — смотрите дашборд и спокойный опрос.

«Опрос всех»: **последовательно** (concurrency 1, ~3 с timeout + короткая пауза между моторами); ответившие — по строке; таймауты схлопываются (`нет ответа: …`) + сводка. Одиночный Status остаётся ~1.2 с.

## Modules Lab — сценарии и Brew

- **Сценарии** шлют **реальные ERP payload** (не mock): status, micro-rinse / milk rinse (`coffeemachine.milkrinse!`), Stop CM, pump reverse
- Micro: `tubesLength: 1000` ≈ 150 с forward (ComplexOS microrinse) + reverse-циклы DrinkX
- Milk rinse (lab): `tubesLength: 1500` ≈ 4 мин; не Big Wash
- Во время rinse опрос DX UI (:8000 / :8082) даёт **pump_R_IS в вольтах** (NATS status его не отдаёт); reverse **не** отрицательный
- **Stop CM** доступен во время rinse (не блокируется busy сценария)
- **Brew Lab**: форма parts → `coffeemachine.brew`; **qty = мс насоса**; unlock + confirm
- Сироп / flash_obraz — вкладка **Дозатор** (не Modules)
- Опасные сценарии и brew — после сервисного пароля в Настройках

## Терминал (Модули)

1. Выберите **куда отправить** — список payload сузится по ассоциациям (например `pumps.milk!` → forward/reverse).
2. Или введите subject / JSON вручную (крупные поля).
3. **Запомнить** — свои ★ с привязкой subject↔payload; **Удалить** — только свои.
4. Enter в subject → payload; **Ctrl+Enter** в JSON → Send.
5. Лог не прыгает вниз, если вы прокрутили вверх.

## Payload (частое)

- **`{ "hwid": "dx" }`** — Lab status primary (facade: `milkSensors`/`*Valves`); `{}` — fallback / гонка одного модуля
- `hwid`: `dx` (facade), `dx.milk` / `dx.coffee` / `dx.water`
- `pumps.<host>!`: `{ "duration": 3000, "power": 200, "direction": "forward"|"reverse" }`
- brew: `coffeeRecipe.parts[].qty` — **мс насоса**, не мл
- Fridge: не poll `valves.status.milk-msValveN`; live — bus + status `*Valves`

Где смотреть в ERP: `cm-drv/coffeemachine-drv.js`, `cm-drv/drivers/dx/direct-device-api.js`, `complexos/api/dashboard-api.ts`, Dashboard → Logs.
