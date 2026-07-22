/**
 * Клиент Fibbee ERP (read-only для Stage 2).
 * Контракт как в C:\myApp\fibbee\client.py:
 *   POST /v1/auth/create  → JWT
 *   заголовок x-auth-token (не Bearer)
 *   GET /v1/sales-points/list
 */

import {
  ERP_DEFAULT_BASE_URL,
  type ErpAuthSession,
  type ErpSalesPoint,
} from "./types.js";

export class FibbeeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FibbeeAuthError";
  }
}

export class FibbeeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "FibbeeApiError";
  }
}

export interface FibbeeClientOptions {
  baseUrl?: string;
  /** Для тестов — подмена fetch. */
  fetchImpl?: typeof fetch;
}

type JsonObject = Record<string, unknown>;

export class FibbeeClient {
  readonly baseUrl: string;
  private token: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FibbeeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? ERP_DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  /**
   * Логин email+password.
   * Не логируем пароль — только факт успеха/ошибки снаружи.
   */
  async login(email: string, password: string): Promise<ErpAuthSession> {
    const resp = await this.fetchImpl(`${this.baseUrl}/v1/auth/create`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lang": "ru" },
      body: JSON.stringify({ email, password }),
    });

    let data: JsonObject;
    try {
      data = (await resp.json()) as JsonObject;
    } catch {
      throw new FibbeeAuthError(
        `Логин не удался: сервер ответил не JSON (${resp.status})`
      );
    }

    if (!data.success || typeof data.token !== "string" || !data.token) {
      throw new FibbeeAuthError(
        `Логин не удался: ${safePreview(data)}`
      );
    }

    this.token = data.token;
    return {
      token: data.token,
      userId: data.userId as string | number | undefined,
      role: typeof data.role === "string" ? data.role : undefined,
      email,
    };
  }

  /** Список комплексов со статусами. */
  async listSalesPoints(): Promise<ErpSalesPoint[]> {
    const data = await this.getJson("/v1/sales-points/list");
    const raw = data.salesPoints;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((item) => normalizeSalesPoint(item));
  }

  /** URL облачного дашборда для открытия в браузере. */
  buildDashboardUrl(salesPointId: string): string {
    if (!this.token) {
      throw new FibbeeAuthError("Нет токена — сначала login");
    }
    const id = encodeURIComponent(salesPointId);
    const token = encodeURIComponent(this.token);
    return `${this.baseUrl}/dashboard/view/${id}/dashboard.html?token=${token}`;
  }

  private async getJson(path: string): Promise<JsonObject> {
    if (!this.token) {
      throw new FibbeeAuthError("Нет токена — сначала login");
    }

    const resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        "x-auth-token": this.token,
        "x-lang": "ru",
      },
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new FibbeeAuthError(`Сессия истекла (${resp.status})`);
    }

    let data: JsonObject;
    try {
      data = (await resp.json()) as JsonObject;
    } catch {
      throw new FibbeeApiError(`Не JSON от ${path}`, resp.status);
    }

    if (data.success === false) {
      throw new FibbeeApiError(
        `API error ${path}: ${safePreview(data)}`,
        resp.status
      );
    }

    return data;
  }
}

/** Вытащить человекочитаемые поля из сырого salesPoint. */
export function normalizeSalesPoint(raw: unknown): ErpSalesPoint {
  const sp = (raw ?? {}) as JsonObject;
  const nameObj = sp.name as JsonObject | string | undefined;
  let name = "";
  if (typeof nameObj === "string") {
    name = nameObj;
  } else if (nameObj && typeof nameObj === "object") {
    name =
      String(nameObj.ru ?? nameObj.en ?? nameObj.ruRu ?? "") ||
      String(sp.salesPointId ?? "без имени");
  } else {
    name = String(sp.salesPointId ?? "без имени");
  }

  const salesPointId = String(sp.salesPointId ?? sp.id ?? "");
  const status = String(sp.status ?? "unknown") as ErpSalesPoint["status"];

  const seriesLabel = pickSeriesLabel(sp);

  return {
    salesPointId,
    name: name || salesPointId || "без имени",
    status,
    brand: typeof sp.brand === "string" ? sp.brand : undefined,
    cityId:
      sp.cityId != null
        ? String(sp.cityId)
        : sp.city != null
          ? String(sp.city)
          : undefined,
    seriesLabel,
    rawSummary: {
      salesPointId,
      status,
      brand: sp.brand,
      series: sp.series,
      fibbeeSeries: sp.fibbeeSeries,
    },
  };
}

function pickSeriesLabel(sp: JsonObject): string | undefined {
  const candidates = [
    sp.seriesLabel,
    sp.series,
    sp.fibbeeSeries,
    sp.FIBBEE_SERIES,
    (sp.config as JsonObject | undefined)?.series,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return undefined;
}

function safePreview(data: unknown): string {
  try {
    const s = JSON.stringify(data);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return "[unserializable]";
  }
}
