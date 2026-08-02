/** Disabled state for scenario ActionButton (Stop CM may run while rinse busy). */
export function isScenarioButtonDisabled(
  scenarioId: string,
  busy: string | null,
  controlsDisabled: boolean
): boolean {
  if (controlsDisabled) return true;
  if (scenarioId === "stop-cm") return busy === "scenario-stop-cm";
  return busy !== null;
}
