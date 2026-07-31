/**
 * Пресеты NATS subject / payload для Modules Lab терминала.
 * Источники: cm-drv expose list, ComplexOS dashboard API, лог brew из дашборда.
 */

import { COMPLEXOS_SUBJECTS } from "./complexos-subjects.js";
import { NATS_SUBJECTS } from "./subjects.js";

export type TerminalSubjectPreset = {
  id: string;
  subject: string;
  label: string;
  description: string;
  /** Связанные payload preset id — фильтр в UI */
  payloadIds: string[];
  /**
   * Доп. совпадения subject (RegExp source), напр. pumps\.(milk|coffee)!
   * Если задано — ассоциации применяются и к похожим subjects.
   */
  subjectPattern?: string;
};

export type TerminalPayloadPreset = {
  id: string;
  label: string;
  description: string;
  /** Подсказка, с какими subjects обычно используют */
  subjectsHint: string;
  payload: Record<string, unknown>;
};

const HWID_PAYLOADS = [
  "empty",
  "hwid-facade",
  "hwid-milk",
  "hwid-coffee",
  "hwid-water",
] as const;

export const TERMINAL_SUBJECT_PRESETS: TerminalSubjectPreset[] = [
  {
    id: "cm-status",
    subject: NATS_SUBJECTS.status,
    label: "CM status",
    description:
      "Снимок датчиков/клапанов. Без hwid — ответят все слушатели; с hwid — один модуль/facade.",
    payloadIds: [...HWID_PAYLOADS],
  },
  {
    id: "cm-muster",
    subject: NATS_SUBJECTS.muster,
    label: "CM muster",
    description: "Discovery модулей cm-drv (hwid списка).",
    payloadIds: ["empty"],
  },
  {
    id: "cm-brew",
    subject: NATS_SUBJECTS.brew,
    label: "CM brew",
    description:
      "Приготовление. Facade (hwid dx) раздаёт parts на milk/coffee. Нужен coffeeRecipe.",
    payloadIds: ["brew-minimal", "hwid-facade", "hwid-milk", "hwid-coffee"],
  },
  {
    id: "cm-milkrinse",
    subject: "coffeemachine.milkrinse!",
    label: "Milk rinse",
    description: "Промывка трубок молока (обычно hwid dx.milk или facade → milk).",
    payloadIds: ["milkrinse-micro", "hwid-milk", "hwid-facade"],
  },
  {
    id: "cm-startcleaning",
    subject: NATS_SUBJECTS.startCleaning,
    label: "Start cleaning",
    description: "Big Wash / named cleaning на cm-drv.",
    payloadIds: ["hwid-facade", "empty", "update-timing"],
  },
  {
    id: "cm-update-config",
    subject: NATS_SUBJECTS.updateConfig,
    label: "Update config",
    description: "Runtime merge конфига cm-drv (timings мойки и др.).",
    payloadIds: ["update-timing", "empty"],
  },
  {
    id: "cm-stop",
    subject: "coffeemachine.stop",
    label: "CM stop",
    description: "Остановить текущую операцию (на DrinkX facade часто throw).",
    payloadIds: ["empty", "hwid-facade"],
  },
  {
    id: "cos-status",
    subject: COMPLEXOS_SUBJECTS.status,
    label: "OS status",
    description: "Режим ComplexOS, pause, alerts, version.",
    payloadIds: ["empty"],
  },
  {
    id: "cos-dump",
    subject: COMPLEXOS_SUBJECTS.dumpDevices,
    label: "Dump devices",
    description: "Полный снимок устройств/очередей дашборда.",
    payloadIds: ["empty"],
  },
  {
    id: "cos-cleaning-cfg",
    subject: COMPLEXOS_SUBJECTS.cleaningConfig,
    label: "Cleaning config",
    description: "Тайминги мойки (read-only dump).",
    payloadIds: ["empty"],
  },
  {
    id: "cos-pause",
    subject: COMPLEXOS_SUBJECTS.pause,
    label: "OS pause",
    description: "Пауза/снятие паузы очереди заказов.",
    payloadIds: ["pause-true", "pause-false"],
  },
  {
    id: "cos-transition",
    subject: COMPLEXOS_SUBJECTS.transition,
    label: "OS transition",
    description: "Смена режима: service / launch / debug / ready.",
    payloadIds: ["transition-service", "transition-launch"],
  },
  {
    id: "cos-cm-action",
    subject: COMPLEXOS_SUBJECTS.cmAction,
    label: "CM action",
    description: "Действия через OS: start-cleaning, stop, restart, setSupply…",
    payloadIds: ["start-cleaning-os", "empty"],
  },
  {
    id: "valve-status",
    subject: "valves.status.milk-milkInput",
    label: "Valve status (example)",
    description: "Шаблон valves.status.<host>-<baseId>. Замените id клапана.",
    payloadIds: ["empty", "hwid-milk", "hwid-coffee", "hwid-water"],
    subjectPattern: "^valves\\.(status\\.|stop\\.)",
  },
  {
    id: "pump-cmd",
    subject: "pumps.milk!",
    label: "Pump start",
    description: "pumps.<host>! — forward/reverse + duration/power.",
    payloadIds: ["pump-forward", "pump-reverse", "empty"],
    subjectPattern: "^pumps\\.(milk|coffee)!$",
  },
];

