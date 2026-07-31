/**
 * Контент раздела Help и краткие подсказки для кнопок (?).
 * Подробности архитектуры — из SERVICE_ASSISTANT_KNOWLEDGE_BASE.
 */

export interface HelpArticle {
  id: string;
  title: string;
  body: string;
}

export interface ControlHelp {
  id: string;
  title: string;
  body: string;
}

/** Краткие хелпы для кнопок UI (знак «?»). */
export const CONTROL_HELPS: Record<string, ControlHelp> = {
  "modules.drinkx": {
    id: "modules.drinkx",
    title: "Управление DrinkX",
    body: "Встроенный Industrial Control: клапаны, насос, нагреватели, flush/пена. NATS из вкладки Сессия — без окна module_test.",
  },
  "modules.nats": {
    id: "modules.nats",
    title: "Встроенный NATS",
    body: "Клиент в main-процессе. URL из сессии: Local nats://192.168.1.43:4222 или Remote :14222.",
  },
  "modules.syrup": {
    id: "modules.syrup",
    title: "Сироп / dozator",
    body: "SSH Host dozator → modbus-cli: scan (maxId/baud) и motor (id/sec/intensity).",
  },
  "modules.flash": {
    id: "modules.flash",
    title: "Flash сироп",
    body: "Part A/B через flash-cli.js на dozator (currentId/newId/baud). Лог стримится в UI.",
  },
  "modules.flashObraz": {
    id: "modules.flashObraz",
    title: "flash_obraz",
    body: "Отдельное окно ansible-деплоя образа. Полный in-app port — позже. Нужны Host ansible/pusk.",
  },
  "nav.modules": {
    id: "nav.modules",
    title: "Модули",
    body: "DrinkX NATS + сироп Modbus + flash partA/B. NATS подключается автоматически при готовой сессии.",
  },
  "nav.complexos": {
    id: "nav.complexos",
    title: "ComplexOS",
    body: "Статус ОС, dump устройств, pause/режимы, Big Wash, cleaning timings. Опасные команды — после сервисного пароля (Настройки).",
  },
  "cos.nats": {
    id: "cos.nats",
    title: "NATS",
    body: "Подключить клиент к NATS комплекса (URL из сессии). Без соединения команды ComplexOS не уйдут.",
  },
  "cos.status": {
    id: "cos.status",
    title: "Status",
    body: "complexos.core.status — режим ОС (normal/service/…), pause, version, alerts, доступные transitions. Безопасно, только чтение.",
  },
  "cos.dump": {
    id: "cos.dump",
    title: "Dump devices",
    body: "complexos.dashboard.dump-devices — полный снимок устройств/очередей. Из ответа можно взять coffeeMachineId (обычно dx).",
  },
  "cos.cleaningConfig": {
    id: "cos.cleaningConfig",
    title: "Cleaning config",
    body: "complexos.dashboard.cleaning-config — текущие timings мойки (мс). Запись — отдельной кнопкой через coffeemachine.update-config.",
  },
  "cos.troubles": {
    id: "cos.troubles",
    title: "Troubles",
    body: "complexos.troubles — диагностический дамп известных проблем/состояний ОС. Только чтение.",
  },
  "cos.pause": {
    id: "cos.pause",
    title: "Pause",
    body: "complexos.core.pause { pause: true } — ставит очередь заказов на паузу (киоск/мобилка не двигают brew). Снять — Resume.",
  },
  "cos.resume": {
    id: "cos.resume",
    title: "Resume",
    body: "complexos.core.pause { pause: false } — снимает паузу очереди, заказы снова обрабатываются.",
  },
  "cos.transition": {
    id: "cos.transition",
    title: "Переход режима",
    body: "complexos.core.transition { transition } — смена режима ОС (service / launch / debug / ready…). Список берётся из status.transitions. Ошибочный переход может оставить киоск offline.",
  },
  "cos.dismissAlert": {
    id: "cos.dismissAlert",
    title: "Dismiss alert",
    body: "complexos.core.alerts.react! — сбросить выбранный alert в статусе ОС. Не чинит железо, только убирает уведомление в UI ОС.",
  },
  "cos.cmId": {
    id: "cos.cmId",
    title: "coffeeMachineId",
    body: "HWID facade кофемашины для команд через ComplexOS (обычно dx). Берите из Dump devices или muster. Неверный id → timeout / no reply.",
  },
  "cos.bigWash": {
    id: "cos.bigWash",
    title: "Start Big Wash",
    body: "complexos.devices.cm.action { action: start-cleaning, name: Big Wash, coffeeMachineId }. Полная мойка на cm-drv. Нужен сервисный пароль. Долго и блокирует налив.",
  },
  "cos.timing.startCleaningPurgeDelay": {
    id: "cos.timing.startCleaningPurgeDelay",
    title: "Purge до мойки",
    body: "startCleaningPurgeDelay (мс) — пауза/purge перед стартом Big Wash. Пишется в runtime cm-drv через update-config.",
  },
  "cos.timing.preAfterCleaningWash": {
    id: "cos.timing.preAfterCleaningWash",
    title: "Pre after wash",
    body: "preAfterCleaningWash (мс) — этап «до» пост-мойки. Влияет на длительность цикла очистки.",
  },
  "cos.timing.postAfterCleaningWash": {
    id: "cos.timing.postAfterCleaningWash",
    title: "Post after wash",
    body: "postAfterCleaningWash (мс) — финальный промыв после мойки. Слишком мало — остатки химии; слишком много — долгий простой.",
  },
  "cos.timing.pumpOutTimeout": {
    id: "cos.timing.pumpOutTimeout",
    title: "Pump out timeout",
    body: "pumpOutTimeout (мс) — таймаут откачки жидкости насосом во время мойки. При обрыве/сухом ходе сработает раньше ошибки.",
  },
  "cos.timing.drainCleaningPurgeDelay": {
    id: "cos.timing.drainCleaningPurgeDelay",
    title: "Drain purge",
    body: "drainCleaningPurgeDelay (мс) — purge/ожидание на этапе слива мойки.",
  },
  "cos.timing.evercleanWorkTime": {
    id: "cos.timing.evercleanWorkTime",
    title: "Everclean work",
    body: "evercleanWorkTime (мс) — время работы реагента Everclean в цикле мойки.",
  },
  "cos.timing.rinsaWorkTime": {
    id: "cos.timing.rinsaWorkTime",
    title: "Rinsa work",
    body: "rinsaWorkTime (мс) — время работы Rinsa (ополаскиватель) в цикле мойки.",
  },
  "cos.saveTimings": {
    id: "cos.saveTimings",
    title: "Записать timings",
    body: "Шлёт изменённые ключи в coffeemachine.update-config (merge runtime). Нужен сервисный пароль. Не пишет osconfig ERP — до рестарта cm-drv значения из файла могут перезатереть.",
  },
  "cos.graceRestart": {
    id: "cos.graceRestart",
    title: "Grace restart OS",
    body: "complexos.core.grace-restart — мягкий перезапуск ComplexOS (дождётся завершения текущих действий, если умеет). Нужен сервисный пароль. Киоск кратковременно недоступен.",
  },
  "cos.forceRestart": {
    id: "cos.forceRestart",
    title: "Force restart OS",
    body: "complexos.core.restart — принудительный рестарт. Оборвёт текущий заказ/мойку. Только при зависании ОС. Нужен сервисный пароль.",
  },
  "modules.terminal": {
    id: "modules.terminal",
    title: "Терминал NATS",
    body: "Ручная отправка subject + JSON. Пресеты — из expose cm-drv и ComplexOS. Свои subject/payload можно запомнить. Лог не прыгает вниз, если вы прокрутили вверх.",
  },
  "modules.terminal.payload": {
    id: "modules.terminal.payload",
    title: "JSON payload",
    body: "Список фильтруется по выбранному subject (ассоциации). Свой payload при сохранении связывается с текущим «куда отправить». Удалить — кнопка «Удалить payload». В большом поле: Ctrl+Enter — Send.",
  },
  "modules.terminal.subject": {
    id: "modules.terminal.subject",
    title: "Subject",
    body: "Куда слать NATS request. При выборе меняется список payload. Свой subject запоминает связь с текущим payload. Enter — к полю payload.",
  },
  "modules.terminal.send": {
    id: "modules.terminal.send",
    title: "Send",
    body: "NATS request на выбранный subject с JSON payload. Ответ пишется в журнал. Ctrl+Enter из поля payload тоже отправляет.",
  },
  "modules.terminal.rememberSubject": {
    id: "modules.terminal.rememberSubject",
    title: "Запомнить subject",
    body: "Сохраняет subject в локальный список ★ и связывает с текущим payload.",
  },
  "modules.terminal.rememberPayload": {
    id: "modules.terminal.rememberPayload",
    title: "Запомнить payload",
    body: "Сохраняет JSON в ★ и привязывает к текущему subject.",
  },
  "modules.terminal.deleteSubject": {
    id: "modules.terminal.deleteSubject",
    title: "Удалить subject",
    body: "Удаляет только свой сохранённый subject и его ассоциации.",
  },
  "modules.terminal.deletePayload": {
    id: "modules.terminal.deletePayload",
    title: "Удалить payload",
    body: "Удаляет свой payload и убирает его из связей subjects.",
  },
  "modules.off": {
    id: "modules.off",
    title: "NATS Off",
    body: "Отключить встроенный NATS-клиент. Опрос датчиков и команды остановятся.",
  },
  "modules.muster": {
    id: "modules.muster",
    title: "Muster",
    body: "coffeemachine.muster — список модулей/hwid в сети. Нужен для выбора правильного hwid.",
  },
  "modules.charts": {
    id: "modules.charts",
    title: "Графики",
    body: "Показать/скрыть live-графики датчиков комплекса по трекам.",
  },
  "modules.tracks": {
    id: "modules.tracks",
    title: "Треки",
    body: "Какие модули опрашивать и какие датчики писать в лог/график. Выключенный модуль не получает status.",
  },
  "modules.csv": {
    id: "modules.csv",
    title: "CSV",
    body: "Выгрузить журнал lab-событий в CSV-файл.",
  },
  "modules.clear": {
    id: "modules.clear",
    title: "Clear",
    body: "Очистить журнал событий в UI (на комплекс не влияет).",
  },
  "modules.host": {
    id: "modules.host",
    title: "Модуль host",
    body: "Активный модуль Lab: milk / coffee / water. Клапаны, насос и тены шлются на этот host.",
  },
  "modules.hwid": {
    id: "modules.hwid",
    title: "hwid",
    body: "Целевой hwid для команд (из muster или default dx.<host>). Неверный hwid → timeout.",
  },
  "modules.valvesAll": {
    id: "modules.valvesAll",
    title: "Открыть/закрыть все",
    body: "Последовательно открыть или закрыть все клапаны текущего host.",
  },
  "modules.valvePackage": {
    id: "modules.valvePackage",
    title: "Пакет клапанов",
    body: "Готовая последовательность (flush, foam…). Запуск пакета / Стоп прерывает.",
  },
  "modules.pumpMs": {
    id: "modules.pumpMs",
    title: "Длительность насоса",
    body: "Сколько мс крутить насос при START / реверсе (обычно 500–60000).",
  },
  "modules.pumpPower": {
    id: "modules.pumpPower",
    title: "Мощность насоса",
    body: "Мощность в % UI → PWM 0–255 на cm-drv. Enter — к следующему полю.",
  },
  "modules.pumpHeaters": {
    id: "modules.pumpHeaters",
    title: "Насос + тены",
    body: "При старте насоса одновременно включить нагреватели на target °C.",
  },
  "modules.pumpReverse": {
    id: "modules.pumpReverse",
    title: "Реверс насоса",
    body: "pumps.*! с direction=reverse. Нужна прошивка cm-drv с поддержкой reverse.",
  },
  "modules.heaterTarget": {
    id: "modules.heaterTarget",
    title: "target °C",
    body: "Целевая температура нагревателей / прогрева.",
  },
  "modules.heaterMaxOut": {
    id: "modules.heaterMaxOut",
    title: "max out °C",
    body: "Верхний предел overheat/output при прогреве — защита от перегрева.",
  },
  "modules.heaterAutoStop": {
    id: "modules.heaterAutoStop",
    title: "авто-стоп",
    body: "Через сколько секунд после выхода на target выключить тены в режиме прогрева.",
  },
  "modules.warmup": {
    id: "modules.warmup",
    title: "Прогрев",
    body: "Включить тены и вести до target с контролем max out / авто-стоп.",
  },
  "modules.flush": {
    id: "modules.flush",
    title: "Flush",
    body: "Сервисный пролив молока или воды через клапаны/насос (короткий цикл).",
  },
  "nav.fleet": {
    id: "nav.fleet",
    title: "Флот",
    body: "Вход в ERP (email/пароль) и список комплексов из облака. Можно открыть облачный дашборд точки.",
  },
  "nav.access": {
    id: "nav.access",
    title: "Доступ",
    body: "Создание SSH-ключа, копирование pubkey в ERP и настройка профиля комплекса / ssh config.",
  },
  "nav.session": {
    id: "nav.session",
    title: "Сессия",
    body: "После подключения: дашборд, киоск, устройства в сети, логи. По умолчанию только просмотр.",
  },
  "nav.help": {
    id: "nav.help",
    title: "Справка",
    body: "Как устроен комплекс DrinkX и как пользоваться этим приложением.",
  },
  "nav.config": {
    id: "nav.config",
    title: "Конфиг",
    body: "drinkx.json на модулях + timings мойки ComplexOS (cleaning-config / update-config). Запись после сервисного пароля.",
  },
  "config.load": {
    id: "config.load",
    title: "Загрузить",
    body: "Читает drinkx.json по SSH с паролем pi (библиотека ssh2). Local: напрямую. Remote: туннель :22044–22046.",
  },
  "config.save": {
    id: "config.save",
    title: "Сохранить",
    body: "Пишет JSON на модуль паролем pi. Нужны активная сессия и разблокировка правок. Пишется audit-лог.",
  },
  "nav.settings": {
    id: "nav.settings",
    title: "Настройки",
    body: "Тема уже тёмная. Здесь — Debug-режим, сервисный пароль для правок, пути к ключам.",
  },
  "access.generateKey": {
    id: "access.generateKey",
    title: "Создать SSH-ключ",
    body: "Генерирует пару ed25519 на этой машине. Публичный ключ нужно вставить в ERP → Профиль → SSH key.",
  },
  "access.copyPubkey": {
    id: "access.copyPubkey",
    title: "Копировать pubkey",
    body: "Копирует содержимое id_ed25519.pub в буфер — целиком одной строкой ssh-ed25519 …",
  },
  "access.copySnippet": {
    id: "access.copySnippet",
    title: "Копировать snippet",
    body: "Только блок Host комплекса (без повторного erp.fibbee.com). Jump добавляется в файл один раз при первой записи.",
  },
  "access.applyConfig": {
    id: "access.applyConfig",
    title: "Записать в ~/.ssh/config",
    body: "Добавляет или обновляет Host комплекса. Блок ERP (User tun) дописывается только если его ещё нет в config.",
  },
  "access.openConfig": {
    id: "access.openConfig",
    title: "Открыть ssh config",
    body: "Открывает ~/.ssh/config в редакторе по умолчанию для ручной правки.",
  },
  "session.connect": {
    id: "session.connect",
    title: "Подключить",
    body: "Remote: SSH через erp.fibbee.com + туннель (NATS :14222). Local: вы в Wi‑Fi комплекса — прямые IP 192.168.1.x и NATS :4222. Красная подсветка, если нет связи с модулями.",
  },
  "session.dashboard": {
    id: "session.dashboard",
    title: "Дашборд комплекса",
    body: "Remote: туннель :8080 → 192.168.1.43:80. Local: http://192.168.1.43/…",
  },
  "session.kiosk": {
    id: "session.kiosk",
    title: "Киоск",
    body: "Экран заказа ordering на complexos (через туннель или напрямую в LAN).",
  },
  "session.milkCharts": {
    id: "session.milkCharts",
    title: "Графики milk",
    body: "Remote: :8082 → .44:8000. Local: http://192.168.1.44:8000/",
  },
  "session.coffeeCharts": {
    id: "session.coffeeCharts",
    title: "Графики coffee",
    body: "Remote: :8083 → .45:8000. Local: http://192.168.1.45:8000/",
  },
  "session.waterCharts": {
    id: "session.waterCharts",
    title: "Графики water",
    body: "Remote: :8084 → .46:8000. Local: http://192.168.1.46:8000/",
  },
  "session.router": {
    id: "session.router",
    title: "Роутер (.1)",
    body: [
      "Проверка идёт по HTTP :80 (веб-морда настройки роутера).",
      "",
      "Offline ≠ «роутер мёртв»: часто на роутере просто нет веб-интерфейса",
      "на 80 порту (или он выключен). Сеть при этом может работать нормально.",
      "",
      "Online — открылась HTTP-морда на 192.168.1.1 (через туннель :8081).",
    ].join("\n"),
  },
  "session.network": {
    id: "session.network",
    title: "Устройства в сети",
    body: [
      "Эталон DrinkX (HTTP+NATS) и ARP с complexos: другие IP в 192.168.1.x — «другое».",
      "Для «других» показываем hostname (если DNS/hosts знает) и MAC.",
      "",
      "Роутер offline: смотрим только веб на :80 — см. подсказку у кнопки «Роутер».",
    ].join("\n"),
  },
  "session.unlockWrite": {
    id: "session.unlockWrite",
    title: "Разблокировать правки",
    body: "Введите сервисный пароль от админа/разработчика приложения (не ERP). Без него конфиги только для чтения.",
  },
  "settings.debug": {
    id: "settings.debug",
    title: "Debug-режим",
    body: "Пишет подробные логи на диск. При сбое приложите файл из папки debug-logs в чат с ассистентом.",
  },
};

