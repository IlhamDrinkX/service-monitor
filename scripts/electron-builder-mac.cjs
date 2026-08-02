/**
 * macOS electron-builder wrapper — mirrors win helper for env + clean release.
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const desktopRoot = path.resolve(__dirname, "..", "apps", "desktop");
const releaseDir = path.join(desktopRoot, "release");

function rmReleaseStale() {
  if (!fs.existsSync(releaseDir)) return;
  for (const name of fs.readdirSync(releaseDir)) {
    const full = path.join(releaseDir, name);
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[dist:mac] could not remove ${full}: ${e.message}`);
    }
  }
}

rmReleaseStale();

const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};

console.log("[dist:mac] electron-builder --mac");
const r = spawnSync(
  "npx",
  ["electron-builder", "--mac", "--publish", "never"],
  {
    cwd: desktopRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

process.exit(r.status ?? 1);
