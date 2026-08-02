import {
  DRINKX_HOSTS,
  STALE_MS,
  TEMP_SENSOR_LABELS,
  expectedTempKeys,
  isDxSensorLocalName,
  isTelemetryStale,
  seriesKey,
  type DrinkxHost,
  type LabSnapshot,
  type TempSensorKey,
} from "@service-monitor/core";

export type ComplexSensorRow = {
  key: string;
  label: string;
  value: string;
  muted: boolean;
  stale: boolean;
};

export type ComplexSensorModuleInput = {
  mod: DrinkxHost;
  complexTemps: Partial<
    Record<DrinkxHost, Partial<Record<TempSensorKey, number>>>
  >;
  mutedSensorKeys: string[];
  pollStale: boolean;
  actStale: boolean;
  /** hostHealth.natsOk — false → NATS-ряды как «—» */
  natsOk?: boolean | null;
  /** hostHealth.dxOk — false → R_IS/L_IS как «—» */
  dxOk?: boolean | null;
  waterPressure: number | null;
  waterPulses: number | null;
  pumpCurrentByHost: Partial<Record<DrinkxHost, number | null>>;
  pumpCurrentLByHost: Partial<Record<DrinkxHost, number | null>>;
  pumpPowerByHost: Partial<Record<DrinkxHost, number | null>>;
  heaterPwmByHost: Partial<
    Record<DrinkxHost, { heater1?: number; heater2?: number }>
  >;
  host: DrinkxHost;
  pumpOn: boolean | null;
  pumpPower: number;
};

export function telemetryStaleFlags(
  labSnap: LabSnapshot,
  now = Date.now()
): { pollStale: boolean; actStale: boolean } {
  return {
    pollStale: isTelemetryStale(labSnap, STALE_MS.temps, now),
    actStale: isTelemetryStale(labSnap, STALE_MS.actuators, now),
  };
}

/** Показывать «—» вместо last-known при stale / NATS/DX fail. */
export function sensorReadoutOffline(opts: {
  localName: string;
  pollStale: boolean;
  actStale: boolean;
  natsOk?: boolean | null;
  dxOk?: boolean | null;
}): boolean {
  const dx = isDxSensorLocalName(opts.localName);
  if (dx) {
    if (opts.dxOk === false) return true;
    return opts.pollStale;
  }
  if (opts.natsOk === false) return true;
  const actuator =
    opts.localName === "pumpPower" ||
    opts.localName === "heater1_pwm" ||
    opts.localName === "heater2_pwm";
  return actuator ? opts.actStale : opts.pollStale;
}

function formatOrDash(offline: boolean, raw: string | null): string {
  if (offline || raw == null) return "—";
  return raw;
}

