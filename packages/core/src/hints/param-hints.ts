/**
 * Contextual help для параметров drinkx.json.
 * Источники: cm-drv/drivers/drinkx.js, dx/pid.js, KB инженера.
 */

export interface ParamHint {
  path: string;
  title: string;
  /** Зачем параметр / что делает в коде. */
  summary: string;
  /** Где в cm-drv используется. */
  codeRef?: string;
  warnings?: string[];
}

const HINTS: ParamHint[] = [
  {
    path: "refill.currentTreshold",
    title: "Порог тока «есть жидкость»",
    summary:
      "Сравнивается с датчиком pump_R_IS (ток насоса). В brew/refill: если R_IS < порога — считается сухой ход; если ≥ порога — продукт есть. Правило калибровки: thr ≈ ток_сухого − 0.01.",
    codeRef:
      "cm-drv/drivers/drinkx.js — brew: temps.pump_R_IS >= Cfg.refill.currentTreshold; refill: current > / < currentTreshold",
    warnings: [
      "Опечатка в имени: Treshold (так в коде). Не переименовывать.",
      "Молоко: на мощности 20–55 замер «с жидкостью» часто врёт — калибруйте на P≥60.",
      "Эталон milk: 0.8; дефолт в коде 1.1 (gear pump).",
    ],
  },
  {
    path: "refill.pumpPower",
    title: "Мощность насоса при refill",
    summary:
      "PWM насоса при дозаправке/рефилле (0–255). Если не задан — берётся defaultPumpPower.",
    codeRef:
      "drinkx.js refill: clamp(Cfg.refill.pumpPower ?? Cfg.defaultPumpPower)",
  },
  {
    path: "brew.dryBrewTimelimit",
    title: "Таймаут сухого хода (мс)",
    summary:
      "Сколько мс подряд можно качать при «сухом» токe/flow, прежде чем объявить out-of-milk/coffee/water (алерт, код 614). На water при volumetric смотрит flowRate==0.",
    codeRef:
      "drinkx.js brew loop: if (dryBrewDuration >= Cfg.brew.dryBrewTimelimit) → Out of … detected",
    warnings: [
      "Дефолт в коде 3000; на milk в KB часто 15000 — меньше ложных пустот.",
      "Слишком большое значение дольше крутит сухой насос/тен.",
    ],
  },
  {
    path: "flowFactor",
    title: "Калибровка расходомера (имп/мл)",
    summary:
      "Только water + qty≤1000: targetPulses = qty * flowFactor. Задаёт объём через импульсы pulsemeter, а не только по времени/току.",
    codeRef:
      "drinkx.js brew: isVolumetric = dxRole==='water' && flowFactor && qty<=1000; targetPulses = qty * flowFactor",
    warnings: ["На milk/coffee volumetric-ветка не используется."],
  },
  {
    path: "defaultPumpPower",
    title: "Мощность насоса по умолчанию",
    summary:
      "Базовый PWM 0–255 для brew/refill/reverse, если в рецепте нет своего pumpPower. В UI иногда шкала 0–100 — это другая единица; в JSON всегда 0–255.",
    codeRef:
      "drinkx.js: 2.55*p.pumpPower || Cfg.defaultPumpPower; refill/reverse тоже",
  },
  {
    path: "dcm.activeLow",
    title: "Инверсия воздушного клапана (DCM)",
    summary:
      "true — инвертировать бит AirValveInRestrictedPWM (нормально-закрытый клапан пены). false — прямая логика. Ломает аэрацию молока, если неверно.",
    codeRef:
      "drinkx.js setRegs AirValveInRestrictedPWM: Cfg.dcm.activeLow ? (1 ^ b) : b",
    warnings: ["Для milk foam обычно true."],
  },
  {
    path: "dcm",
    title: "Блок DCM (воздух/пена)",
    summary: "Настройки клапана воздуха для текстуры молока.",
    codeRef: "drinkx.js periphery / AirValve PWM",
  },
  {
    path: "heater1",
    title: "PID первого тена",
    summary:
      "Каскад подогрева: цель ≈ recipeTemp−20, measurement=heater1_out, input контура = milk_input. kP/kI/kD — коэффициенты; minOnTreshold — ниже этой цели нагрев не включают.",
    codeRef: "drivers/dx/pid.js createPid; drinkx heatup cascade heater1→heater2",
    warnings: [
      "Эталон milk: kP=20, kI=2, kD=1, minOn≈20. Ansible часто агрессивнее (kP=27).",
      "При manual_drinkx_json_update=false ansible перезапишет файл.",
    ],
  },
  {
    path: "heater1.kP",
    title: "heater1 · пропорциональный коэффициент",
    summary: "Сила реакции на ошибку температуры. Слишком большой — перерегулирование/колебания.",
    codeRef: "pid.js: kp = params.kP * error",
  },
  {
    path: "heater1.kI",
    title: "heater1 · интегральный коэффициент",
    summary: "Убирает остаточную ошибку. Слишком большой — медленный разгон и overshoot.",
    codeRef: "pid.js интегральная составляющая",
  },
  {
    path: "heater1.kD",
    title: "heater1 · дифференциальный коэффициент",
    summary: "Демпфирует скорость изменения ошибки.",
    codeRef: "pid.js дифференциальная составляющая",
  },
  {
    path: "heater1.minOnTreshold",
    title: "heater1 · мин. цель для включения",
    summary:
      "Если target ≤ minOnTreshold — нагрев пропускается (защита от «греть в ноль»).",
    codeRef: "pid.js: if (state.target > minOnTreshold) heat else skip",
  },
  {
    path: "heater2",
    title: "PID второго тена",
    summary:
      "Финишный нагрев: цель = recipeTemp, measurement=heater2_out, вход с heater1_out.",
    codeRef: "drinkx heat cascade; pid.js",
    warnings: ["Эталон milk: kP=12, kI=1.5, kD=2, minOn≈30."],
  },
  {
    path: "heater2.kP",
    title: "heater2 · kP",
    summary: "Пропорциональный коэффициент второго тена.",
    codeRef: "pid.js",
  },
  {
    path: "pid.guards",
    title: "Защитные пороги нагрева",
    summary:
      "Guards отключают тен при аномалиях: sensor flowrate≈pump_R_IS (засор/сухо), overheat/measurement — перегрев датчиков.",
    codeRef: "dx/pid.js + anomaly-detector / guards",
    warnings: [
      "Поля pid.flowrateThreshold / flowrateLimit в актуальном cm-drv часто не читаются.",
    ],
  },
  {
    path: "pid.flowrateThreshold",
    title: "Устаревшее поле",
    summary:
      "В актуальном cm-drv не используется. Нижний порог жидкости — refill.currentTreshold.",
    codeRef: "не читается в текущем drinkx.js",
    warnings: ["Не влияет на поведение драйвера."],
  },
  {
    path: "cleaning.temp",
    title: "Температура мойки / таблетки",
    summary:
      "Цель heatup при большой мойке (step заполнения горячей водой / таблетка), обычно ~50°C.",
    codeRef: "drinkx.js doStartCleaning / heatup(Cfg.cleaning.temp)",
  },
  {
    path: "cleaning.pumpPower",
    title: "Мощность насоса раствора мойки",
    summary: "PWM циркуляции моющего раствора.",
    codeRef: "drinkx cleaning / rinse pump power",
  },
  {
    path: "cleaning.purge_time",
    title: "Длительность purge (мс)",
    summary: "Время продувки/слива перед химией в сценарии мойки.",
    codeRef: "cleaning FSM / drinkx purge",
  },
  {
    path: "rinse.temp",
    title: "Температура промежуточных промывок",
    summary: "Цель нагрева на rinse-шагах (часто ~70°C).",
    codeRef: "drinkx rinse heatup(Cfg.rinse.temp)",
  },
  {
    path: "rinse.pumpPower",
    title: "Мощность насоса промывки",
    summary: "PWM на rinse.",
    codeRef: "drinkx rinse",
  },
  {
    path: "rinse.ticks_per_liter",
    title: "Импульсы на литр (калибровка воды)",
    summary: "Пересчёт объёма промывки по pulsemeter.",
    codeRef: "rinse / water volumetric",
  },
  {
    path: "rinse.ticks",
    title: "Объём промывки труб (ticks)",
    summary: "Сколько импульсов на одну промывку труб.",
    codeRef: "rinse config",
  },
  {
    path: "rinse.update_period",
    title: "Период опроса rinse (мс)",
    summary: "Как часто опрашивать счётчик/состояние промывки.",
    codeRef: "rinse.update_period",
  },
  {
    path: "Thermometers",
    title: "Карта термодатчиков",
    summary:
      "Привязка логических имён (milk_input, heater1_out, …) к каналам ADS/NTC/PT. Нужна для PID и защит.",
    codeRef: "govnosensor / periphery + pid measurement keys",
  },
  {
    path: "hwid",
    title: "Hardware ID роли",
    summary: "Идентификатор модуля в NATS (dx.milk / dx.coffee / dx.water).",
    codeRef: "transport / muster",
  },
  {
    path: "label",
    title: "Метка модуля",
    summary: "Человекочитаемая роль (MILK/COFFEE/WATER) для логов и UI.",
    codeRef: "config dump / UI",
  },
];

export function getParamHint(path: string): ParamHint | undefined {
  const exact = HINTS.find((h) => h.path === path);
  if (exact) return exact;
  // Самый длинный префикс
  const prefixed = HINTS.filter(
    (h) => path === h.path || path.startsWith(`${h.path}.`)
  ).sort((a, b) => b.path.length - a.path.length);
  return prefixed[0];
}

export function listParamHints(): readonly ParamHint[] {
  return HINTS;
}

export function suggestCurrentThresholdFromDry(dryAmps: number): number {
  return Math.round((dryAmps - 0.01) * 1000) / 1000;
}
