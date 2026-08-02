/**
 * Health Report — сводная проверка комплекса одной кнопкой (вкладка «Сессия»).
 *
 * Дизайн: тонкий слой опроса на desktop (SSH/NATS/DX IPC, уже существующие
 * методы `window.desktop.*`) собирает уже РАЗОБРАННЫЕ структуры через
 * существующие парсеры core (`parseComplexStatusTuple`, `parseSirupStatusReply`,
 * `parsePrinterStatusReply`, …) и передаёт их сюда. `buildHealthReport()` —
 * чистая функция без сети/IPC, поэтому легко тестируется и не завязана на
 * конкретный транспорт.
 *
 * Разделы соответствуют реальным подсистемам поля: сессия/NATS, три модуля
 * (milk/coffee/water) по датчикам и DX-токам, ComplexOS core, сироп-дозатор,
 * касса/ККТ, бортовой lab-logger (если установлен), топология IP.
 */

import type { SessionMode } from "../session/session-state.js";
import type { ModuleRole, NetworkDevice } from "../domain/types.js";
import { DEFAULT_LAN_MAP } from "../domain/lan-map.js";
import {
  DRINKX_HOSTS,
  expectedTempKeys,
  type DrinkxHost,
} from "../nats/module-devices.js";
import type { NatsMusterEntry } from "../nats/subjects.js";
import type { ComplexStatusTuple } from "../nats/complex-status.js";
import type { DxPumpCurrentsPayload } from "../nats/lab-telemetry.js";
import type { SirupMotorStatus } from "../nats/sirup.js";
import type {
  PrinterStatusReply,
  PaymentsStatusReply,
  PaymentsCheckReply,
} from "../nats/pos.js";
import type { LabLoggerStatus } from "../nats/lab-logger.js";

export type HealthLevel = "ok" | "warn" | "error" | "skip";

export type HealthCheck = {
  id: string;
  label: string;
  level: HealthLevel;
  message: string;
  recommendation?: string;
};

export type HealthSection = {
  id: string;
  label: string;
  level: HealthLevel;
  checks: HealthCheck[];
};

export type HealthReport = {
  at: string;
  overall: HealthLevel;
  summary: string;
  sections: HealthSection[];
  /** Deduped, in section order — only from warn/error checks. */
  recommendations: string[];
};

// ---------------------------------------------------------------------------
// Raw (already-parsed) probe inputs. Each top-level field is null when that
// probe was never run (e.g. no session, or the feature isn't installed) —
// distinct from `{ ok: false, error }` when the probe ran and failed.
// ---------------------------------------------------------------------------

export type HealthReportInput = {
  at?: string;
  session: {
    connected: boolean;
    mode: SessionMode | null;
    natsOnline: boolean;
  };
  /** coffeemachine.muster (requestMany) */
  muster: { ok: boolean; modules: NatsMusterEntry[]; error?: string } | null;
  /** coffeemachine.status parsed into a per-host tuple */
  statusTuple: { ok: boolean; tuple?: ComplexStatusTuple; error?: string } | null;
  /** DX UI :8000 pump currents + heater PWM (estimate), per host */
  dx: { ok: boolean; data?: DxPumpCurrentsPayload; error?: string } | null;
  /** complexos.core.status */
  complexOs: { ok: boolean; error?: string } | null;
  /** complexos.sirup.* — field dozator (not the Host-dozator flashing stand) */
  sirup: {
    ok: boolean;
    error?: string;
    hwids: string[];
    /** Spot-check of the first few hwids (sequential, per field guidance — avoid bus overload). */
    sample: Array<{
      hwid: string;
      kind: "ok" | "timeout" | "error";
      status?: SirupMotorStatus;
      message?: string;
    }>;
  } | null;
  /** Касса / ККТ (printer + payments) */
  pos: {
    printerMusterOk: boolean;
    paymentsMusterOk: boolean;
    printer?: PrinterStatusReply;
    payments?: PaymentsStatusReply;
    paymentsCheck?: PaymentsCheckReply;
    hostProbe?: { level: "ok" | "warn" | "error"; lines: string[] } | null;
    hostProbeError?: string | null;
  } | null;
  /** Бортовой lab-logger (SM-established install on complexos, optional) */
  labLogger: { installed: boolean; status?: LabLoggerStatus; error?: string } | null;
  /** LAN-режим: реальные устройства для сверки с эталоном .43–.46 */
  topology: { devices: NetworkDevice[] } | null;
};

