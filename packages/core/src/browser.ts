/**
 * Browser-safe subset of core (без node:crypto).
 */

export type { ErpSalesPoint, ErpPointStatus } from "./cloud/types.js";
export {
  CONTROL_HELPS,
  HELP_ARTICLES,
  getControlHelp,
  getHelpArticle,
} from "./help/content.js";
export {
  defaultNetworkDevices,
  DEFAULT_LAN_MAP,
} from "./domain/lan-map.js";
export { localServiceUrls, lanServiceUrls, serviceUrlsForMode } from "./ssh/config-generator.js";
export {
  emptySession,
  emptyDevices,
  shouldWarnSession,
  isSessionHealthy,
  isLanModulesReachable,
  NATS_LAN_URL,
  NATS_TUNNEL_URL,
} from "./session/session-state.js";
export type {
  ComplexSessionSnapshot,
  SessionMode,
} from "./session/session-state.js";
export { getParamHint, listParamHints } from "./hints/param-hints.js";
export {
  parseNeighbors,
  mergeDiscoveredDevices,
  attachStickyExtras,
  summarizeJsonDiff,
  DISCOVERY_STICKY_TTL_MS,
} from "./session/neigh-parse.js";
export type { NeighborEntry, StickyNeighbor } from "./session/neigh-parse.js";
export {
  NATS_SUBJECTS,
} from "./nats/subjects.js";
export type {
  NatsConnectionInfo,
  NatsMusterEntry,
  NatsModuleRole,
} from "./nats/subjects.js";
export {
  DRINKX_HOSTS,
  MODULE_VALVES,
  VALVE_LABELS,
  HEATER_IDS,
  HEATER_LABELS,
  HEATER_TARGET_C,
  HEATER_AUTO_STOP_MS,
  defaultHwid,
  valveCommandSubject,
  valveStatusSubject,
  pumpCommandSubject,
  pumpStopSubject,
  pumpStatusSubject,
  pumpPowerToPwm,
  heaterCommandSubject,
  heaterStopSubject,
  heaterStatusSubject,
  extractEnabledState,
  extractTempMap,
  extractWaterTotalPulses,
  expectedTempKeys,
  TEMP_SENSOR_LABELS,
  FLOW_CALIBRATION_QTYS,
  FLOW_CALIBRATION_SWITCH_DELAY_MS,
  FLOW_CALIBRATION_BREW_TIMEOUT_MS,
  FLOW_CALIBRATION_PULSES_POLL_MS,
  milkSystemValveNumbers,
} from "./nats/module-devices.js";
export type { DrinkxHost, TempSensorKey } from "./nats/module-devices.js";
