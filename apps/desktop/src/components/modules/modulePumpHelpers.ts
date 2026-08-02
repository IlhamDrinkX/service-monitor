/** Whether pump toggle should show STOP / treat as running. */
export function isPumpRunning(
  pumpOn: boolean | null,
  pumpPower: number | null | undefined,
  busy: string | null
): boolean {
  return pumpOn === true || (pumpPower ?? 0) > 0 || busy === "pump";
}
