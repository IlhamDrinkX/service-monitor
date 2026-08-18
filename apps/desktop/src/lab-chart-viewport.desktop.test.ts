/**
 * Lab chart viewport helpers (zoom clamp, boolean segment edges).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LAB_CHART_MIN_WINDOW_MS,
  LAB_CHART_PRESET_MS,
  clampChartWindowMs,
  findBooleanSegmentEdges,
  formatBooleanSegmentTooltip,
  formatWindowDurationLabel,
  matchPresetScale,
  panOffsetFromOverviewFraction,
  zoomChartViewport,
} from "./lib/lab-chart-viewport.ts";

describe("desktop / lab-chart-viewport", () => {
  it("clamps window between min and data span", () => {
    assert.equal(
      clampChartWindowMs(1_000, { dataSpanMs: 600_000 }),
      LAB_CHART_MIN_WINDOW_MS
    );
    assert.equal(
      clampChartWindowMs(999_999_999, { dataSpanMs: 300_000 }),
      300_000
    );
    assert.equal(
      clampChartWindowMs(LAB_CHART_PRESET_MS["5m"], { dataSpanMs: 3_600_000 }),
      LAB_CHART_PRESET_MS["5m"]
    );
  });

  it("zooms about cursor and preserves fractional position", () => {
    const clockNow = 1_000_000;
    const dataMinT = clockNow - 3_600_000;
    const windowMs = 300_000;
    const panOffsetMs = 600_000; // viewEnd = 400_000, viewStart = 100_000
    const viewEnd = clockNow - panOffsetMs;
    const viewStart = viewEnd - windowMs;
    const anchorT = viewStart + windowMs * 0.25;

    const next = zoomChartViewport({
      windowMs,
      panOffsetMs,
      clockNow,
      dataMinT,
      anchorT,
      factor: 0.5,
    });

    assert.equal(next.windowMs, 150_000);
    const newEnd = clockNow - next.panOffsetMs;
    const newStart = newEnd - next.windowMs;
    const frac = (anchorT - newStart) / next.windowMs;
    assert.ok(Math.abs(frac - 0.25) < 0.02, `frac=${frac}`);
  });

  it("maps overview fraction: seek centers window, rightEdge keeps live at 1", () => {
    const clockNow = 1_000_000;
    const dataMinT = 0;
    const windowMs = 100_000;
    assert.equal(
      panOffsetFromOverviewFraction({
        fraction: 1,
        windowMs,
        clockNow,
        dataMinT,
        mode: "rightEdge",
      }),
      0
    );
    assert.equal(
      panOffsetFromOverviewFraction({
        fraction: 0,
        windowMs,
        clockNow,
        dataMinT,
        mode: "rightEdge",
      }),
      clockNow - dataMinT - windowMs
    );
    const mid = panOffsetFromOverviewFraction({
      fraction: 0.5,
      windowMs,
      clockNow,
      dataMinT,
      mode: "seek",
    });
    const viewEnd = clockNow - mid;
    const viewStart = viewEnd - windowMs;
    const center = (viewStart + viewEnd) / 2;
    assert.ok(Math.abs(center - 500_000) < 2_000, `center=${center}`);
  });

  it("finds open/close edges of a boolean pulse", () => {
    // step series: OFF → ON @100 → OFF @250 (booleanStepSeries style)
    const points = [
      { t: 0, v: 0 },
      { t: 100, v: 0 },
      { t: 100, v: 1 },
      { t: 250, v: 1 },
      { t: 250, v: 0 },
      { t: 400, v: 0 },
    ];
    const onSeg = findBooleanSegmentEdges(points, 180);
    assert.deepEqual(onSeg, { on: true, startMs: 100, endMs: 250 });

    const offSeg = findBooleanSegmentEdges(points, 300);
    assert.deepEqual(offSeg, { on: false, startMs: 250, endMs: 400 });

    const tip = formatBooleanSegmentTooltip(onSeg!);
    assert.equal(tip.state, "ON");
    assert.match(tip.detail, /открыт/);
    assert.match(tip.detail, /закрыт/);
  });

  it("labels presets and custom durations", () => {
    assert.equal(matchPresetScale(null), "all");
    assert.equal(matchPresetScale(LAB_CHART_PRESET_MS["5m"]), "5m");
    assert.equal(matchPresetScale(45_000), "custom");
    assert.equal(formatWindowDurationLabel(45_000), "45 с");
    assert.equal(formatWindowDurationLabel(300_000), "5 мин");
  });
});