export function getControlHelp(id: string): ControlHelp | undefined {
  return CONTROL_HELPS[id];
}

/** Длинные статьи раздела Help. */
export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "erp-cloud",
    title: "Облачный флот ERP",
    body: [
      "Вкладка «Флот» использует API erp.fibbee.com:",
      "• POST /v1/auth/create — JWT",
      "• заголовок x-auth-token (не Bearer)",
      "• GET /v1/sales-points/list — комплексы и статусы",
      "",
      "«Дашборд ERP» открывает /dashboard/view/{id}/dashboard.html?token=…",
      "Это облачный monitor. Локальный UI комплекса (после SSH) — на вкладке Сессия.",
      "Пароль ERP не сохраняется; токен лежит в данных приложения.",
    ].join("\n"),
  },
  {
    id: "module-tools",
    title: "Тест модулей и сиропа",
    body: [
      "Вкладка «Модули» связана с вашими утилитами fleet-foundry:",
      "",
      "• module_test (Industrial Service Control) — NATS к milk/coffee/water",
      "  Локально: nats://192.168.1.43:4222",
      "  Удалённо: SSH jump → туннель 127.0.0.1:14222 → complexos.local:4222",
      "",
      "• sirup_test / flash_sirup — сиропный dozator по SSH + Modbus /dev/ttySC0",
      "  Прямого сетевого Modbus нет — только через Pi dozator.",
      "",
      "• flash_obraz — выкладка образа/конфигов",
      "",
      "Позже тот же протокол будет внутри Service Monitor (без отдельного окна).",
    ].join("\n"),
  },
  {
    id: "about-app",
    title: "Что делает Service Monitor",
    body: [
      "Приложение для полевых инженеров Fibbee / Andromeda (DrinkX).",
      "",
      "• Смотреть флот комплексов (облако ERP + локальные профили)",
      "• Подключаться удалённо через SSH jump или локально по Wi‑Fi комплекса",
      "• Открывать дашборд, киоск и список устройств (hostname + IP)",
      "• Читать логи и статусы",
      "• Менять drinkx.json только после сервисного пароля, с подсказками по параметрам",
      "",
      "Платформы сейчас: Windows и macOS. Позже — модуль в Android-приложении на том же ядре.",
    ].join("\n"),
  },
  {
    id: "how-complex-works",
    title: "Как работает комплекс DrinkX",
    body: [
      "Цепочка команд:",
      "ERP / UI → NATS → complexos (главный Pi) → cm-drv на модулях coffee/milk/water → железо (тены, клапана, насос, датчики).",
      "",
      "Роли модулей (--dx-role):",
      "• coffee — концентрат + нагрев",
      "• milk — молоко + пена (air valve)",
      "• water — горячая вода / мойка",
      "",
      "Налив (brew): MilkInput → насос → heatup → ожидание qty → finally всегда heatdown.",
      "Пустой продукт: ток насоса (pump_R_IS) ниже refill.currentTreshold дольше dryBrewTimelimit → out-of-* и тены OFF.",
      "Если после heaters-stopped температура растёт — скорее железо (аномалия тена), не «норма софта».",
      "",
      "Эталонные IP: complexos .43, milk .44, coffee .45, water .46, router .1.",
    ].join("\n"),
  },
  {
    id: "nats-payloads",
    title: "NATS subjects и payload",
    body: [
      "Где смотреть в erp-release:",
      "• cm-drv/coffeemachine-drv.js — expose subjects (status, brew, milkrinse, startcleaning…)",
      "• cm-drv/drivers/dx/direct-device-api.js — pumps/valves/heaters",
      "• complexos/api/dashboard-api.ts — complexos.*",
      "• Dashboard → Logs — реальные Incoming/Response brew",
      "",
      "Правила:",
      "1) JSON-объект; при hwid ≠ процессу ответа не будет (timeout).",
      "2) hwid: dx (facade) | dx.milk | dx.coffee | dx.water; без hwid — всем слушателям.",
      "3) status/muster/dump — часто {} или { hwid }.",
      "4) brew: { hwid, nozzleId, meta?, coffeeRecipe: { parts: [{ type, qty, temp… }] } }.",
      "   qty у coffee/milk — миллисекунды насоса, не мл!",
      "5) milkrinse!: { tubes, tubesLength, nozzleId } — время ≈ tubesLength×150 мс.",
      "6) pumps.<host>!: { duration, power 0–255, direction? }.",
      "7) complexos.core.pause { pause }; transition { transition }; cm.action { action, coffeeMachineId }.",
      "",
      "В Modules → Терминал есть пресеты subject/payload и «Запомнить» свои.",
    ].join("\n"),
  },
  {
    id: "ssh-access",
    title: "SSH и ERP",
    body: [
      "1. Создайте ключ в приложении (ed25519).",
      "2. Вставьте pubkey в ERP → Профиль → SSH key.",
      "3. Добавьте Host комплекса (порт вида 22415) в ~/.ssh/config — кнопкой «Записать» или snippet.",
      "4. Подключение: ssh <порт> — ProxyJump erp.fibbee.com (User tun), далее pi на комплексе.",
      "",
      "Пробросы после connect:",
      "8080 → complexos:80, 8081 → router:80,",
      "8082 → milk:8000, 8083 → coffee:8000, 8084 → water:8000.",
    ].join("\n"),
  },
  {
    id: "debug-mode",
    title: "Debug и логи для поддержки",
    body: [
      "В Настройках включите Debug — приложение пишет журнал действий и ошибок.",
      "Папка: данные приложения / debug-logs /.",
      "Если что-то не подключилось или UI ведёт себя странно — сохраните лог и приложите его при обращении к разработчику/ассистенту.",
      "Секреты (пароли, токены) в лог не пишутся специально; всё равно не публикуйте логи в открытый доступ.",
    ].join("\n"),
  },
  {
    id: "write-safety",
    title: "Почему правки под паролем",
    body: [
      "По умолчанию режим только чтение — чтобы случайно не сбить PID, порог тока или клапана.",
      "Сервисный пароль задаёт админ/разработчик в сборке приложения (не ERP и не каждый инженер сам).",
      "Полевому инженеру пароль выдают отдельно, если нужны правки drinkx.json.",
      "Помните: при manual_drinkx_json_update=false ansible при деплое перезапишет drinkx.json.",
    ].join("\n"),
  },
];

export function getHelpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id);
}
