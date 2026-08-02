/**
 * Platform router for `npm run dist` (no --win/--mac flag).
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const script =
  process.platform === "win32"
    ? "electron-builder-win.cjs"
    : process.platform === "darwin"
      ? "electron-builder-mac.cjs"
      : process.platform === "linux"
        ? "electron-builder-linux.cjs"
        : null;

if (!script) {
  console.error(
    `[dist] No installer target for platform=${process.platform}. Use dist:dir or build on Windows/macOS/Linux.`
  );
  process.exit(1);
}

const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
