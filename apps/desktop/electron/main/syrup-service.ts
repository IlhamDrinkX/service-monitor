/**
 * Сироп / dozator через общий SSH helper.
 */

import { runDozatorSsh } from "./dozator-ssh";

const MODBUS_CLI =
  "/home/pi/.nvm/versions/node/v18.20.8/bin/node ~/complexos-dozator-drv/automatic_dozator/modbus-cli.js";

export async function syrupCheckSsh(): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  try {
    const out = await runDozatorSsh("echo OK", { timeoutMs: 12_000 });
    if (out.includes("OK")) {
      return { ok: true, message: "dozator SSH OK (Host dozator)" };
    }
    return { ok: false, error: `Неожиданный ответ: ${out.slice(0, 120)}` };
  } catch (e) {
    return {
      ok: false,
      error:
        (e instanceof Error ? e.message : String(e)) +
        " — нужен Host dozator в ~/.ssh/config",
    };
  }
}

export async function syrupModbusScan(input: {
  mode: "scan" | "motor";
  maxId?: number;
  baud?: number;
  id?: number;
  seconds?: number;
  intensity?: number;
  singleMode?: boolean;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  try {
    let cmd = `${MODBUS_CLI} --mode ${input.mode}`;
    if (input.mode === "motor") {
      cmd += ` --baud ${input.baud ?? 9600} --id ${input.id ?? 1} --seconds ${input.seconds ?? 2} --intensity ${input.intensity ?? 50}`;
    } else {
      cmd += ` --maxId ${input.maxId ?? 32}`;
      if (input.singleMode && input.baud) cmd += ` --baud ${input.baud}`;
    }
    const output = await runDozatorSsh(cmd, { timeoutMs: 120_000 });
    return { ok: true, output };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