export function buildComplexSensorRows(
  input: ComplexSensorModuleInput
): ComplexSensorRow[] {
  const {
    mod,
    complexTemps,
    mutedSensorKeys,
    pollStale,
    actStale,
    natsOk,
    dxOk,
    waterPressure,
    waterPulses,
    pumpCurrentByHost,
    pumpCurrentLByHost,
    pumpPowerByHost,
    heaterPwmByHost,
    host,
    pumpOn,
    pumpPower,
  } = input;

  const offlineFor = (localName: string) =>
    sensorReadoutOffline({ localName, pollStale, actStale, natsOk, dxOk });

  const keys = expectedTempKeys(mod);
  const rows: ComplexSensorRow[] = keys.map((k) => {
    const sk = seriesKey(mod, k);
    const v = complexTemps[mod]?.[k];
    const offline = offlineFor(k);
    return {
      key: sk,
      label: TEMP_SENSOR_LABELS[k],
      value: formatOrDash(offline, v != null ? `${v.toFixed(1)} °C` : null),
      muted: mutedSensorKeys.includes(sk),
      stale: offline,
    };
  });

  if (mod === "water") {
    const pwm1 = heaterPwmByHost[mod]?.heater1;
    const pwm2 = heaterPwmByHost[mod]?.heater2;
    const cur = pumpCurrentByHost[mod];
    const curL = pumpCurrentLByHost[mod];
    const pow = pumpPowerByHost[mod];
    rows.push(
      {
        key: seriesKey("water", "waterPressure"),
        label: "Давление",
        value: formatOrDash(
          offlineFor("waterPressure"),
          waterPressure != null ? `${waterPressure.toFixed(2)} bar` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey("water", "waterPressure")),
        stale: offlineFor("waterPressure"),
      },
      {
        key: seriesKey("water", "waterTotalPulses"),
        label: "Total pulses",
        value: formatOrDash(
          offlineFor("waterTotalPulses"),
          waterPulses != null ? String(waterPulses) : null
        ),
        muted: mutedSensorKeys.includes(seriesKey("water", "waterTotalPulses")),
        stale: offlineFor("waterTotalPulses"),
      },
      {
        key: seriesKey(mod, "pumpCurrent"),
        label: "Насос R_IS",
        value: formatOrDash(
          offlineFor("pumpCurrent"),
          cur != null ? `${cur.toFixed(3)} V` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "pumpCurrent")),
        stale: offlineFor("pumpCurrent"),
      },
      {
        key: seriesKey(mod, "pumpCurrentL"),
        label: "Насос L_IS",
        value: formatOrDash(
          offlineFor("pumpCurrentL"),
          curL != null ? `${curL.toFixed(3)} V` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "pumpCurrentL")),
        stale: offlineFor("pumpCurrentL"),
      },
      {
        key: seriesKey(mod, "pumpPower"),
        label: "Насос мощность",
        value: formatOrDash(
          offlineFor("pumpPower"),
          pow != null ? `${pow} %` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "pumpPower")),
        stale: offlineFor("pumpPower"),
      },
      {
        key: seriesKey(mod, "heater1_pwm"),
        label: "Тэн 1 ШИМ",
        value: formatOrDash(
          offlineFor("heater1_pwm"),
          pwm1 != null ? `${pwm1.toFixed(0)} %` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "heater1_pwm")),
        stale: offlineFor("heater1_pwm"),
      },
      {
        key: seriesKey(mod, "heater2_pwm"),
        label: "Тэн 2 ШИМ",
        value: formatOrDash(
          offlineFor("heater2_pwm"),
          pwm2 != null ? `${pwm2.toFixed(0)} %` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "heater2_pwm")),
        stale: offlineFor("heater2_pwm"),
      }
    );
  }

  if (mod === "milk" || mod === "coffee") {
    const cur = pumpCurrentByHost[mod];
    const curL = pumpCurrentLByHost[mod];
    const pow =
      pumpPowerByHost[mod] ?? (mod === host && pumpOn ? pumpPower : null);
    const pwm1 = heaterPwmByHost[mod]?.heater1;
    const pwm2 = heaterPwmByHost[mod]?.heater2;
    rows.push(
      {
        key: seriesKey(mod, "pumpPower"),
        label: "Насос мощность",
        value: formatOrDash(
          offlineFor("pumpPower"),
          pow != null ? `${pow} %` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "pumpPower")),
        stale: offlineFor("pumpPower"),
      },
      {
        key: seriesKey(mod, "pumpCurrent"),
        label: "Насос R_IS",
        value: formatOrDash(
          offlineFor("pumpCurrent"),
          cur != null ? `${cur.toFixed(3)} V` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "pumpCurrent")),
        stale: offlineFor("pumpCurrent"),
      },
      {
        key: seriesKey(mod, "pumpCurrentL"),
        label: "Насос L_IS",
        value: formatOrDash(
          offlineFor("pumpCurrentL"),
          curL != null ? `${curL.toFixed(3)} V` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "pumpCurrentL")),
        stale: offlineFor("pumpCurrentL"),
      },
      {
        key: seriesKey(mod, "heater1_pwm"),
        label: "Тэн 1 ШИМ",
        value: formatOrDash(
          offlineFor("heater1_pwm"),
          pwm1 != null ? `${pwm1.toFixed(0)} %` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "heater1_pwm")),
        stale: offlineFor("heater1_pwm"),
      },
      {
        key: seriesKey(mod, "heater2_pwm"),
        label: "Тэн 2 ШИМ",
        value: formatOrDash(
          offlineFor("heater2_pwm"),
          pwm2 != null ? `${pwm2.toFixed(0)} %` : null
        ),
        muted: mutedSensorKeys.includes(seriesKey(mod, "heater2_pwm")),
        stale: offlineFor("heater2_pwm"),
      }
    );
  }

  return rows;
}

/** Active (unmuted) first, then muted — same order as Modules Lab UI. */
export function orderSensorRows(
  rows: ComplexSensorRow[]
): ComplexSensorRow[] {
  const active = rows.filter((r) => !r.muted);
  const muted = rows.filter((r) => r.muted);
  return [...active, ...muted];
}

export function visibleSensorModules(
  visible: Record<DrinkxHost, boolean>
): DrinkxHost[] {
  return DRINKX_HOSTS.filter((m) => visible[m] !== false);
}