const LEVEL_RANK: Record<HealthLevel, number> = {
  skip: 0,
  ok: 0,
  warn: 1,
  error: 2,
};

function worstLevel(levels: HealthLevel[]): HealthLevel {
  let best: HealthLevel = "ok";
  for (const l of levels) {
    if (LEVEL_RANK[l] > LEVEL_RANK[best]) best = l;
  }
  return best;
}

function sectionLevel(checks: HealthCheck[]): HealthLevel {
  const real = checks.filter((c) => c.level !== "skip");
  if (real.length === 0) return "skip";
  return worstLevel(real.map((c) => c.level));
}

const HOST_LABEL: Record<DrinkxHost, string> = {
  milk: "milk",
  coffee: "coffee",
  water: "water",
};

function skipCheck(id: string, label: string, why: string): HealthCheck {
  return { id, label, level: "skip", message: why };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildSessionSection(input: HealthReportInput): HealthSection {
  const checks: HealthCheck[] = [];
  if (!input.session.connected) {
    checks.push({
      id: "session.connected",
      label: "Сессия",
      level: "error",
      message: "Сессия не подключена.",
      recommendation:
        "Подключитесь на вкладке «Сессия» (Remote SSH или Local LAN) и повторите проверку.",
    });
  } else {
    checks.push({
      id: "session.connected",
      label: "Сессия",
      level: "ok",
      message: `Подключена · ${input.session.mode === "local" ? "Local LAN" : "Remote SSH"}.`,
    });
    checks.push(
      input.session.natsOnline
        ? { id: "session.nats", label: "NATS", level: "ok", message: "NATS online." }
        : {
            id: "session.nats",
            label: "NATS",
            level: "error",
            message: "NATS offline.",
            recommendation:
              "Проверьте, что nats-server поднят на complexos (:4222) и туннель/LAN до него жив.",
          }
    );
  }
  return { id: "session", label: "Сессия и NATS", level: sectionLevel(checks), checks };
}

function buildMusterSection(
  input: HealthReportInput,
  connected: boolean
): HealthSection {
  const checks: HealthCheck[] = [];
  if (!connected) {
    checks.push(skipCheck("muster", "coffeemachine.muster", "не проверено — нет сессии"));
  } else if (!input.muster) {
    checks.push(skipCheck("muster", "coffeemachine.muster", "проверка не выполнялась"));
  } else if (!input.muster.ok) {
    checks.push({
      id: "muster",
      label: "coffeemachine.muster",
      level: "error",
      message: `Нет ответов: ${input.muster.error ?? "timeout"}.`,
      recommendation:
        "Модули не откликаются на muster — проверьте питание/сеть complexos и что cm-drv запущен.",
    });
  } else {
    const roles = new Set(
      input.muster.modules.map((m) => (m.role ?? "").toLowerCase())
    );
    const missing = DRINKX_HOSTS.filter((h) => !roles.has(h));
    if (missing.length === 0) {
      checks.push({
        id: "muster",
        label: "coffeemachine.muster",
        level: "ok",
        message: `Ответили: ${input.muster.modules.length} (milk/coffee/water — все на связи).`,
      });
    } else {
      checks.push({
        id: "muster",
        label: "coffeemachine.muster",
        level: "warn",
        message: `Не откликнулись: ${missing.join(", ")}.`,
        recommendation: `Модули ${missing.join(", ")} не ответили на muster — проверьте их IP (эталон milk=.44 coffee=.45 water=.46, не .33) и что cm-drv на них жив.`,
      });
    }
  }
  return {
    id: "core-nats",
    label: "Ядро NATS (muster)",
    level: sectionLevel(checks),
    checks,
  };
}

function buildModuleSections(
  input: HealthReportInput,
  connected: boolean
): HealthSection[] {
  return DRINKX_HOSTS.map((host) => {
    const checks: HealthCheck[] = [];
    const label = HOST_LABEL[host];

    // Temps / status tuple
    if (!connected) {
      checks.push(skipCheck(`${host}.status`, "Датчики (status)", "не проверено — нет сессии"));
    } else if (!input.statusTuple) {
      checks.push(skipCheck(`${host}.status`, "Датчики (status)", "проверка не выполнялась"));
    } else if (!input.statusTuple.ok || !input.statusTuple.tuple) {
      checks.push({
        id: `${host}.status`,
        label: "Датчики (status)",
        level: "error",
        message: `coffeemachine.status не ответил: ${input.statusTuple.error ?? "timeout"}.`,
        recommendation: "coffeemachine.status не отвечает — проверьте NATS и cm-drv на complexos.",
      });
    } else {
      const snap = input.statusTuple.tuple.hosts[host];
      const expected = expectedTempKeys(host).length;
      const got = Object.keys(snap.temps).length;
      if (snap.sensorCount === 0) {
        checks.push({
          id: `${host}.status`,
          label: "Датчики (status)",
          level: "error",
          message: `Нет данных от модуля ${label} (0 датчиков в ответе).`,
          recommendation: `Модуль ${label} не прислал ни одного датчика — проверьте физическое подключение и IP (эталон .44/.45/.46).`,
        });
      } else if (got < expected) {
        checks.push({
          id: `${host}.status`,
          label: "Датчики (status)",
          level: "warn",
          message: `Частично: ${got}/${expected} температурных датчиков (${snap.source}).`,
          recommendation: `Модуль ${label} прислал не все датчики (${got}/${expected}) — возможен обрыв термопары/разъёма.`,
        });
      } else {
        checks.push({
          id: `${host}.status`,
          label: "Датчики (status)",
          level: "ok",
          message: `${got}/${expected} температурных датчиков (${snap.source}).`,
        });
      }
    }

    // DX UI currents (pump_R_IS / pump_L_IS)
    if (!connected) {
      checks.push(skipCheck(`${host}.dx`, "DX UI (токи)", "не проверено — нет сессии"));
    } else if (!input.dx) {
      checks.push(skipCheck(`${host}.dx`, "DX UI (токи)", "проверка не выполнялась"));
    } else {
      const d = input.dx.data?.[host];
      if (!input.dx.ok && !d) {
        checks.push({
          id: `${host}.dx`,
          label: "DX UI (токи)",
          level: "error",
          message: `DX UI недоступен: ${input.dx.error ?? "нет ответа"}.`,
          recommendation: `DX UI :8000 недоступен целиком — проверьте туннель/LAN до complexos.`,
        });
      } else if (!d || (d.pump_R_IS == null && d.pump_L_IS == null)) {
        checks.push({
          id: `${host}.dx`,
          label: "DX UI (токи)",
          level: "warn",
          message: d?.error
            ? `${label}: ${d.error}`
            : `${label}: нет pump_R_IS/pump_L_IS.`,
          recommendation: `DX UI для ${label} не отдал токи насоса — проверьте, что модуль на правильном IP (не .33) и веб-морда :8000 отвечает.`,
        });
      } else {
        checks.push({
          id: `${host}.dx`,
          label: "DX UI (токи)",
          level: "ok",
          message: `R=${d.pump_R_IS?.toFixed(3) ?? "—"} L=${d.pump_L_IS?.toFixed(3) ?? "—"}${d.via ? ` (${d.via})` : ""}.`,
        });
      }
    }

    return {
      id: `module-${host}`,
      label: `Модуль ${label}`,
      level: sectionLevel(checks),
      checks,
    };
  });
}

function buildComplexOsSection(
  input: HealthReportInput,
  connected: boolean
): HealthSection {
  const checks: HealthCheck[] = [];
  if (!connected) {
    checks.push(skipCheck("complexos", "complexos.core.status", "не проверено — нет сессии"));
  } else if (!input.complexOs) {
    checks.push(skipCheck("complexos", "complexos.core.status", "проверка не выполнялась"));
  } else if (!input.complexOs.ok) {
    checks.push({
      id: "complexos",
      label: "complexos.core.status",
      level: "error",
      message: `Нет ответа: ${input.complexOs.error ?? "timeout"}.`,
      recommendation:
        "ComplexOS core не отвечает — проверьте службу ft-complexos на комплексе (systemctl status).",
    });
  } else {
    checks.push({
      id: "complexos",
      label: "complexos.core.status",
      level: "ok",
      message: "ComplexOS отвечает.",
    });
  }
  return { id: "complexos", label: "ComplexOS", level: sectionLevel(checks), checks };
}

function buildSirupSection(
  input: HealthReportInput,
  connected: boolean
): HealthSection {
  const checks: HealthCheck[] = [];
  if (!connected) {
    checks.push(skipCheck("sirup", "Сироп-дозатор", "не проверено — нет сессии"));
  } else if (!input.sirup) {
    checks.push(skipCheck("sirup", "Сироп-дозатор", "проверка не выполнялась"));
  } else if (!input.sirup.ok) {
    checks.push({
      id: "sirup.muster",
      label: "Сироп-дозатор muster",
      level: "error",
      message: `Нет ответа: ${input.sirup.error ?? "timeout"}.`,
      recommendation: "complexos.sirup.muster не отвечает — проверьте cupstorage-drv (--sirup4).",
    });
  } else if (input.sirup.hwids.length === 0) {
    checks.push({
      id: "sirup.muster",
      label: "Сироп-дозатор muster",
      level: "warn",
      message: "Ни один мотор не зарегистрирован.",
      recommendation:
        "Сироп-дозатор не отвечает на muster вообще — возможно не подключён/не настроен на этом комплексе (это нормально не для всех точек).",
    });
  } else {
    checks.push({
      id: "sirup.muster",
      label: "Сироп-дозатор muster",
      level: "ok",
      message: `Зарегистрировано моторов: ${input.sirup.hwids.length}.`,
    });
    if (input.sirup.sample.length > 0) {
      const bad = input.sirup.sample.filter((s) => s.kind !== "ok");
      if (bad.length > 0) {
        checks.push({
          id: "sirup.sample",
          label: "Сироп-дозатор — выборочный опрос",
          level: "warn",
          message: `Не ответили: ${bad.map((b) => `#${b.hwid}`).join(", ")} (из ${input.sirup.sample.length} опрошенных).`,
          recommendation:
            "Часть моторов сиропа не отвечает на status — проверьте физическое подключение/питание конкретных слотов.",
        });
      } else {
        checks.push({
          id: "sirup.sample",
          label: "Сироп-дозатор — выборочный опрос",
          level: "ok",
          message: `Опрошено ${input.sirup.sample.length} — все ответили.`,
        });
      }
    }
  }
  return { id: "sirup", label: "Сироп-дозатор", level: sectionLevel(checks), checks };
}

function buildPosSection(
  input: HealthReportInput,
  connected: boolean
): HealthSection {
  const checks: HealthCheck[] = [];
  if (!connected) {
    checks.push(skipCheck("pos", "Касса / ККТ", "не проверено — нет сессии"));
    return { id: "pos", label: "Касса / ККТ", level: "skip", checks };
  }
  if (!input.pos) {
    checks.push(skipCheck("pos", "Касса / ККТ", "проверка не выполнялась"));
    return { id: "pos", label: "Касса / ККТ", level: "skip", checks };
  }
  const p = input.pos;

  if (!p.printerMusterOk) {
    checks.push({
      id: "pos.printer",
      label: "Принтер чеков",
      level: "error",
      message: "printer.muster не ответил.",
      recommendation: "Принтер чеков не откликается — проверьте ft-printer-drv и USB (ATOL 2912).",
    });
  } else if (p.printer?.connected === false) {
    checks.push({
      id: "pos.printer",
      label: "Принтер чеков",
      level: "error",
      message: p.printer.message ?? "printer: connected=false.",
      recommendation: "Принтер чеков отключён — проверьте USB-кабель/питание фискального регистратора.",
    });
  } else if (p.printer?.connected == null) {
    checks.push({
      id: "pos.printer",
      label: "Принтер чеков",
      level: "warn",
      message: "Нет чёткого статуса connected.",
    });
  } else {
    checks.push({
      id: "pos.printer",
      label: "Принтер чеков",
      level: "ok",
      message: `connected=true${p.printer.workday ? `, смена: ${p.printer.workday}` : ""}.`,
    });
  }

  if (!p.paymentsMusterOk) {
    checks.push({
      id: "pos.payments",
      label: "Эквайринг",
      level: "error",
      message: "payments.muster не ответил.",
      recommendation: "Терминал эквайринга не откликается — проверьте ft-payments-drv и USB (Kozen).",
    });
  } else {
    const ready = p.paymentsCheck?.ready ?? p.payments?.ready ?? p.payments?.connected;
    if (ready === false) {
      checks.push({
        id: "pos.payments",
        label: "Эквайринг",
        level: "error",
        message: p.payments?.message ?? p.paymentsCheck?.message ?? "не готов.",
        recommendation: "Терминал эквайринга не готов — проверьте подключение/питание Kozen.",
      });
    } else if (ready == null) {
      checks.push({
        id: "pos.payments",
        label: "Эквайринг",
        level: "warn",
        message: "Нет чёткого статуса готовности.",
      });
    } else {
      checks.push({
        id: "pos.payments",
        label: "Эквайринг",
        level: "ok",
        message: `ready=true${p.payments?.workday ? `, смена: ${p.payments.workday}` : ""}.`,
      });
    }
  }

  if (p.hostProbeError) {
    checks.push({
      id: "pos.host",
      label: "Хост (SSH/USB)",
      level: "warn",
      message: `SSH-проба не удалась: ${p.hostProbeError}.`,
    });
  } else if (p.hostProbe) {
    checks.push({
      id: "pos.host",
      label: "Хост (SSH/USB)",
      level: p.hostProbe.level,
      message: p.hostProbe.lines.join(" · "),
      recommendation:
        p.hostProbe.level === "error"
          ? "systemctl/USB на complexos сообщают об ошибке — см. строки выше и лог юнитов ft-*-drv."
          : undefined,
    });
  } else {
    checks.push(skipCheck("pos.host", "Хост (SSH/USB)", "SSH-проба не выполнялась"));
  }

  return { id: "pos", label: "Касса / ККТ", level: sectionLevel(checks), checks };
}

function buildLabLoggerSection(
  input: HealthReportInput,
  connected: boolean
): HealthSection {
  const checks: HealthCheck[] = [];
  if (!connected) {
    checks.push(skipCheck("lab-logger", "Бортовой лог", "не проверено — нет сессии"));
    return { id: "lab-logger", label: "Бортовой лог", level: "skip", checks };
  }
  if (!input.labLogger) {
    checks.push(skipCheck("lab-logger", "Бортовой лог", "проверка не выполнялась"));
    return { id: "lab-logger", label: "Бортовой лог", level: "skip", checks };
  }
  if (!input.labLogger.installed) {
    checks.push({
      id: "lab-logger.installed",
      label: "Бортовой лог",
      level: "skip",
      message: "Не установлен на этом комплексе (это нормально — опциональная функция).",
    });
    return { id: "lab-logger", label: "Бортовой лог", level: "skip", checks };
  }
  const st = input.labLogger.status;
  if (!st) {
    checks.push({
      id: "lab-logger.status",
      label: "Бортовой лог",
      level: "warn",
      message: `Установлен, но статус не получен: ${input.labLogger.error ?? "нет ответа"}.`,
    });
    return { id: "lab-logger", label: "Бортовой лог", level: sectionLevel(checks), checks };
  }
  if (st.unitActive !== "active") {
    checks.push({
      id: "lab-logger.unit",
      label: "Бортовой лог — служба",
      level: "error",
      message: `systemd unit: ${st.unitActive}.`,
      recommendation:
        "Служба sm-lab-logger не активна — переустановите/перезапустите на вкладке «Бортовой лог».",
    });
  } else {
    checks.push({
      id: "lab-logger.unit",
      label: "Бортовой лог — служба",
      level: "ok",
      message: "systemd unit: active.",
    });
  }
  const health = st.health;
  if (health) {
    if (health.source !== "nats") {
      checks.push({
        id: "lab-logger.source",
        label: "Бортовой лог — источник данных",
        level: health.source === "fake" ? "warn" : "error",
        message: `source=${health.source}.`,
        recommendation:
          health.source === "idle"
            ? "Логгер не подключился к NATS (source=idle) — проверьте питание/сеть complexos."
            : "Логгер работает в демо-режиме (fake) — это не полевые данные.",
      });
    } else if (health.lastSampleAgeMs != null && health.lastSampleAgeMs > 15_000) {
      checks.push({
        id: "lab-logger.stale",
        label: "Бортовой лог — свежесть данных",
        level: "warn",
        message: `Последний сэмпл ${Math.round(health.lastSampleAgeMs / 1000)} с назад.`,
        recommendation: "Данные бортового лога давно не обновлялись — проверьте статус службы.",
      });
    } else {
      checks.push({
        id: "lab-logger.fresh",
        label: "Бортовой лог — свежесть данных",
        level: "ok",
        message: "Данные свежие.",
      });
    }
    if (health.topologyWarnings.length > 0) {
      checks.push({
        id: "lab-logger.topology",
        label: "Бортовой лог — топология",
        level: "warn",
        message: health.topologyWarnings.join("; "),
        recommendation: "См. предупреждения топологии выше — обычно означает несовпадение IP модуля с эталоном.",
      });
    }
  }
  return { id: "lab-logger", label: "Бортовой лог", level: sectionLevel(checks), checks };
}

function buildTopologySection(input: HealthReportInput): HealthSection {
  const checks: HealthCheck[] = [];
  if (!input.topology) {
    checks.push(
      skipCheck(
        "topology",
        "Топология IP",
        input.session.mode === "remote"
          ? "не проверяется в Remote-режиме (эталон только для Local LAN)"
          : "проверка не выполнялась"
      )
    );
    return { id: "topology", label: "Топология IP", level: "skip", checks };
  }
  const byRole = new Map<ModuleRole, NetworkDevice>();
  for (const d of input.topology.devices) byRole.set(d.role, d);
  for (const entry of DEFAULT_LAN_MAP) {
    if (entry.role === "router" || entry.role === "unknown") continue;
    const seen = byRole.get(entry.role);
    if (!seen || !seen.online) {
      checks.push({
        id: `topology.${entry.role}`,
        label: `IP ${entry.role}`,
        level: "error",
        message: `${entry.role} (эталон ${entry.ip}) не в сети.`,
        recommendation: `Проверьте, что ${entry.role} действительно на ${entry.ip} (частый случай — DHCP выдал другой адрес, например .33).`,
      });
    } else if (seen.ip !== entry.ip) {
      checks.push({
        id: `topology.${entry.role}`,
        label: `IP ${entry.role}`,
        level: "warn",
        message: `${entry.role} отвечает на ${seen.ip}, а не на эталонном ${entry.ip}.`,
        recommendation: `Настройте статический IP ${entry.ip} для ${entry.role} (роутер выдал ${seen.ip}) — иначе туннели/DX UI будут смотреть не туда.`,
      });
    } else {
      checks.push({
        id: `topology.${entry.role}`,
        label: `IP ${entry.role}`,
        level: "ok",
        message: `${entry.ip} — как в эталоне.`,
      });
    }
  }
  return { id: "topology", label: "Топология IP", level: sectionLevel(checks), checks };
}

// ---------------------------------------------------------------------------

export function buildHealthReport(input: HealthReportInput): HealthReport {
  const connected = input.session.connected;
  const sections: HealthSection[] = [
    buildSessionSection(input),
    buildMusterSection(input, connected),
    ...buildModuleSections(input, connected),
    buildComplexOsSection(input, connected),
    buildSirupSection(input, connected),
    buildPosSection(input, connected),
    buildLabLoggerSection(input, connected),
    buildTopologySection(input),
  ];

  const overall = worstLevel(sections.map((s) => s.level));
  const recommendations: string[] = [];
  const seen = new Set<string>();
  for (const s of sections) {
    for (const c of s.checks) {
      if (!c.recommendation) continue;
      if (seen.has(c.recommendation)) continue;
      seen.add(c.recommendation);
      recommendations.push(c.recommendation);
    }
  }

  const errorCount = sections.filter((s) => s.level === "error").length;
  const warnCount = sections.filter((s) => s.level === "warn").length;
  const okCount = sections.filter((s) => s.level === "ok").length;
  const summary =
    overall === "ok"
      ? `Всё в порядке — ${okCount} раздел(ов) без замечаний.`
      : overall === "warn"
        ? `Есть замечания: ${warnCount} раздел(ов) с предупреждениями.`
        : `Есть проблемы: ${errorCount} раздел(ов) с ошибками, ${warnCount} с предупреждениями.`;

  return {
    at: input.at ?? new Date().toISOString(),
    overall,
    summary,
    sections,
    recommendations,
  };
}

/** Человекочитаемый заголовок уровня (для бейджа/иконки в UI). */
export function healthLevelLabel(level: HealthLevel): string {
  switch (level) {
    case "ok":
      return "OK";
    case "warn":
      return "Внимание";
    case "error":
      return "Проблема";
    case "skip":
      return "—";
  }
}

/**
 * Плоский текстовый рендер отчёта — для «Скопировать» (вставить в чат
 * команде/тикет). Не HTML/markdown-специфичный, просто читаемые строки.
 */
export function formatHealthReportText(report: HealthReport): string {
  const lines: string[] = [];
  lines.push(`Health Report · ${report.at}`);
  lines.push(report.summary);
  lines.push("");
  for (const s of report.sections) {
    lines.push(`[${healthLevelLabel(s.level)}] ${s.label}`);
    for (const c of s.checks) {
      lines.push(`  - ${c.label}: ${c.message}`);
    }
  }
  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("Рекомендации:");
    for (const r of report.recommendations) lines.push(`  • ${r}`);
  }
  return lines.join("\n");
}
