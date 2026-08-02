/**
 * Linux electron-builder wrapper — mirrors win/mac helpers for clean release.
 * No CSC/signing env needed (AppImage/deb are unsigned).
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
      console.warn(`[dist:linux] could not remove ${full}: ${e.message}`);
    }
  }
}

rmReleaseStale();

console.log("[dist:linux] electron-builder --linux");
const r = spawnSync(
  "npx",
  ["electron-builder", "--linux", "--publish", "never"],
  {
    cwd: desktopRoot,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

process.exit(r.status ?? 1);
