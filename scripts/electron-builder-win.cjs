/**
 * Windows electron-builder wrapper.
 *
 * - CSC_IDENTITY_AUTO_DISCOVERY=false, __COMPAT_LAYER=RunAsInvoker
 * - Kill ServiceMonitor before clean
 * - If release/win-unpacked is locked (Defender / running app), build into a fresh
 *   output dir and copy Setup.exe into release/
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const desktopRoot = path.resolve(__dirname, "..", "apps", "desktop");
const releaseDir = path.join(desktopRoot, "release");

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function unlockRelease() {
  if (process.platform !== "win32") return;
  for (const name of ["ServiceMonitor.exe", "electron.exe"]) {
    spawnSync("taskkill", ["/F", "/IM", name, "/T"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
  sleepMs(1000);
}

function rmDeep(full) {
  try {
    fs.rmSync(full, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 300,
    });
    return true;
  } catch {
    return false;
  }
}

function tryCleanRelease() {
  unlockRelease();
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
    return true;
  }
  let ok = true;
  for (const name of fs.readdirSync(releaseDir)) {
    const full = path.join(releaseDir, name);
    if (!rmDeep(full)) {
      ok = false;
      console.warn(`[dist:win] locked, leave in place: ${name}`);
    }
  }
  return ok;
}

function pickOutputDir() {
  if (tryCleanRelease()) return releaseDir;
  const alt = path.join(desktopRoot, `release-build-${Date.now()}`);
  fs.mkdirSync(alt, { recursive: true });
  console.warn(
    `[dist:win] release/ is locked — building into ${path.basename(alt)}`
  );
  return alt;
}

function runBuilder(outDir, attempt) {
  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    __COMPAT_LAYER: "RunAsInvoker",
  };

  const args = [
    "electron-builder",
    "--win",
    "--publish",
    "never",
    `--config.directories.output=${outDir}`,
  ];

  console.log(
    `[dist:win] electron-builder --win (attempt ${attempt}) out=${path.basename(outDir)}`
  );
  const r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    args,
    {
      cwd: desktopRoot,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    }
  );
  return r.status ?? 1;
}

function isTinyStub(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const name of fs.readdirSync(dir)) {
    if (!/Setup.*\.exe$/i.test(name)) continue;
    const st = fs.statSync(path.join(dir, name));
    if (st.isFile() && st.size > 0 && st.size < 512 * 1024) return true;
  }
  return false;
}

function promoteArtifacts(fromDir) {
  if (path.resolve(fromDir) === path.resolve(releaseDir)) return;
  fs.mkdirSync(releaseDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    if (!/\.(exe|blockmap|yml|yaml)$/i.test(name) && name !== "latest.yml") {
      // copy Setup + blockmap + yml only; skip win-unpacked tree
      if (!/Setup/i.test(name) && !/\.blockmap$/i.test(name)) continue;
    }
    const src = path.join(fromDir, name);
    const st = fs.statSync(src);
    if (!st.isFile()) continue;
    const dest = path.join(releaseDir, name);
    try {
      fs.copyFileSync(src, dest);
      console.log(`[dist:win] copied ${name} -> release/`);
    } catch (e) {
      console.warn(`[dist:win] could not copy ${name}: ${e.message}`);
    }
  }
}

const outDir = pickOutputDir();
let code = runBuilder(outDir, 1);
if (code !== 0) {
  console.warn(
    "\n[dist:win] first build failed — retry with a fresh output dir...\n"
  );
  unlockRelease();
  sleepMs(1500);
  const alt = path.join(desktopRoot, `release-build-${Date.now()}`);
  fs.mkdirSync(alt, { recursive: true });
  code = runBuilder(alt, 2);
  if (code === 0) promoteArtifacts(alt);
} else if (path.resolve(outDir) !== path.resolve(releaseDir)) {
  promoteArtifacts(outDir);
}

if (code === 0 && isTinyStub(releaseDir) && isTinyStub(outDir)) {
  console.error("[dist:win] Setup.exe looks like an incomplete NSIS stub (<512KB).");
  code = 1;
}

process.exit(code);
