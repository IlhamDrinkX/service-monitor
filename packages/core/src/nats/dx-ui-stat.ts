/**
 * Парсинг HTTP DX UI (cm-drv drivers/dx/ui.js :8000).
 * getStatus() NATS не кладёт pump_R_IS / PWM тэнов — они в temps + pid graph.
 */

export type DxUiSnapshot = {
  pump_R_IS: number | null;
  pump_L_IS: number | null;
  /** PID output 0–100 с последнего ряда graph */
  heater1_pwm: number | null;
  heater2_pwm: number | null;
};

/** Из HTML страницы графиков: `<div>{JSON.stringify(stat)}</div>`. */
export function parseDxUiStatHtml(
  html: string
): Record<string, number> | null {
  if (!html || typeof html !== "string") return null;
  const div = html.match(/<div>\s*(\{[\s\S]*?\})\s*<\/div>/);
  if (!div?.[1]) return null;
  try {
    const raw = JSON.parse(div[1]) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Вырезать JSON-массив после `let data =` балансом скобок
 * (non-greedy regex ломается на больших pidlog).
 */
export function extractJsonArrayAfter(
  html: string,
  marker: string
): unknown | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length;
  while (i < html.length && /\s/.test(html[i]!)) i++;
  if (html[i] !== "[") return null;
  let depth = 0;
  const from = i;
  for (; i < html.length; i++) {
    const c = html[i]!;
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(from, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Последний ряд pidlog из `let data = [...]` в DX UI.
 * Индексы: 6=output1, 11=output2, 12=pump_R_IS, 13=pump_L_IS (drinkx.js plh).
 */
export function parseDxUiGraphLastRow(html: string): number[] | null {
  if (!html) return null;
  const data = extractJsonArrayAfter(html, "let data =");
  if (!Array.isArray(data) || data.length === 0) return null;
  const last = data[data.length - 1];
  if (!Array.isArray(last)) return null;
  return last.map((x) => Number(x));
}

export function dxUiSnapshotHasData(snap: DxUiSnapshot): boolean {
  return (
    snap.pump_R_IS != null ||
    snap.pump_L_IS != null ||
    snap.heater1_pwm != null ||
    snap.heater2_pwm != null
  );
}

/** Снимок датчиков/ШИМ из HTML DX UI. */
export function parseDxUiSnapshot(html: string): DxUiSnapshot {
  const empty: DxUiSnapshot = {
    pump_R_IS: null,
    pump_L_IS: null,
    heater1_pwm: null,
    heater2_pwm: null,
  };
  if (!html) return empty;

  const rMatch = html.match(
    /"pump_R_IS"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/
  );
  const lMatch = html.match(
    /"pump_L_IS"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/
  );
  const stat = parseDxUiStatHtml(html);
  const row = parseDxUiGraphLastRow(html);

  return {
    pump_R_IS:
      numOrNull(rMatch?.[1]) ??
      numOrNull(stat?.pump_R_IS ?? stat?.pump_r_is) ??
      (row && row.length > 12 ? numOrNull(row[12]) : null),
    pump_L_IS:
      numOrNull(lMatch?.[1]) ??
      numOrNull(stat?.pump_L_IS ?? stat?.pump_l_is) ??
      (row && row.length > 13 ? numOrNull(row[13]) : null),
    heater1_pwm: row && row.length > 6 ? numOrNull(row[6]) : null,
    heater2_pwm: row && row.length > 11 ? numOrNull(row[11]) : null,
  };
}

/**
 * pump_R_IS — напряжение АЦП (Type: 'V' в drinkx), не амперы.
 */
export function extractPumpRisFromDxStat(
  stat: Record<string, number> | null | undefined
): number | null {
  if (!stat) return null;
  return numOrNull(stat.pump_R_IS ?? stat.pump_r_is);
}

/** @deprecated use parseDxUiSnapshot */
export function extractPumpRisFromDxHtml(html: string): number | null {
  return parseDxUiSnapshot(html).pump_R_IS;
}
