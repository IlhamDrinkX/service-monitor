/**
 * Сервисный пароль для правок конфигов.
 * Задаёт админ/разработчик приложения (не полевой инженер и не ERP-логин).
 *
 * Чтобы сменить пароль — правьте SERVICE_PASSWORD_PLAIN ниже и пересоберите.
 */

import { createHash, timingSafeEqual } from "crypto";

/**
 * Пароль правок (DrinkX / drinkx.json). Пример от команды: 112358.
 * Не путать с паролем ERP.
 */
export const SERVICE_PASSWORD_PLAIN = "112358";

const PEPPER = "service-monitor:write:";

export function hashServicePassword(password: string): string {
  return createHash("sha256").update(`${PEPPER}${password}`).digest("hex");
}

/** Ожидаемый хеш встроенного админского пароля. */
export function expectedServicePasswordHash(): string {
  return hashServicePassword(SERVICE_PASSWORD_PLAIN);
}

/**
 * Проверка введённого пароля против админского.
 * Сравнение через хеш + timingSafeEqual.
 */
export function verifyServicePassword(candidate: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(hashServicePassword(candidate), "utf8");
  const b = Buffer.from(expectedServicePasswordHash(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** @deprecated используйте verifyServicePassword */
export function passwordsMatch(
  candidatePassword: string,
  _storedHash?: string | null
): boolean {
  return verifyServicePassword(candidatePassword);
}
