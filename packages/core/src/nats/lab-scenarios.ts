/**
 * Безопасные lab-сценарии Modules Lab (кнопки поверх NATS).
 * Payload совпадает с ERP cm-drv / ComplexOS coffee-machine.ts (не «выдуманные» JSON).
 */

import { NATS_SUBJECTS } from "./subjects.js";

export type LabScenarioRisk = "read" | "service" | "danger";

export type LabScenarioContext = {
  /** Текущий Lab host: milk | coffee | water */
  host: string;
  /** hwid выбранный в Lab (из muster / default) */
  hwid: string;
};

export type LabScenario = {
  id: string;
  label: string;
  helpId: string;
  risk: LabScenarioRisk;
  /** Только milk host / facade milk */
  milkOnly?: boolean;
  subject: string;
  buildPayload: (ctx: LabScenarioContext) => Record<string, unknown>;
  /** Timeout NATS request мс (должен покрывать ERP sleep tubesLength×150 + reverse) */
  timeoutMs?: number;
  /** Ожидаемая длительность для UI (сек) */
  expectedSec?: number;
};

function facadeOrHostHwid(ctx: LabScenarioContext): string {
  const h = ctx.hwid.trim();
  if (h) return h;
  if (ctx.host === "milk") return "dx.milk";
  if (ctx.host === "coffee") return "dx.coffee";
  if (ctx.host === "water") return "dx.water";
  return "dx";
}

/**
 * DrinkX doMilkRinse: sleep(tubesLength * 150) + reverse-циклы (~15–20 с).
 * ComplexOS microrinseTubesLength default = 1000 → ~150 с + reverse.
 */
function milkrinseTimeoutMs(tubesLength: number): number {
  const forwardMs = tubesLength * 150;
  const reverseBudget = 25_000;
  return Math.min(forwardMs + reverseBudget + 30_000, 15 * 60_000);
}

export const LAB_SCENARIOS: LabScenario[] = [
  {
    id: "status-module",
    label: "Status модуля",
    helpId: "lab.scenario.status",
    risk: "read",
    subject: NATS_SUBJECTS.status,
    buildPayload: (ctx) => ({ hwid: facadeOrHostHwid(ctx) }),
    timeoutMs: 4_000,
    expectedSec: 1,
  },
  {
    id: "milkrinse-micro",
    label: "Micro-rinse",
    helpId: "lab.scenario.milkrinseMicro",
    risk: "service",
    milkOnly: true,
    subject: "coffeemachine.milkrinse!",
    // Как ComplexOS microrinseTubesLength=1000 (coffee-machine.ts)
    buildPayload: () => ({
      hwid: "dx.milk",
      tubes: true,
      tubesLength: 1000,
      nozzleId: 0,
    }),
    timeoutMs: milkrinseTimeoutMs(1000),
    expectedSec: Math.ceil((1000 * 150 + 20_000) / 1000),
  },
  {
    id: "milkrinse-long",
    label: "Milk rinse",
    helpId: "lab.scenario.milkrinseLong",
    risk: "service",
    milkOnly: true,
    subject: "coffeemachine.milkrinse!",
    // Средний rinse для поля (не full bigrinse 7500 ≈ 19 мин)
    buildPayload: () => ({
      hwid: "dx.milk",
      tubes: true,
      tubesLength: 1500,
      nozzleId: 0,
    }),
    timeoutMs: milkrinseTimeoutMs(1500),
    expectedSec: Math.ceil((1500 * 150 + 20_000) / 1000),
  },
  {
    id: "stop-cm",
    label: "Stop CM",
    helpId: "lab.scenario.stopCm",
    risk: "danger",
    subject: "coffeemachine.stop",
    buildPayload: (ctx) => ({
      hwid: ctx.hwid.startsWith("dx") ? "dx" : facadeOrHostHwid(ctx),
    }),
    timeoutMs: 8_000,
    expectedSec: 2,
  },
];

export type BrewLabPartType = "coffee" | "milk" | "water";

export type BrewLabPartInput = {
  type: BrewLabPartType;
  qtyMs: number;
  tempC: number;
  productionOrder?: number;
};

export type BrewLabFormInput = {
  hwid: string;
  nozzleId?: string | number;
  parts: BrewLabPartInput[];
  comment?: string;
};

/** Собрать payload coffeemachine.brew из формы Brew Lab. */
export function buildBrewLabPayload(
  form: BrewLabFormInput
): Record<string, unknown> {
  const parts = form.parts
    .filter((p) => p.qtyMs > 0)
    .map((p, i) => {
      const base: Record<string, unknown> = {
        type: p.type,
        qty: Math.round(p.qtyMs),
        productionOrder: p.productionOrder ?? i + 1,
      };
      if (p.type === "milk") {
        base.milkTemp = p.tempC;
        base.airIn = false;
        base.airPercent = 0;
      } else if (p.type === "coffee") {
        base.temp = p.tempC;
        base.airPercent = 0;
      } else {
        base.temp = p.tempC;
      }
      return base;
    });

  return {
    hwid: form.hwid || "dx",
    nozzleId: form.nozzleId ?? "0",
    meta: { comment: form.comment ?? "service-monitor brew lab" },
    coffeeRecipe: {
      Name: "Lab",
      parts,
    },
  };
}

export const BREW_LAB_DEFAULTS = {
  qtyMs: 2000,
  tempC: 65,
  hwidOptions: ["dx", "dx.milk", "dx.coffee", "dx.water"] as const,
} as const;

export function scenariosForHost(host: string): LabScenario[] {
  return LAB_SCENARIOS.filter((s) => !s.milkOnly || host === "milk");
}
