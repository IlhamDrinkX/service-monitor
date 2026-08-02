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
    title: "Сироп / dozator (стенд)",
    body: "SSH Host dozator → modbus-cli: scan (maxId/baud) и motor (id/sec/intensity). Для готового комплекса — «Сиропы · NATS».",
  },
  "modules.sirupNats": {
    id: "modules.sirupNats",
    title: "Сиропы комплекса (NATS)",
    body: "complexos.sirup.muster / status / pump / unpump / stop через сессию. Status: только forward|reverse|stopped (ток/напряжение нет). Muster часто отдаёт все 30 id (MAX_MOTORS): включённые и заблокированные в дашборде обычно отвечают при спокойном опросе; физически отсутствующие — timeout. Параллельный bulk перегружает шину (ложные timeout). «Опрос всех»: последовательно (concurrency 1), ответившие по строке, таймауты схлопываются + сводка. Pump/unpump — сервисный пароль + confirm. Стенд Modbus/flash — свёрнут.",
  },
  "modules.flash": {
    id: "modules.flash",
    title: "Flash сироп",
    body: "Part A/B через flash-cli.js на dozator (currentId/newId/baud). Лог стримится в UI.",
  },
  "modules.flashObraz": {
    id: "modules.flashObraz",
    title: "flash_obraz",
    body: "Отдельное окно ansible-деплоя образа (вкладка «Дозатор»). Полный in-app port — позже. Нужны Host ansible/pusk в ssh config.",
  },
  "nav.modules": {
    id: "nav.modules",
    title: "Модули",
    body: "DrinkX Industrial Control: клапаны, насос, тены, Lab-сценарии (milkrinse/brew), терминал NATS. NATS из сессии. Сироп и flash_obraz — вкладка «Дозатор».",
  },
  "nav.peripherals": {
    id: "nav.peripherals",
    title: "Дозатор",
    body: "NATS-сиропы на комплексе (muster/status/pump/unpump). Стенд Host dozator (Modbus/flash) — свёрнут по умолчанию. Legacy flash_obraz / sirup_test.",
  },
  "nav.pos": {
    id: "nav.pos",
    title: "Касса / ККТ",
    body: "Принтер чеков/этикеток (ft-printer-drv) и эквайринг (ft-payments-drv) через NATS. Health — без пароля; закрытие смены и тест этикетки — после пароля кассы.",
  },
  "nav.labLogger": {
    id: "nav.labLogger",
    title: "Бортовой лог",
    body: "Установка Python lab-logger на complexos (серия 4.x): /home/pi/sm-lab-logger + systemd --user. Опрос той же картины, что Modules Lab (NATS valves/heaters/pumps + DX :8000 токи/ШИМ). Два режима просмотра: realtime (SSH curl /lab/events → окно графика) и скачивание полного ring (.jsonl). На комплексе — delta+heartbeat. Без плотного Lab dual-poll с ноутбука.",
  },
  "labLogger.path": {
    id: "labLogger.path",
    title: "Путь установки",
    body: "Канонический каталог на complexos: /home/pi/sm-lab-logger (пользователь SSH pi). Unit: /home/pi/.config/systemd/user/sm-lab-logger.service. Install, статус и autostart всегда смотрят на эти же пути — не $HOME другого пользователя.",
  },
  "labLogger.uninstall": {
    id: "labLogger.uninstall",
    title: "Удаление",
    body: "stop/disable unit (если unit нет — soft ok), daemon-reload, удаляет весь каталог /home/pi/sm-lab-logger (код + data/ + lock) и unit-файл. По умолчанию стереть всё. Не трогает другие сервисы complexos.",
  },
  "labLogger.install": {
    id: "labLogger.install",
    title: "Установка логгера",
    body: "Заливает бандл в /home/pi/sm-lab-logger, soft pip install nats-py, ставит unit, daemon-reload, enable+start. Источник по умолчанию — NATS 127.0.0.1:4222 (тот же poll set, что Modules: клапаны MODULE_VALVES, тэны, насосы, DX HTTP .44/.45/.46:8000). Без nats-py → source=idle (soft). FakeSource только явно (--fake-source).",
  },
  "labLogger.status": {
    id: "labLogger.status",
    title: "Статус",
    body: "Проверяет main.py/пакет, systemctl --user, процесс python и curl /lab/health. source=NATS — живой poll; source=idle — нет nats-py/NATS. «установлен (остановлен)» — файлы есть, сервис не active.",
  },
  "labLogger.autostart": {
    id: "labLogger.autostart",
    title: "Autostart",
    body: "systemctl --user enable/disable sm-lab-logger + loginctl enable-linger (чтобы user-unit жил без графической сессии). После enable сервис стартует сразу.",
  },
  "labLogger.retention": {
    id: "labLogger.retention",
    title: "Retention",
    body: "Пишет retain_hours в /home/pi/sm-lab-logger/config.json и делает restart unit. Диапазон обычно 1–168 ч.",
  },
  "labLogger.view": {
    id: "labLogger.view",
    title: "Превью snapshot / events",
    body: "Разово читает /lab/snapshot и /lab/events через SSH curl на 127.0.0.1:8765 — для проверки HTTP. Полный архив — кнопка «Скачать полный ring». Не включает Modules Lab telemetry.",
  },
  "labLogger.realtime": {
    id: "labLogger.realtime",
    title: "Realtime",
    body: "Тянет /lab/events с complexos и рисует seriesKey как Modules (milk.drain, *.heater1_pwm, *.pumpCurrent, …). Не стартует плотный LabTelemetry на ноутбуке. Интервал по умолчанию 1500 ms, минимум 1000 ms (SSH).",
  },
  "labLogger.download": {
    id: "labLogger.download",
    title: "Скачать полный ring",
    body: "Копирует data/lab-events.jsonl с complexos. Диалог только *.jsonl; путь принудительно нормализуется (Windows .txt / без расширения → .jsonl).",
  },
  "nav.complexos": {
    id: "nav.complexos",
    title: "ComplexOS",
    body: "Статус ОС, dump устройств, pause/режимы, Big Wash, cleaning timings. Опасные команды — после сервисного пароля (Настройки).",
  },
  "pos.unlock": {
    id: "pos.unlock",
    title: "Пароль кассы — разблокировка",
    body: "Пароль кассы для критических действий (закрытие смены, тест печати этикетки). Разблокировка держится в sessionStorage вкладки до «Заблокировать» или закрытия окна.",
  },
  "pos.printerMuster": {
    id: "pos.printerMuster",
    title: "Printer muster",
    body: "complexos.printer.muster — узнать hwid принтера (обычно kiosk2). Только чтение, пароль не нужен.",
  },
  "pos.printerStatus": {
    id: "pos.printerStatus",
    title: "Printer status",
    body: "complexos.printer.status.<hwid> → { connected, workday }. На ATOL — грубый health смены; на barcode (NIIMBOT) почти всегда connected + workday=open. Внимание: при workday=expired драйвер может сам сделать commit (Z) и payments.commit — это side-effect status на complexos.",
  },
  "pos.paymentsMuster": {
    id: "pos.paymentsMuster",
    title: "Payments muster",
    body: "complexos.payments.muster — hwid эквайринга (обычно тот же kiosk2). Только чтение.",
  },
  "pos.paymentsStatus": {
    id: "pos.paymentsStatus",
    title: "Payments status",
    body: "complexos.payments.status.<hwid> → обычно { workday, openedAt }, без поля connected (в отличие от printer.status). Связь/готовность смотрите в payments.check → ready. При workday=expired драйвер может auto-commit. Не charge/refund.",
  },
  "pos.paymentsCheck": {
    id: "pos.paymentsCheck",
    title: "Payments check",
    body: "complexos.payments.check.<hwid> — готовность терминала (sb_pilot / external); это и есть «связь» для payments (поля connected в status нет). На точках без пинпада (external --barcode, напр. 4.7) ready≠наличие Kozen P12. Без списания денег.",
  },
  "pos.healthRefresh": {
    id: "pos.healthRefresh",
    title: "Опрос health",
    body: "Muster + status принтера и платежей + payments.check, плюс SSH-проба Host USB/systemd на complexos (ft-printer-drv / ft-payments-drv + lsusb ATOL 2912 / Kozen 0e8d / NIIMBOT 3513). Printer: connected/workday; payments: workday/openedAt + ready из check. Auto-commit только если смена уже expired (>24ч), не при closed.",
  },
  "pos.barcodeTest": {
    id: "pos.barcodeTest",
    title: "Тест этикетки (barcode)",
    body: "complexos.printer.print-cheque.<hwid> с { barcode, ordernumber }. Печатает тестовую CODE128 на NIIMBOT при --format=barcode (типично 4.7). На atol-wr это попытка фискального чека — не для теста! Нужен пароль кассы + confirm. Не charge.",
  },
  "pos.printerCommit": {
    id: "pos.printerCommit",
    title: "Закрыть смену ККТ",
    body: "complexos.printer.commit.<hwid> — закрытие смены / Z-отчёт на фискальном АТОЛ (печатает). На barcode-режиме commit часто no-op success. Пароль кассы + сильный confirm. Не путать с payments.commit.",
  },
  "pos.paymentsCommit": {
    id: "pos.paymentsCommit",
    title: "Закрыть смену эквайринга",
    body: "complexos.payments.commit.<hwid> — закрытие смены пинпада/эквайринга. Пароль кассы + confirm. Не списывает и не делает refund.",
  },
  "pos.fnView": {
    id: "pos.fnView",
    title: "Статус ФН (VIEW) — скоро",
    body: "Через текущий NATS нет subject для FN/OFD/device info. Нужно расширить atol-fptr10.py (queryData/fnQueryData) и проброс. Офиц. webkkt :16732 на комплексах нет. Пока смотрите «Тест драйвера ККТ» на ПК сервисника.",
  },
  "pos.ofdSettings": {
    id: "pos.ofdSettings",
    title: "ОФД / регистрация — не в SM",
    body: "Адрес ОФД, смена ИНН, регистрация ККТ — libfptr / «Тест драйвера» / политика. Запись настроек из SM не делаем. VIEW OFD exchange status — после расширения wrapper.",
  },
  "pos.factoryWipe": {
    id: "pos.factoryWipe",
    title: "Factory wipe — вне scope",
    body: "Сброс ККТ / Android Kozen — только меню устройства / recovery. Service Monitor намеренно не трогает.",
  },
  "pos.charge": {
    id: "pos.charge",
    title: "Charge / refund — не из SM",
    body: "complexos.payments.charge / refund существуют в drv, но из Service Monitor на живой точке не вызываем (риск денег). Диагностика — status/check.",
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
  "modules.chartLog": {
    id: "modules.chartLog",
    title: "Лог графика",
    body: "Открывает окно графика без активного опроса. Можно импортировать JSON, сохранённый через «Экспорт лога» в окне графика. Работает и без сессии комплекса.",
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
    body: "Последовательно открыть или закрыть все DX-клапаны текущего host (milkInput, drain, …). Не путать с молочными клапанами холодильника.",
  },
  "modules.milkValves": {
    id: "modules.milkValves",
    title: "Молочные клапана холодильника",
    body: "Клапаны 1–6 молочного блока (I2C). Live: status {hwid:dx} milkValves ([] = все OFF) + bus complexos.valves.switched при brew. Жёлтая лампа = ещё не было status/bus. Ручной debug-valves на dx-facade часто Not implemented — UI откатывает optimistic ON.",
  },
  "modules.valvePackage": {
    id: "modules.valvePackage",
    title: "Пакет клапанов",
    body: "Готовая последовательность (flush, foam…). Запуск пакета / Стоп прерывает.",
  },
  "modules.pumpMs": {
    id: "modules.pumpMs",
    title: "Длительность насоса",
    body: "Сколько мс крутить насос после START (500–60000). Это НЕ timeout NATS: команда pumps.*! отвечает сразу {success}, а насос крутится duration мс на модуле. Раньше ACK ждал только 2 с → «pumps.milk! timeout 2000ms» при занятом модуле; сейчас ACK до 12 с.",
  },
  "modules.pumpPower": {
    id: "modules.pumpPower",
    title: "Мощность насоса",
    body: "Мощность в % UI → PWM 0–255 на cm-drv. Enter — к следующему полю.",
  },
  "modules.pumpHeaters": {
    id: "modules.pumpHeaters",
    title: "Насос + тены",
    body: "При START насоса шлёт heaters.*-heater1!/heater2! на target °C (как ERP manual). ШИМ % в Lab — оценка как PidClassic.start: clamp(25…75, (target−temp)×1.5). Это не live PID output (cm-drv его в status не отдаёт). Ток насоса — DX UI temps (вольты).",
  },
  "modules.dxUi": {
    id: "modules.dxUi",
    title: "DX UI ток и ШИМ",
    body: [
      "Ток pump_R/L_IS: HTTP DX UI :8000 (туннель milk :8082→.44, coffee :8083→.45).",
      "Мощность насоса: pumps.status (NATS).",
      "ШИМ тэнов: оценка PidClassic.start — min 25%, max 75%, (target−temp)×1.5.",
      "Пока ΔT < ~17°C оценка залипает на 25% — так же стартует ERP.",
      "",
      "Опрос Lab — один цикл (LabTelemetry): короткая пауза на команду, DX ток не блокируем на весь START.",
      "Жёлтая подсветка датчика = значение давно не обновлялось (stale).",
      "",
      "Пустой ток при живом NATS → IP: milk=.44 (не .33), coffee=.45, water=.46.",
    ].join("\n"),
  },
  "modules.pumpReverse": {
    id: "modules.pumpReverse",
    title: "Реверс насоса",
    body: "pumps.*! direction=reverse. Ток pump_R_IS (V) с DX UI :8000 — тот же канал АЦП, не отрицательный при reverse. Не milkrinse, короткий тест направления.",
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
    body: "Короткий пролив: открыть milkInput/waterInput → pumps.*! duration=5с power=100% (PWM 255; без power ERP взял бы default 100≈39%) → закрыть клапан. Пауза NATS на цикл; DX ток продолжает опрос.",
  },
  "lab.scenarios": {
    id: "lab.scenarios",
    title: "Сценарии Lab",
    body: "Кнопки шлют те же NATS payload, что ERP/ComplexOS. milkrinse длится tubesLength×150 мс + reverse. Ток pump_R_IS (V) — с DX UI модуля (:8000 → .44), не из NATS status; reverse без знака минус. Пустые графики при живом NATS → неверный IP milk (не .33). Stop CM доступен во время rinse.",
  },
  "lab.scenario.status": {
    id: "lab.scenario.status",
    title: "Status модуля",
    body: "coffeemachine.status с hwid текущего Lab-модуля. Только чтение. Ожидайте JSON статуса в логе Lab за ~1 с. Безопасно.",
  },
  "lab.scenario.milkrinseMicro": {
    id: "lab.scenario.milkrinseMicro",
    title: "Micro-rinse",
    body: "Реальный ERP Micro-rinse: coffeemachine.milkrinse! tubesLength=1000 (~150 с forward + reverse). Ток pump_R_IS берётся с HTTP DX UI модуля (:8000 / туннель :8082) — в NATS status его нет. Единица — вольты АЦП (V), не амперы; при reverse значение не становится отрицательным (тот же канал). Stop CM остаётся нажимаемым. Нужен сервисный пароль.",
  },
  "lab.scenario.milkrinseLong": {
    id: "lab.scenario.milkrinseLong",
    title: "Milk rinse",
    body: "milkrinse! tubesLength=1500 (~4 мин). Ток с DX UI milk в вольтах; reverse без знака минус. Stop CM не блокируется. Не Big Wash.",
  },
  "lab.scenario.stopCm": {
    id: "lab.scenario.stopCm",
    title: "Stop CM",
    body: "coffeemachine.stop — оборвать brew/milkrinse/мойку. Кнопка доступна во время другого сценария (не ждёт конца rinse). Confirm + сервисный пароль.",
  },
  "lab.brew": {
    id: "lab.brew",
    title: "Brew Lab",
    body: "Упрощённый coffeemachine.brew: parts с qty в миллисекундах насоса (не мл). Только после пароля + confirm — нальёт в группу.",
  },
  "lab.brew.hwid": {
    id: "lab.brew.hwid",
    title: "Brew hwid",
    body: "dx — facade (раздаёт slaves); dx.milk / dx.coffee — один модуль.",
  },
  "lab.brew.qty": {
    id: "lab.brew.qty",
    title: "qty (мс)",
    body: "Длительность работы насоса в миллисекундах. Не миллилитры.",
  },
  "lab.brew.temp": {
    id: "lab.brew.temp",
    title: "temp °C",
    body: "Целевая температура part (coffee temp / milk milkTemp).",
  },
  "cos.orders": {
    id: "cos.orders",
    title: "Orders",
    body: "complexos.dashboard.orders — очереди waiting/progress/ready и история taked.",
  },
  "cos.stopCm": {
    id: "cos.stopCm",
    title: "Stop CM",
    body: "Остановить brew/мойку через complexos.devices.cm.action { action: stop }. Нужен сервисный пароль.",
  },
  "cos.alertBus": {
    id: "cos.alertBus",
    title: "Live alerts",
    body: "Подписка на complexos.bus.alertCreated/Cleared/helpNeeded → автообновление status.",
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
    body: "Тема уже тёмная. Здесь — Lab опрос в фоне, Debug-режим, сервисный пароль для правок, пути к ключам.",
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
    body: "Remote: :8082 → 192.168.1.44:8000. Local: http://192.168.1.44:8000/. Пустая страница / нет R_IS в Lab → milk не на .44 (часто DHCP даёт .33). Проверьте leases роутера и static IP.",
  },
  "session.coffeeCharts": {
    id: "session.coffeeCharts",
    title: "Графики coffee",
    body: "Remote: :8083 → 192.168.1.45:8000. Local: http://192.168.1.45:8000/. Эталон coffee=.45. Если milk на чужом IP — не путайте туннели; coffee не должен ломаться из‑за milk.",
  },
  "session.waterCharts": {
    id: "session.waterCharts",
    title: "Графики water",
    body: "Remote: :8084 → 192.168.1.46:8000. Local: http://192.168.1.46:8000/. Эталон water=.46.",
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
  "session.healthReport": {
    id: "session.healthReport",
    title: "Health Report",
    body: [
      "Одна кнопка опрашивает весь комплекс: ядро NATS (muster), датчики и DX-токи milk/coffee/water, ComplexOS core, сироп-дозатор, кассу/ККТ и бортовой lab-logger (если установлен).",
      "",
      "Каждый раздел получает статус OK / Внимание / Проблема и (если что-то не так) конкретную рекомендацию что проверить на месте.",
      "",
      "Без активной сессии отчёт покажет только это — подключитесь на этой же вкладке и запустите проверку снова.",
      "«Скопировать отчёт» — простой текст для чата с командой/тикета.",
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
  "settings.labChartLog": {
    id: "settings.labChartLog",
    title: "Открыть лог графика",
    body: "Открывает окно графика комплекса без SSH/NATS. Нажмите «Импорт лога» и выберите JSON, сохранённый через «Экспорт лога» (kind: service-monitor-lab-chart). Масштаб времени, стек/норм, маркер и срез работают как в живом режиме.",
  },
  "settings.labBgTelemetry": {
    id: "settings.labBgTelemetry",
    title: "Lab опрос в фоне",
    body: "Если включено — после SSH-сессии Modules Lab продолжает NATS/DX опрос вне вкладки Модули, и отдельное окно графиков не закрывается при уходе с Модулей. Выкл — опрос только на вкладке Модули (пробелы на графике после возврата). Без сессии окно лога не закрывается при смене вкладки.",
  },
  "settings.labOnboardXor": {
    id: "settings.labOnboardXor",
    title: "Опрос модулей: ноутбук vs бортовой",
    body: "Бортовой lab-logger на complexos (если установлен и запущен) уже опрашивает NATS/DX плотно прямо на комплексе. «Авто» — ноутбук снижает свою частоту опроса (~800мс → ~4с), только когда бортовой realtime подтверждён доступным (раз в ~20с тихая проверка статуса). «Всегда плотный» — игнорировать бортовой, старое поведение. «Всегда сниженный» — экономить всегда, даже без бортового логгера. Ни один режим не переключает вкладку Модули на приём данных с борта — это лишь снижает частоту опроса с ноутбука.",
  },
  "modules.pollThrottled": {
    id: "modules.pollThrottled",
    title: "Опрос снижен (бортовой)",
    body: "Ноутбук опрашивает NATS/DX реже обычного, потому что бортовой lab-logger на complexos уже ведёт плотный опрос этого же комплекса — так шина не получает двойную нагрузку. Изменить поведение: Настройки → «Опрос модулей: ноутбук vs бортовой».",
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
    title: "Модули, дозатор и flash",
    body: [
      "Вкладки:",
      "• «Модули» — встроенный Industrial Control (NATS milk/coffee/water), Lab-сценарии, Brew Lab, терминал.",
      "• «Дозатор» — сироп Modbus/flash partA·B и legacy flash_obraz / sirup_test / flash_sirup.",
      "• «Касса / ККТ» — printer/payments NATS (см. статью «Касса, ККТ и платежи»).",
      "",
      "NATS:",
      "  Local: nats://192.168.1.43:4222",
      "  Remote: SSH jump → туннель 127.0.0.1:14222 → complexos.local:4222",
      "",
      "Сироп: SSH Host dozator → /dev/ttySC0 (прямого сетевого Modbus нет).",
      "flash_obraz: Host ansible/pusk — отдельное окно ansible.",
    ].join("\n"),
  },
  {
    id: "pos-kkt",
    title: "Касса, ККТ и платежи",
    body: [
      "Вкладка «Касса / ККТ» — сервис ft-printer-drv и ft-payments-drv на complexos.",
      "",
      "Пароль кассы (отдельный gate):",
      "• Нужен для закрытия смены и теста этикетки.",
      "• НЕ сервисный пароль правок конфигов (Настройки).",
      "• Разблокировка — в блоке «Сервис» на странице Касса; sessionStorage до «Заблокировать».",
      "",
      "Что уже работает (NATS, без выдуманных subjects):",
      "• Printer: muster, status, commit, print-cheque (тест barcode).",
      "• Payments: muster, status, check, commit.",
      "• Health: printer connected/workday; payments workday/openedAt + ready (check).",
      "• payments.status не отдаёт connected — «связь» = payments.check.ready.",
      "",
      "Два режима печати:",
      "• atol-wr — фискальный АТОЛ (чек в ОФД); commit печатает Z.",
      "• barcode — NIIMBOT B1 этикетка CODE128 (часто 4.7); commit часто no-op.",
      "",
      "Смена ККТ «закрыта» при connected — норма (после Z / ночи); status её не откроет,",
      "открытие обычно на следующей печати/продаже. Auto-commit только при expired (>24ч).",
      "",
      "Осторожно:",
      "• status при workday=expired на драйвере может auto-commit смену.",
      "• Тест этикетки печатает бумагу; на atol-wr print-cheque — фискал, не жмите «тест».",
      "• charge / refund из SM не вызываем.",
      "",
      "Пока недоступно (честно):",
      "• VIEW ФН / ОФД / прошивка ККТ — нет NATS; нужен патч atol-fptr10.py.",
      "• Настройки ОФД, регистрация, factory wipe, Wi‑Fi ККТ — PC / меню устройства.",
      "",
      "Help keys кнопок: pos.* (pos.unlock, pos.printerStatus, pos.barcodeTest, …).",
    ].join("\n"),
  },
  {
    id: "lab-scenarios",
    title: "Сценарии Lab и milkrinse",
    body: [
      "Блок «Сценарии» на вкладке Модули шлёт РЕАЛЬНЫЕ payload как в erp-release",
      "(cm-drv / ComplexOS coffee-machine), не тестовые заглушки.",
      "",
      "• Status модуля — coffeemachine.status, только чтение.",
      "• Micro-rinse — coffeemachine.milkrinse! tubesLength=1000",
      "  (как ComplexOS microrinse). Время ≈ 1000×150 мс = 150 с forward",
      "  + reverse-циклы DrinkX doMilkRinse (~3 мин до ответа NATS).",
      "• Milk rinse — tubesLength=1500 (~4 мин). Не полный Big Wash.",
      "• Stop CM — coffeemachine.stop (оборвать цикл).",
      "• Pump reverse — короткий pumps.*! reverse, не rinse.",
      "",
      "Почему не было тока насоса / ШИМ тэнов:",
      "coffeemachine.status / getStatus() НЕ отдаёт pump_R_IS и PWM —",
      "ток: HTTP DX UI :8000 (temps). ШИМ тэнов в Lab: оценка PidClassic.start",
      "clamp(25…75, (target−temp)×1.5) — DX graph lastlog после brew залипает.",
      "*_heater*_power в status — дубль температуры (type=power), не ШИМ.",
      "Опрос: LabTelemetry (NATS ~800ms + DX ~1s). status primary {hwid:dx}.",
      "Туннель :8082 → milk .44. При reverse R_IS не отрицательный (АЦП Type:V).",
      "",
      "Частая полевая ловушка: milk Pi на 192.168.1.33 вместо .44 (4.7: .33 REACHABLE но не DX).",
      "NATS через complexos может работать, а :8082/графики — пустые.",
      "Эталон: complexos=.43, milk=.44, coffee=.45, water=.46 (референс 4.8).",
      "Проверьте leases роутера / static IP, затем «Графики milk» на Сессии.",
      "",
      "Brew Lab: qty в миллисекундах насоса, не мл. Пароль + confirm.",
      "Water charts: pressure + total_pulses пишутся в ряды каждый NATS tick.",
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
      "• Читать логи и статусы; Lab-сценарии и ComplexOS-сервис",
      "• Дозатор / flash_obraz; правки drinkx.json после сервисного пароля",
      "• Касса / ККТ / платежи (NATS) после пароля кассы",
      "",
      "Платформы сейчас: Windows и macOS. Позже — модуль в Android на том же ядре.",
    ].join("\n"),
  },
  {
    id: "cashdev-gate",
    title: "Пароль кассы",
    body: [
      "Критические действия на вкладке «Касса / ККТ» защищены паролем кассы.",
      "Это другой gate, не сервисный пароль правок drinkx.json.",
      "",
      "• Пароль задаётся в сборке (как и сервисный) — полевому инженеру выдают отдельно.",
      "• После ввода — sessionStorage вкладки; кнопка «Заблокировать» снимает доступ.",
      "• Опасные кнопки показывают confirm с описанием риска и кратким cheat-sheet.",
      "",
      "Сервисный пароль (Настройки) по-прежнему нужен для ComplexOS danger / pump / конфигов.",
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
      "Если Lab/графики milk пустые, а NATS жив — чаще всего milk не на .44",
      "(DHCP иногда выдаёт .33). Правьте static IP / leases, не код опроса.",
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
      "5) milkrinse!: { hwid, tubes, tubesLength, nozzleId } — время ≈ tubesLength×150 мс",
      "   + reverse на milk (DrinkX doMilkRinse). ComplexOS micro = tubesLength 1000.",
      "6) pumps.<host>!: { duration, power 0–255, direction? }.",
      "7) complexos.core.pause { pause }; transition { transition }; cm.action { action, coffeeMachineId }.",
      "",
      "Lab «Сценарии» и Brew Lab используют те же subjects/payload, что ERP.",
      "В Modules → Терминал — пресеты subject/payload и «Запомнить» свои.",
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
      "8082 → milk .44:8000, 8083 → coffee .45:8000, 8084 → water .46:8000.",
      "Если milk на другом IP (.33) — :8082 пустой, Lab без R_IS/ШИМ.",
      "Для дозатора нужен Host dozator в ssh config.",
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
      "Касса / закрытие смены / тест этикетки — отдельный пароль кассы (см. статью «Пароль кассы»).",
      "Помните: при manual_drinkx_json_update=false ansible при деплое перезапишет drinkx.json.",
    ].join("\n"),
  },
];

export function getHelpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id);
}