export const TERMINAL_PAYLOAD_PRESETS: TerminalPayloadPreset[] = [
  {
    id: "empty",
    label: "{} пустой",
    description: "Без фильтра hwid — status/muster/dump ответят всем, кто слушает.",
    subjectsHint: "status, muster, dump-devices, cleaning-config",
    payload: {},
  },
  {
    id: "hwid-facade",
    label: "hwid facade dx",
    description: "Целевой facade DrinkX (агрегат milk+coffee+water).",
    subjectsHint: "coffeemachine.status, brew, startcleaning",
    payload: { hwid: "dx" },
  },
  {
    id: "hwid-milk",
    label: "hwid dx.milk",
    description: "Только молочный модуль.",
    subjectsHint: "status, milkrinse, valves/pumps milk",
    payload: { hwid: "dx.milk" },
  },
  {
    id: "hwid-coffee",
    label: "hwid dx.coffee",
    description: "Только кофейный модуль.",
    subjectsHint: "status, brew slave",
    payload: { hwid: "dx.coffee" },
  },
  {
    id: "hwid-water",
    label: "hwid dx.water",
    description: "Только водяной модуль.",
    subjectsHint: "status, water valves",
    payload: { hwid: "dx.water" },
  },
  {
    id: "milkrinse-micro",
    label: "milkrinse micro",
    description:
      "Промывка трубок: tubesLength·150 мс насоса. Как ComplexOS microrinse (~1000).",
    subjectsHint: "coffeemachine.milkrinse!",
    payload: {
      hwid: "dx.milk",
      tubes: true,
      tubesLength: 1000,
      nozzleId: 0,
    },
  },
  {
    id: "pause-true",
    label: "pause queue",
    description: "Остановить приём/движение очереди заказов.",
    subjectsHint: "complexos.core.pause",
    payload: { pause: true },
  },
  {
    id: "pause-false",
    label: "resume queue",
    description: "Снять pause очереди.",
    subjectsHint: "complexos.core.pause",
    payload: { pause: false },
  },
  {
    id: "transition-service",
    label: "mode → service",
    description: "Переход в maintenance/service с normal.",
    subjectsHint: "complexos.core.transition",
    payload: { transition: "service" },
  },
  {
    id: "transition-launch",
    label: "mode → launch",
    description: "Выход из maintenance в normal (launch).",
    subjectsHint: "complexos.core.transition",
    payload: { transition: "launch" },
  },
  {
    id: "start-cleaning-os",
    label: "Big Wash via OS",
    description: "Старт мойки через ComplexOS devices.cm.action.",
    subjectsHint: "complexos.devices.cm.action",
    payload: {
      action: "start-cleaning",
      coffeeMachineId: "dx",
      name: "Big Wash",
    },
  },
  {
    id: "update-timing",
    label: "update-config timing",
    description: "Пример runtime merge timings мойки.",
    subjectsHint: "coffeemachine.update-config",
    payload: {
      startCleaningPurgeDelay: 150000,
      postAfterCleaningWash: 150000,
    },
  },
  {
    id: "pump-forward",
    label: "pump forward 3s",
    description: "Включить насос вперёд на 3 с, power PWM 0–255.",
    subjectsHint: "pumps.milk! / pumps.coffee!",
    payload: { duration: 3000, power: 200, direction: "forward" },
  },
  {
    id: "pump-reverse",
    label: "pump reverse 1s",
    description: "Реверс насоса 1 с (если прошивка поддерживает direction).",
    subjectsHint: "pumps.milk! / pumps.coffee!",
    payload: { duration: 1000, power: 180, direction: "reverse" },
  },
  {
    id: "brew-minimal",
    label: "brew minimal (lab)",
    description:
      "Упрощённый brew как в логе дашборда: facade hwid=dx + coffeeRecipe.parts. Для поля опасен — лучше Modules Lab.",
    subjectsHint: "coffeemachine.brew",
    payload: {
      hwid: "dx",
      nozzleId: "0",
      meta: { comment: "service-monitor terminal" },
      coffeeRecipe: {
        Name: "Lab",
        parts: [
          {
            type: "coffee",
            qty: 2000,
            temp: 65,
            airPercent: 0,
            productionOrder: 1,
          },
        ],
      },
    },
  },
];

