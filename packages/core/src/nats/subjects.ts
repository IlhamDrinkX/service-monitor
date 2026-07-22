/**
 * NATS subjects DrinkX / aerp-service-transport.
 */

export const NATS_SUBJECTS = {
  muster: "coffeemachine.muster",
  status: "coffeemachine.status",
  brew: "coffeemachine.brew",
  updateConfig: "coffeemachine.update-config",
  statusNotification: "coffeemachine.status-notification",
  startCleaning: "coffeemachine.startcleaning",
} as const;

export type NatsModuleRole = "milk" | "coffee" | "water" | string;

export interface NatsMusterEntry {
  hwid?: string;
  label?: string;
  role?: string;
  apps?: string[];
  raw: unknown;
}

export interface NatsConnectionInfo {
  connected: boolean;
  server: string | null;
  message: string;
}
