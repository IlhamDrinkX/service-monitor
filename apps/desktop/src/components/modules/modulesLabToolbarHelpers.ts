export function hostHealthBadgeClass(
  natsOk: boolean | undefined,
  dxOk: boolean | undefined
): string {
  const bothOk = natsOk === true && dxOk === true;
  const anyFail = natsOk === false || dxOk === false;
  return `badge${bothOk ? " on" : anyFail ? " danger" : ""}`;
}
