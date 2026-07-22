/**
 * Debug-логгер: кольцевой буфер в памяти + опциональная запись на диск.
 * Включите Debug в настройках — файлы можно прислать ассистенту при сбое.
 */

import type { DebugLogEntry, LogLevel } from "../domain/types.js";

export interface DebugLogSink {
  /** Записать строку (уже отформатированную). */
  append(line: string): Promise<void> | void;
}

export interface DebugLoggerOptions {
  /** Максимум записей в RAM. */
  maxEntries?: number;
  enabled?: boolean;
  sink?: DebugLogSink | null;
}

export class DebugLogger {
  private enabled: boolean;
  private readonly maxEntries: number;
  private sink: DebugLogSink | null;
  private readonly entries: DebugLogEntry[] = [];

  constructor(options: DebugLoggerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.maxEntries = options.maxEntries ?? 2000;
    this.sink = options.sink ?? null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    void this.write("info", "debug", `Debug mode ${enabled ? "ON" : "OFF"}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setSink(sink: DebugLogSink | null): void {
    this.sink = sink;
  }

  getEntries(): readonly DebugLogEntry[] {
    return this.entries;
  }

  /** Снимок для экспорта / отправки ассистенту. */
  exportText(): string {
    return this.entries
      .map((e) => {
        const data =
          e.data === undefined ? "" : ` ${safeJson(e.data)}`;
        return `[${e.ts}] ${e.level.toUpperCase()} [${e.scope}] ${e.message}${data}`;
      })
      .join("\n");
  }

  debug(scope: string, message: string, data?: unknown): void {
    void this.write("debug", scope, message, data);
  }

  info(scope: string, message: string, data?: unknown): void {
    void this.write("info", scope, message, data);
  }

  warn(scope: string, message: string, data?: unknown): void {
    void this.write("warn", scope, message, data);
  }

  error(scope: string, message: string, data?: unknown): void {
    void this.write("error", scope, message, data);
  }

  private async write(
    level: LogLevel,
    scope: string,
    message: string,
    data?: unknown
  ): Promise<void> {
    if (!this.enabled && level === "debug") {
      return;
    }
    // info/warn/error пишем всегда в буфер при включённом debug;
    // при выключенном — только warn/error (чтобы ловить сбои).
    if (!this.enabled && (level === "info" || level === "debug")) {
      return;
    }

    const entry: DebugLogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      data,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    if (this.enabled && this.sink) {
      const dataPart =
        data === undefined ? "" : ` ${safeJson(data)}`;
      const line = `[${entry.ts}] ${level.toUpperCase()} [${scope}] ${message}${dataPart}\n`;
      try {
        await this.sink.append(line);
      } catch {
        // Не роняем приложение из‑за логгера.
      }
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
