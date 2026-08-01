/**
 * NATS subjects ComplexOS / dashboard (полевая диагностика).
 */

export const COMPLEXOS_SUBJECTS = {
  status: "complexos.core.status",
  transition: "complexos.core.transition",
  cancelTransition: "complexos.core.cancel-transition",
  pause: "complexos.core.pause",
  graceRestart: "complexos.core.grace-restart",
  restart: "complexos.core.restart",
  closeWorkday: "complexos.core.closeworkday",
  alertReact: "complexos.core.alerts.react!",
  dumpDevices: "complexos.dashboard.dump-devices",
  cleaningConfig: "complexos.dashboard.cleaning-config",
  orders: "complexos.dashboard.orders",
  cmAction: "complexos.devices.cm.action",
  milkGovern: "complexos.devices.milk.govern",
  takeawayAction: "complexos.devices.takeaway.action",
  cupStorageAction: "complexos.devices.cup-storage.action",
  troubles: "complexos.troubles",
  cleaningLogs: "fibbee.loggger.cleaning-logs",
  helpNeeded: "complexos.bus.helpNeeded",
  alertCreated: "complexos.bus.alertCreated",
  alertCleared: "complexos.bus.alertCleared",
  /** I2C milk-fridge valves during brew (real-cm onSwitch). */
  valvesSwitched: "complexos.valves.switched",
} as const;

/** Ключи timings мойки — читаются из cleaning-config, пишутся через update-config. */
export const CLEANING_TIMING_KEYS = [
  "startCleaningPurgeDelay",
  "preAfterCleaningWash",
  "postAfterCleaningWash",
  "pumpOutTimeout",
  "drainCleaningPurgeDelay",
  "evercleanWorkTime",
  "rinsaWorkTime",
] as const;

export type CleaningTimingKey = (typeof CLEANING_TIMING_KEYS)[number];

export const CLEANING_TIMING_LABELS: Record<CleaningTimingKey, string> = {
  startCleaningPurgeDelay: "Purge до мойки (мс)",
  preAfterCleaningWash: "Pre after wash (мс)",
  postAfterCleaningWash: "Post after wash (мс)",
  pumpOutTimeout: "Pump out timeout (мс)",
  drainCleaningPurgeDelay: "Drain purge (мс)",
  evercleanWorkTime: "Everclean work (мс)",
  rinsaWorkTime: "Rinsa work (мс)",
};

export type ComplexOsRisk = "read" | "confirm" | "danger";
