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
  pumpCommandPayload,
  heaterCommandSubject,
  heaterStopSubject,
  heaterStatusSubject,
  extractEnabledState,
  extractPumpPowerPercent,
  extractHeaterStatus,
  estimateHeaterPwmPercent,
  extractTempMap,
  extractWaterTotalPulses,
  extractWaterPressure,
  extractPumpCurrent,
  expectedTempKeys,
  TEMP_SENSOR_LABELS,
  FLOW_CALIBRATION_QTYS,
  FLOW_CALIBRATION_SWITCH_DELAY_MS,
  FLOW_CALIBRATION_BREW_TIMEOUT_MS,
  FLOW_CALIBRATION_PULSES_POLL_MS,
  milkSystemValveNumbers,
  MILK_SYSTEM_VALVE_IDS,
  milkSystemValveId,
  milkSystemValveHwIndex,
  extractOpenValveNumbers,
  mergeOpenValveNumbers,
  natsReplyIsError,
} from "./nats/module-devices.js";
export type {
  DrinkxHost,
  TempSensorKey,
  PumpDirection,
  HeaterStatusSnap,
  MilkSystemValveId,
} from "./nats/module-devices.js";
export {
  createLabEvent,
  LAB_EVENTS_MAX,
  LAB_EVENTS_CHART_SYNC_MAX,
  LAB_EVENTS_CHART_WINDOW_MAX,
  LAB_EVENTS_SYNC_ACTUATOR_RESERVE,
  trimLabEvents,
  trimLabEventsForChartSync,
  mergeLabChartSyncEvents,
  maxLabEventAtMs,
  formatLabTerminalLine,
  labEventsToCsv,
  sensorSeries,
  extendSeriesEnd,
  SENSOR_SERIES_HOLD_MS,
  isDxSensorLocalName,
  isFiniteSeriesValue,
  seriesYDomain,
  seriesPathD,
  seriesHasDrawablePoints,
  chartSinceMs,
  booleanStepSeries,
  pumpPowerSeries,
  chartSeriesMeta,
  seriesKey,
  parseSeriesKey,
  snapshotAt,
  complexSensorCatalog,
} from "./nats/lab-log.js";
export type {
  LabEvent,
  LabEventKind,
  ChartTimeScale,
  ChartSeriesMeta,
  LabSnapshotRow,
  SeriesPoint,
} from "./nats/lab-log.js";
export {
  VALVE_PACKAGES,
  getValvePackage,
} from "./nats/valve-packages.js";
export type {
  ValveStep,
  ValvePackage,
  ValvePackageId,
} from "./nats/valve-packages.js";
export {
  HEATER_WARMUP_DEFAULTS,
  warmupSensorKey,
  warmupOverheatKey,
} from "./nats/heater-warmup.js";
export {
  parseComplexStatusTuple,
  complexTupleSummary,
} from "./nats/complex-status.js";
export type {
  ComplexHostSnapshot,
  ComplexStatusTuple,
} from "./nats/complex-status.js";
export {
  layoutModuleChartKeys,
  moduleChartColumns,
} from "./nats/chart-layout.js";
export {
  COMPLEXOS_SUBJECTS,
  CLEANING_TIMING_KEYS,
  CLEANING_TIMING_LABELS,
} from "./nats/complexos-subjects.js";
export type {
  CleaningTimingKey,
  ComplexOsRisk,
} from "./nats/complexos-subjects.js";
export {
  SIRUP_SUBJECTS,
  parseSirupHwid,
  parseSirupMusterReplies,
  parseSirupStatusReply,
  parseSirupPumpReply,
  sirupPumpPayload,
  sirupStatusLabel,
  isSirupStatusTimeout,
  classifySirupStatusFailure,
  formatSirupIdRanges,
  summarizeSirupPollResults,
} from "./nats/sirup.js";
export type {
  SirupMotorStatus,
  SirupStatusReply,
  SirupPumpReply,
  SirupMotorAction,
  SirupPollOutcomeKind,
  SirupPollItem,
  SirupPollSummary,
} from "./nats/sirup.js";
export {
  PRINTER_SUBJECTS,
  PAYMENTS_SUBJECTS,
  POS_DEFAULT_HWID_HINT,
  POS_BARCODE_TEST,
  POS_STATUS_AUTO_COMMIT_WARNING,
  parsePosHwid,
  parsePosMusterReplies,
  parsePrinterStatusReply,
  parsePaymentsStatusReply,
  parsePaymentsCheckReply,
  parsePosActionReply,
  parsePosHostProbeOutput,
  formatPosHostProbeLog,
  posBarcodeTestPayload,
  posWorkdayLabel,
  formatPosStatusLine,
  POS_HOST_PROBE_CMD,
} from "./nats/pos.js";
export type {
  PosWorkday,
  PrinterStatusReply,
  PaymentsStatusReply,
  PaymentsCheckReply,
  PosActionReply,
  PosHostProbe,
  PosHostProbeLevel,
  PosHostUsbFlags,
  PosUnitActiveState,
} from "./nats/pos.js";
export {
  TERMINAL_SUBJECT_PRESETS,
  TERMINAL_PAYLOAD_PRESETS,
  TERMINAL_PAYLOAD_RULES,
  findSubjectPresetFor,
  associatedPayloadIds,
} from "./nats/terminal-presets.js";
export type {
  TerminalSubjectPreset,
  TerminalPayloadPreset,
} from "./nats/terminal-presets.js";
export {
  LAB_SCENARIOS,
  BREW_LAB_DEFAULTS,
  buildBrewLabPayload,
  scenariosForHost,
} from "./nats/lab-scenarios.js";
export type {
  LabScenario,
  LabScenarioRisk,
  LabScenarioContext,
  BrewLabFormInput,
  BrewLabPartInput,
  BrewLabPartType,
} from "./nats/lab-scenarios.js";
export {
  parseDxUiStatHtml,
  extractPumpRisFromDxStat,
  extractPumpRisFromDxHtml,
  parseDxUiSnapshot,
  parseDxUiGraphLastRow,
  dxUiSnapshotHasData,
  extractJsonArrayAfter,
} from "./nats/dx-ui-stat.js";
export type { DxUiSnapshot } from "./nats/dx-ui-stat.js";
export {
  timed,
  isStale,
  emptyLabSnapshot,
  setTimed,
  STALE_MS,
  LAB_ACTIVE_POLL_MS,
  LAB_OTHER_STATUS_MS,
  planLabNatsPoll,
  isTelemetryStale,
  applyLabStatusReplies,
  computeNatsHostHealth,
  applyDxPumpCurrents,
} from "./nats/lab-telemetry.js";
export type {
  TimedValue,
  TelemetrySource,
  LabSnapshot,
  LabHostHealth,
  LabHostHeaters,
  LabHostPwm,
  HostOkMap,
  DxPumpCurrentsPayload,
} from "./nats/lab-telemetry.js";
export {
  LAB_LOGGER_VERSION,
  LAB_LOGGER_REMOTE_ROOT,
  LAB_LOGGER_UNIT_NAME,
  LAB_LOGGER_USER_UNIT_PATH,
  LAB_LOGGER_USER_UNIT_REL,
  LAB_LOGGER_HTTP_PORT,
  LAB_LOGGER_PACKAGE_FILES,
  LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT,
  LAB_LOGGER_POLL_INTERVAL_MS_MIN,
  LAB_LOGGER_POLL_INTERVAL_MS_MAX,
  clampLabLoggerPollIntervalMs,
  isSeries4ForLabLogger,
  buildLabLoggerConfigJson,
  parseLabLoggerConfigJson,
  buildLabLoggerSystemdUserUnit,
  buildLabLoggerStatusProbeCmd,
  parseLabLoggerHealthJson,
  parseLabLoggerStatusOutput,
  formatLabLoggerStatusLine,
  formatLabLoggerStatusParts,
  convertOnboardRecordToLabEvents,
  convertOnboardRecordsToLabEvents,
  maxOnboardRecordTs,
  nextOnboardEventsFromTs,
  mergeOnboardLabEvents,
  collectOnboardSeriesKeys,
  onboardValveOverlayKeys,
  onboardPumpOverlayHosts,
  onboardHeaterPwmOverlayKeys,
  onboardHeaterIds,
  valvesMapFromOnboardEvents,
  isLabLoggerRealtimeReady,
  resolveLabLoggerSourceKind,
  normalizeOnboardTsMs,
  coerceOnboardActuatorValue,
  labLoggerRingDownloadFilename,
  ensureLabLoggerRingSavePath,
} from "./nats/lab-logger.js";
export type {
  LabLoggerConfigJson,
  LabLoggerHealth,
  LabLoggerStatus,
  LabLoggerUnitState,
  LabLoggerSourceKind,
} from "./nats/lab-logger.js";
export {
  buildHealthReport,
  healthLevelLabel,
  formatHealthReportText,
} from "./health/health-report.js";
export type {
  HealthLevel,
  HealthCheck,
  HealthSection,
  HealthReport,
  HealthReportInput,
} from "./health/health-report.js";
