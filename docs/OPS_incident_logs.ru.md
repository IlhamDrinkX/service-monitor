# Разбор инцидентов 4.X: GUI, зависание заказа, напиток не приготовился

Краткая операционная шпаргалка: куда смотреть логи и в каком порядке, если на комплексе зависла очередь, крашнулся/«поплыл» GUI или напиток не вышел.

SSH: `ssh 224NN` (через ProxyJump `erp.fibbee.com`), где `NN` — номер комплекса (например `22413` = 4.13).

Время в journalctl — **локальное время комплекса** (обычно Europe/Moscow).

---

## 1. Быстрый чеклист (5 минут)

| Симптом | Первый сервис | Команда |
|--------|---------------|---------|
| GUI «отвалился», белый экран, 502 | `ft-complexos` + nginx | см. §3 |
| Заказ висит в очереди / «готовится» вечно | `ft-complexos` | см. §4 |
| Напиток не налился / оборвался mid-brew | `ft-complexos` → `ft-cm-drv` | см. §5 |
| После инцидента всё мертво | `systemctl` статусы | см. §2 |

Зафиксируй: **номер комплекса, время (±2 мин), номер заказа / orderId, название напитка**.

---

## 2. Статус сервисов

```bash
systemctl is-active ft-complexos.service ft-complexui.service ft-cm-drv.service nginx
systemctl status ft-complexos.service ft-cm-drv.service --no-pager -l
```

Ожидаемо: все `active`. Если `ft-complexos` / `ft-cm-drv` в `failed` — сначала журнал падения:

```bash
journalctl -u ft-complexos.service -b --no-pager | tail -n 100
journalctl -u ft-cm-drv.service -b --no-pager | tail -n 100
```

---

## 3. Краш / глитч GUI (экран, вёрстка, 502 на заказах)

**Важно:** «кривая» вёрстка на планшете ≠ падение ComplexOS. Часто клиент ловит 502 после `os.safe-restart` / рестарта ERP, или баг CSS в конкретном браузере.

### 3.1. ComplexOS (ERP)

```bash
# окно вокруг инцидента
journalctl -u ft-complexos.service --since "YYYY-MM-DD HH:MM:00" --until "YYYY-MM-DD HH:MM:00" --no-pager

# типичные маркеры рестарта / обрыва шины заказов
journalctl -u ft-complexos.service --since "..." --until "..." --no-pager \
  | grep -iE "safe-restart|exit|SIG|uncaught|ECONN|orders/bus|502"
```

Ищи:
- `os.safe-restart` / процесс вышел → UI на `/orders/bus` получит 502 → клиент перезагрузится;
- необработанные исключения в JSON-логах (`"level":"error"`).

### 3.2. Nginx (доступ к UI и API)

```bash
sudo tail -n 200 /var/log/nginx/error.log
sudo grep "HH:MM" /var/log/nginx/access.log | grep -E "ordering|/orders/bus|502|499|504" | tail -n 50
```

Полезно: IP клиента, User-Agent (iPad Safari vs Android), код ответа.

### 3.3. UI-сборка на комплексе

```bash
# путь UI (redesign)
ls -la /home/pi/aerp-complexui-redesign/build/ordering | head
# версия OS / UI — смотри по месту (VERSION, package, journal boot)
```

Если глитч только на одном устройстве — сравни UA в access.log; баг CSS часто воспроизводится только на старом Safari/WebView.

### 3.4. ComplexUI unit (если отдельный)

```bash
journalctl -u ft-complexui.service --since "..." --until "..." --no-pager | tail -n 100
```

---

## 4. Зависание заказа в очереди (не стартует / «can't run»)

### 4.1. Срез логов по времени

```bash
journalctl -u ft-complexos.service --since "YYYY-MM-DD HH:MM:00" --until "YYYY-MM-DD HH:MM:00" --no-pager \
  | grep -E "order queued|starting brew|can't run|blockers|requesting order|orderBrewing|orderDone|orderFailed|Brewing too long"
```

### 4.2. Типичные причины `can't run`

В payload смотри `blockers` / контекст:

| Блокер / сигнал | Смысл | Что делать |
|-----------------|-------|------------|
| `orderRequested` / `orderRequested:false` | Заказ ждёт подтверждения выдачи (PIN / takeaway). Не пошёл в brew. | Проверить, не «зомби» в очереди; снять/закрыть заказ, не копить |
| `coffeeMachine` / `notReservedNozzle` | Носик/КМ заняты другим заказом | Смотреть заказ, который держит brew |
| ресурсы milk/water/coffee | Нет ресурса / занят модуль | `ft-cm-drv` + конфиг DX |

Зомби-заказ (долго в очереди с `orderRequested:false`) блокирует картину и может мешать диагностике — в логах он будет каждые ~15 с с `checking resources` / `can't run`.

### 4.3. Найти orderId / номер

```bash
journalctl -u ft-complexos.service --since "..." --until "..." --no-pager \
  | grep -E "orderNumber.:404|\"orderId\":\"01K"
```

