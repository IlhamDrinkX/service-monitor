import type { DrinkxHost } from "@service-monitor/core";

export type EnabledMap = Record<string, boolean | null>;

export type CalibRow = {
  qty: number;
  pulses?: number;
  actualMl?: number;
  flowFactor?: number;
};

export type LabTrackState = {
  modules: Record<DrinkxHost, boolean>;
  /** false = выключен; отсутствие ключа = включен */
  sensors: Record<string, boolean>;
};

export type CustomSubject = {
  subject: string;
  label: string;
  /** builtin payload id или `custom:<id>` */
  payloadIds: string[];
};

export type CustomPayload = {
  id: string;
  label: string;
  description: string;
  payloadJson: string;
};
