/**
 * Отдельный пароль для опасных действий кассы / ККТ / платежей (CashDev).
 * Не путать с сервисным паролем правок конфигов (112358).
 *
 * Чтобы сменить — правьте CASH_DEV_PASSWORD_PLAIN и пересоберите.
 */

import { createHash, timingSafeEqual } from "crypto";

/** Gate id для UI / sessionStorage / логов. */
export const CASH_DEV_GATE_ID = "cashDev";

/**
 * Пароль критических функций POS (закрытие смены, тест этикетки).
 * Не путать с SERVICE_PASSWORD_PLAIN и ERP.
 */
export const CASH_DEV_PASSWORD_PLAIN = "CashDev";

const PEPPER = "service-monitor:cash-dev:";

export function hashCashDevPassword(password: string): string {
  return createHash("sha256").update(`${PEPPER}${password}`).digest("hex");
}

export function expectedCashDevPasswordHash(): string {
  return hashCashDevPassword(CASH_DEV_PASSWORD_PLAIN);
}

/** Проверка введённого CashDev-пароля (хеш + timingSafeEqual). */
export function verifyCashDevPassword(candidate: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(hashCashDevPassword(candidate), "utf8");
  const b = Buffer.from(expectedCashDevPasswordHash(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