/** Найти builtin subject preset по точному subject или pattern. */
export function findSubjectPresetFor(
  subject: string
): TerminalSubjectPreset | undefined {
  const exact = TERMINAL_SUBJECT_PRESETS.find((p) => p.subject === subject);
  if (exact) return exact;
  return TERMINAL_SUBJECT_PRESETS.find((p) => {
    if (!p.subjectPattern) return false;
    try {
      return new RegExp(p.subjectPattern).test(subject);
    } catch {
      return false;
    }
  });
}

/**
 * Id связанных payload (builtin id или `custom:<id>`).
 * customAssociations — из сохранённых subjects пользователя.
 */
export function associatedPayloadIds(
  subject: string,
  customAssociations?: Array<{ subject: string; payloadIds?: string[] }>
): string[] {
  const custom = customAssociations?.find((s) => s.subject === subject);
  if (custom?.payloadIds && custom.payloadIds.length > 0) {
    return [...custom.payloadIds];
  }
  const builtin = findSubjectPresetFor(subject);
  return builtin ? [...builtin.payloadIds] : [];
}

/** Правила формирования payload (для UI / справки). */
export const TERMINAL_PAYLOAD_RULES = `
Правила payload (DrinkX / ComplexOS):

1. Обёртка запроса — обычный JSON-объект. cm-drv слушает через defWithAck:
   если указан hwid и он ≠ hwid процесса — ответа не будет (timeout).

2. hwid:
   - "dx" — facade (агрегат)
   - "dx.milk" | "dx.coffee" | "dx.water" — конкретный модуль
   - без hwid — ответят все, у кого !params.hwid || match

3. coffeemachine.status — обычно {} или { hwid }. Ответ:
   { success, result: { sensors, valves?, format? } } или facade milkSensors/…

4. coffeemachine.brew (из лога дашборда):
   {
     hwid, nozzleId, meta: { orderId, traceId, … },
     coffeeRecipe: { Name, parts: [ { type, qty, temp, … } ], valves?, beanHopper? },
     idempotenceKey?, sync?  // sync ставит facade при раздаче slaves
   }
   qty у milk/coffee — миллисекунды работы насоса (не мл!).

5. milkrinse!: { hwid?, tubes: true, tubesLength, nozzleId }
   Время ≈ tubesLength * 150 мс + reverse-циклы на milk.

6. pumps.<host>!: { duration ms, power 0–255 PWM, direction?: "forward"|"reverse" }

7. valves.<host>-<id>! / valves.stop.…! — обычно {} или { hwid, meta }

8. complexos.core.* — без cm hwid; pause: { pause: bool }; transition: { transition: string }

9. complexos.devices.cm.action — { action, coffeeMachineId, … }

Где смотреть в ERP release:
- cm-drv/coffeemachine-drv.js — список expose subjects
- cm-drv/drivers/dx/direct-device-api.js — pumps/valves/heaters payload
- complexos/api/dashboard-api.ts — complexos.* subjects
- complexui/web/monitor.ts — как дашборд шлёт те же команды
- Лог заказа в Dashboard → Logs: реальные brew Incoming/Response
`.trim();