Дальше фильтруй только по этому `orderId`.

---

## 5. Напиток не приготовился / оборвался во время brew

Цепочка: **ComplexOS** вызывает `coffeemachine.brew` → **cm-drv** → DrinkX.

### 5.1. ComplexOS — старт и финал brew

```bash
journalctl -u ft-complexos.service --since "..." --until "..." --no-pager \
  | grep -E "starting brew|duringbrew|sirup-tweak|timeout: coffeemachine.brew|Brewing too long|orderDone|orderFailed|parsed response"
```

Ключевые маркеры:

| Сообщение | Значение |
|-----------|----------|
| `starting brew` / `Starting duringbrew()` | Brew начался |
| `[ sirup-tweak ] DX cm detected, waiting sync` | Сироп ждёт синхронизации с DX |
| `timeout: coffeemachine.brew` | ERP не дождался ответа от cm-drv (часто ~3 мин), идёт retry |
| `Brewing too long` + `stopped:true` | Жёсткий abort после долгих retry — напиток не завершён штатно |
| `Out of ...` / dry / error в memoir | Нехватка / авария на модуле (если есть в payload) |

### 5.2. cm-drv

```bash
journalctl -u ft-cm-drv.service --since "..." --until "..." --no-pager

# узкий фильтр
journalctl -u ft-cm-drv.service --since "..." --until "..." --no-pager \
  | grep -iE "Incoming|brew|error|fail|timeout|dry|Out of|abort|facade-cm"
```

Ищи пару:
1. `[expose] Incoming` / `[ facade-cm ] brew request` в момент старта;
2. повторный `Incoming` на тот же `orderId` ≈ через 3 мин → это **retry после timeout** (модуль завис/не ответил);
3. отсутствие «done»/успешного ответа до `Brewing too long` в complexos → зависание на стороне DX/железа/драйвера.

В payload brew есть `orderId`, `orderNumber`, `traceId`, `nozzleId`, `milkDeviceId`, рецепт (`parts`: coffee/milk/syrup).

### 5.3. Связка по traceId / orderId

Пример:

```bash
OID=01KZ835S15P06YJFSY1GNJMQXP
journalctl -u ft-complexos.service -u ft-cm-drv.service --since "..." --until "..." --no-pager \
  | grep "$OID"
```

---

## 6. Выгрузка логов «пакетом» на ноут

С Windows (PowerShell), подставь порт комплекса и окно времени:

```powershell
$h = "22413"
$since = "2026-08-05 07:30:00"
$until = "2026-08-05 07:45:00"
$dir = "C:\myApp\${h}-incident-logs"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

ssh $h "journalctl -u ft-complexos.service --since '$since' --until '$until' --no-pager" `
  | Set-Content "$dir\complexos.log" -Encoding utf8
ssh $h "journalctl -u ft-cm-drv.service --since '$since' --until '$until' --no-pager" `
  | Set-Content "$dir\cm-drv.log" -Encoding utf8
ssh $h "sudo grep -E '07:3[0-9]|07:4[0-5]' /var/log/nginx/access.log | tail -n 500" `
  | Set-Content "$dir\nginx-access.log" -Encoding utf8
ssh $h "sudo tail -n 300 /var/log/nginx/error.log" `
  | Set-Content "$dir\nginx-error.log" -Encoding utf8
```

Для GUI-инцидентов добавь окно шире (±30 мин) и фильтр `502` / `orders/bus` / `safe-restart`.

---

## 7. Пример: 4.13, 2026-08-05 ~07:33:43

| Что | Детали |
|-----|--------|
| Заказ | #404 Latte/Раф, `orderId=01KZ835S15P06YJFSY1GNJMQXP` |
| 07:33:43 | `order queued` |
| 07:33:44 | `starting brew` → cm-drv принял `coffeemachine.brew` (milk-1, nozzle 0) |
| 07:33:45 | syrup tweak: waiting sync |
| 07:36:34 | `timeout: coffeemachine.brew` + retry (повторный Incoming в cm-drv) |
| 07:39:25 | `Brewing too long` / `stopped:true` — напиток не завершён |
| Фон | Зомби #379 с `blockers:["orderRequested"]` с утра — не причина timeout, но засоряет очередь `can't run` |

**Вывод:** зависание не «GUI», а **таймаут `coffeemachine.brew`** (~6 мин до abort). Дальше копать cm-drv/DrinkX/железо (молоко/кофе) в том же окне.

---

## 8. Куда не ходить в первую очередь

- `sm-lab-logger` — только если он реально `active` и вы сами его включили; на части комплексов уже снят.
- Перезапуск всего подряд до выгрузки логов — сотрёте контекст в journal (если не persist) и усложните разбор.

---

## 9. Контакты по артефактам

- Конфиги DX 4.X: `C:\myApp\4.X configs` (git), справочник параметров — `CONFIG-REFERENCE.md`
- База знаний сервиса: `docs/SERVICE_ASSISTANT_KNOWLEDGE_BASE.ru.md`
