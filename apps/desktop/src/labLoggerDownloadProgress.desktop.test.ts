/**
 * Lab-logger download progress label helpers (без Electron).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bytesToMebibytesRounded,
  formatLabLoggerDownloadProgressLabel,
  labLoggerDownloadPercent,
} from "./lib/lab-logger-download-progress.ts";

describe("desktop / labLogger download progress", () => {
  it("rounds mebibytes and percent for UI label", () => {
    const recv = 12 * 1024 * 1024;
    const total = 65 * 1024 * 1024;
    assert.equal(bytesToMebibytesRounded(recv), 12);
    assert.equal(bytesToMebibytesRounded(total), 65);
    assert.equal(labLoggerDownloadPercent(recv, total), 18);
    assert.equal(
      formatLabLoggerDownloadProgressLabel(recv, total),
      "12 / 65 МБ (18%)"
    );
  });

  it("clamps percent and handles empty total", () => {
    assert.equal(labLoggerDownloadPercent(0, 0), 0);
    assert.equal(labLoggerDownloadPercent(10, 0), 0);
    assert.equal(labLoggerDownloadPercent(200, 100), 100);
    assert.equal(formatLabLoggerDownloadProgressLabel(0, 0), "0 / 0 МБ (0%)");
  });
});
