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
    title: "Карта термодатчиков (ADS1115)",
    summary:
      "Датчики температуры/давления/тока на ADS1115. Софт НЕ калибрует их кнопкой — считает физическую величину по формуле из коэффициентов этого блока. Каждый датчик: Type (NTC / PT / V-напряжение / P-давление), ads (номер ADS1115, обычно 0 или 1), channel (канал ADC 0…3), Rhigh (верхнее плечо делителя, Ом — для NTC/PT), coefficients (параметры перевода R/V → величина, свои для каждого Type).",
    codeRef:
      "~/.config/andromeda/drinkx.json → Thermometers. ⚠ ansible cm_cfg.drinkx может перезаписать файл при деплое, если manual_drinkx_json_update: false. govnosensor / periphery + pid measurement keys.",
    warnings: [
      "Нет offset «+2 °C» и нет процедуры калибровки как у pumpPower — единственный способ повлиять на показания этого блока — коэффициенты (B/R0/A) или замена железа.",
      "Менять B/R0 только если точно известен тип NTC, либо есть сверка с эталонным термометром — иначе можно случайно занизить/завысить факт и спровоцировать перегрев или недогрев напитка.",
      "Рост °C при выключенных тенах — это железо (утечка тепла/датчик у другого источника), не параметр этого блока.",
    ],
  },
  {
    path: "Thermometers.milk_input",
    title: "milk_input — вход PID heater1 (NTC)",
    summary:
      "NTC-термистор на входе молока/жидкости. Формула: T = B·T0/(B+T0·ln(R/R0))−273.15, T0=298.15 К. Эталон DrinkX: B≈3984, R0=10000 Ом, A не используется (обычно 0).",
    codeRef: "PID heater1 input measurement; drivers/dx/pid.js",
    warnings: [
      "Скачет на старте — смотрите на сам milk_input и на kInput в PID heater1, не только на коэффициенты датчика.",
    ],
  },
  {
    path: "Thermometers.heater1_out",
    title: "heater1_out — факт h1 / вход PID heater2 (NTC)",
    summary:
      "NTC на выходе первого тена. Факт для контура heater1 (цель ≈ recipeTemp−20) и одновременно вход измерения для каскада heater2. Формула: T = B·T0/(B+T0·ln(R/R0))−273.15, T0=298.15 К. Эталон DrinkX: B≈3976, R0=50000 Ом.",
    codeRef: "PID heater1 measurement + heater2 input cascade",
    warnings: [
      "Больший B → софт показывает НИЖЕ °C при той же R → PID греет агрессивнее (риск перегрева факта, который PID не видит).",
      "Занижен B / плохой контакт NTC / неверный R0 или Rhigh → «не догревает / долго».",
    ],
  },
  {
    path: "Thermometers.heater2_out",
    title: "heater2_out — факт h2 = цель рецепта (NTC)",
    summary:
      "NTC на выходе второго тена — финальная температура к цели рецепта (measurement героя каскада, цель = recipeTemp). Формула: T = B·T0/(B+T0·ln(R/R0))−273.15, T0=298.15 К. Эталон DrinkX: B≈3976, R0=50000 Ом.",
    codeRef: "PID heater2 measurement (финальный контур)",
    warnings: [
      "Пример из практики: B=5100 вместо эталонных 3976 на heater*_out — занижение факта, риск перегрева напитка при логе «цель достигнута».",
      "Напиток горячее цели при логе «цель достигнута» → в первую очередь проверяйте завышенный B именно здесь.",
    ],
  },
  {
    path: "Thermometers.heater1_overheat",
    title: "heater1_overheat — защита PT100, не цель налива",
    summary:
      "PT100 защитный датчик перегрева первого контура. Модель PT: T ≈ линеаризация по A/B/R0 (стандартная кривая PT100). Эталон: A≈3.9083e-3, B≈−5.775e-7, R0=1000 Ом. Используется только для защиты — не участвует в цели налива напрямую.",
    codeRef: "overheat guard / anomaly-detector",
  },
  {
    path: "Thermometers.heater2_overheat",
    title: "heater2_overheat — защита PT100, не цель налива",
    summary:
      "PT100 защитный датчик перегрева второго контура. Та же модель, что heater1_overheat: A≈3.9083e-3, B≈−5.775e-7, R0=1000 Ом. Защита, не цель.",
    codeRef: "overheat guard / anomaly-detector",
  },
  {
    path: "Thermometers.pump_R_IS",
    title: "pump_R_IS — ток насоса (Type V), не температура",
    summary:
      "Type V — напряжение читается напрямую (без формулы NTC/PT). Показывает ток насоса: пусто/засор диагностируется по этому каналу, а не по температуре. Тот же ключ используется в refill.currentTreshold (порог «есть жидкость»).",
    codeRef: "cm-drv/drivers/drinkx.js refill/brew: temps.pump_R_IS",
  },
  {
    path: "Thermometers.pump_L_IS",
    title: "pump_L_IS — ток левого насоса (Type V)",
    summary:
      "Type V — напряжение напрямую, аналог pump_R_IS для второго/левого насоса. Не температура.",
    codeRef: "cm-drv drinkx.js — второй насос",
  },
  {
    path: "Thermometers.water_pressure",
    title: "water_pressure — давление (Type P)",
    summary:
      "Type P — линейная интерполяция по p_min/p_max и v_min_5v/v_max_5v (не формула NTC/PT). Присутствует, если на модуле есть датчик давления воды.",
    codeRef: "P-type linear interpolation (p_min/p_max, v_min_5v/v_max_5v)",
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
