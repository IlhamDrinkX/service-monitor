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

- `{}` или `{ "hwid": "dx" }` — status / muster
- `hwid`: `dx` (facade), `dx.milk` / `dx.coffee` / `dx.water`
- `pumps.<host>!`: `{ "duration": 3000, "power": 200, "direction": "forward"|"reverse" }`
- brew: `coffeeRecipe.parts[].qty` — **мс насоса**, не мл

Где смотреть в ERP: `cm-drv/coffeemachine-drv.js`, `cm-drv/drivers/dx/direct-device-api.js`, `complexos/api/dashboard-api.ts`, Dashboard → Logs.
