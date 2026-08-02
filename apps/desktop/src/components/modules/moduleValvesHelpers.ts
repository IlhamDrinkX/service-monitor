/** DX host valve row disabled while live/busy for that valve or bulk/pkg ops. */
export function isValveRowDisabled(
  baseId: string,
  live: boolean,
  busy: string | null
): boolean {
  return (
    !live ||
    busy === `valve-${baseId}` ||
    busy === "valves-all" ||
    busy === "valve-pkg"
  );
}
