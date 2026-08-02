import type { BrewLabPartType } from "@service-monitor/core";

export type BrewLabPartDraft = {
  type: BrewLabPartType;
  qtyMs: number;
  tempC: number;
  productionOrder: number;
};

/** Собрать parts для buildBrewLabPayload из полей формы Brew Lab. */
export function brewLabPartsFromForm(form: {
  type: BrewLabPartType;
  qtyMs: number;
  tempC: number;
  addMilk: boolean;
  milkQtyMs: number;
  milkTempC: number;
}): BrewLabPartDraft[] {
  const parts: BrewLabPartDraft[] = [
    {
      type: form.type,
      qtyMs: form.qtyMs,
      tempC: form.tempC,
      productionOrder: 1,
    },
  ];
  if (form.addMilk) {
    parts.push({
      type: "milk",
      qtyMs: form.milkQtyMs,
      tempC: form.milkTempC,
      productionOrder: 2,
    });
  }
  return parts;
}
