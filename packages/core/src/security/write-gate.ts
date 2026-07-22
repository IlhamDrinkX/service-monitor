/**
 * WriteGate: правки конфигов только после отдельного сервисного пароля.
 * Пароль ≠ ERP-логин — чтобы неподготовленные инженеры не лезли в drinkx.json.
 */

import type { WriteSession } from "../domain/types.js";

export interface WriteGateOptions {
  /** Длительность разблокировки, мс. */
  sessionTtlMs?: number;
  /**
   * Проверка пароля. В desktop передаётся сверка с secure store.
   * В тестах — простая функция.
   */
  verifyPassword: (password: string) => Promise<boolean> | boolean;
  now?: () => number;
}

export class WriteGate {
  private readonly ttlMs: number;
  private readonly verifyPassword: WriteGateOptions["verifyPassword"];
  private readonly now: () => number;
  private expiresAt: number | null = null;

  constructor(options: WriteGateOptions) {
    this.ttlMs = options.sessionTtlMs ?? 20 * 60 * 1000;
    this.verifyPassword = options.verifyPassword;
    this.now = options.now ?? (() => Date.now());
  }

  getSession(): WriteSession {
    if (this.expiresAt != null && this.now() < this.expiresAt) {
      return {
        unlocked: true,
        expiresAt: new Date(this.expiresAt).toISOString(),
      };
    }
    this.expiresAt = null;
    return { unlocked: false, expiresAt: null };
  }

  isUnlocked(): boolean {
    return this.getSession().unlocked;
  }

  async unlock(password: string): Promise<WriteSession> {
    const ok = await this.verifyPassword(password);
    if (!ok) {
      this.expiresAt = null;
      return this.getSession();
    }
    this.expiresAt = this.now() + this.ttlMs;
    return this.getSession();
  }

  lock(): WriteSession {
    this.expiresAt = null;
    return this.getSession();
  }

  /** Бросает, если запись запрещена. */
  assertCanWrite(): void {
    if (!this.isUnlocked()) {
      throw new Error(
        "Write locked: enter service password to edit configs"
      );
    }
  }
}
