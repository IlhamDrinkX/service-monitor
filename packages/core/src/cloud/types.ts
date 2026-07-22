/**
 * Нормализованная модель точки продаж (комплекса) из ERP.
 * Сырой объект salesPoints/list очень большой — в UI берём только нужное.
 */

export type ErpPointStatus =
  | "production"
  | "manufacturing"
  | "archived"
  | "discontinued"
  | "unknown"
  | string;

export interface ErpSalesPoint {
  salesPointId: string;
  /** Имя на русском (или en fallback). */
  name: string;
  status: ErpPointStatus;
  brand?: string;
  cityId?: string;
  /** Серия/метка, если есть в объекте (разные поля в ERP). */
  seriesLabel?: string;
  /** Сырой фрагмент для отладки (без огромных вложений). */
  rawSummary?: Record<string, unknown>;
}

export interface ErpAuthSession {
  token: string;
  userId?: string | number;
  role?: string;
  email: string;
}

export const ERP_DEFAULT_BASE_URL = "https://erp.fibbee.com";
