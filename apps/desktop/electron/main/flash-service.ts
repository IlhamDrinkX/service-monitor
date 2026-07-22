/**
 * Flash сиропных плат (partA / partB) через Host dozator → flash-cli.js.
 * Эталон: fleet-foundry/flash_sirup/main.js
 */

import { runDozatorSsh } from "./dozator-ssh";

const REMOTE_NODE = "/home/pi/.nvm/versions/node/v18.20.8/bin/node";
const REMOTE_SCRIPT =
  "/home/pi/complexos-dozator-drv/automatic_dozator/flash-cli.js";

export type FlashPartAConfig = {
  currentId: number | string;
  newId: number | string;
  currentBaud: number | string;
  newBaud: number | string;
};

export type FlashPartBConfig = {
  newId: number | string;
  newBaud: number | string;
};

async function runFlashCli(
  args: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const remoteCmd = `bash -lc "${REMOTE_NODE} ${REMOTE_SCRIPT} ${args.join(" ")}"`;
  try {
    await runDozatorSsh(remoteCmd, {
      timeoutMs: 300_000,
      logChannel: "flash:log",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function flashPartA(
  config: FlashPartAConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runFlashCli([
    "--mode",
    "partA",
    "--currentId",
    String(config.currentId),
    "--newId",
    String(config.newId),
    "--oldBaud",
    String(config.currentBaud),
    "--newBaud",
    String(config.newBaud),
  ]);
}

export async function flashPartB(
  config: FlashPartBConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runFlashCli([
    "--mode",
    "partB",
    "--currentId",
    String(config.newId),
    "--newBaud",
    String(config.newBaud),
  ]);
}
