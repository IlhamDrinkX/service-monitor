/**
 * Доменные типы Service Monitor.
 * Общее ядро для desktop (сейчас) и Android-модуля (позже).
 */

/** Роль узла внутри сети комплекса DrinkX. */
export type ModuleRole =
  | "complexos"
  | "milk"
  | "coffee"
  | "water"
  | "router"
  | "unknown";

/** Режим подключения инженера к комплексу. */
export type ConnectionMode = "remote" | "local";

/**
 * Профиль комплекса: номер/порт SSH и человекочитаемое имя.
 * Пример: seriesLabel "4.15", sshPort 22415.
 */
export interface ComplexProfile {
  id: string;
  /** Отображаемое имя, например «Комплекс №4.15». */
  name: string;
  /** Порт на ERP jump-хосте, он же Host в ssh config. */
  sshPort: number;
  /** Подпись серии, опционально (4.15). */
  seriesLabel?: string;
  /** Путь к приватному ключу; по умолчанию ~/.ssh/id_ed25519. */
  identityFile?: string;
  /** ERP sales point id, если уже известен из облака. */
  salesPointId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Устройство, видимое в LAN комплекса. */
export interface NetworkDevice {
  hostname: string;
  ip: string;
  role: ModuleRole;
  online: boolean;
  /** MAC из ARP/neigh (для «других» устройств). */
  mac?: string | null;
  /** ISO last-seen для sticky discovery. */
  lastSeenAt?: string | null;
}

/** Уровень записи debug-лога. */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface DebugLogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
}

/** Состояние write-доступа: по умолчанию только чтение. */
export interface WriteSession {
  unlocked: boolean;
  /** ISO-время истечения сессии; null если заблокировано. */
  expiresAt: string | null;
}
