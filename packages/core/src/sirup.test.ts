/**
 * Sirup / dispenser NATS helpers (complexos.sirup.*).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySirupStatusFailure,
  formatSirupIdRanges,
  isSirupStatusTimeout,
  parseSirupHwid,
  parseSirupMusterReplies,
  parseSirupPumpReply,
  parseSirupStatusReply,
  sirupPumpPayload,
  sirupStatusLabel,
  summarizeSirupPollResults,
  SIRUP_SUBJECTS,
  type SirupPollItem,
} from "./nats/sirup.js";

describe("sirup subjects", () => {
  it("builds status/pump/unpump/stop subjects", () => {
    assert.equal(SIRUP_SUBJECTS.muster, "complexos.sirup.muster");
    assert.equal(SIRUP_SUBJECTS.status(5), "complexos.sirup.status.5");
    assert.equal(SIRUP_SUBJECTS.pump("12"), "complexos.sirup.pump.12");
    assert.equal(SIRUP_SUBJECTS.unpump(3), "complexos.sirup.unpump.3");
    assert.equal(SIRUP_SUBJECTS.stop(1), "complexos.sirup.stop.1");
  });
});

describe("parseSirupMusterReplies", () => {
  it("parses JSON-string and numeric hwids, sorts numerically", () => {
    const ids = parseSirupMusterReplies([
      '"22"',
      '"3"',
      1,
      '"10"',
      { hwid: 5 },
      null,
      "",
    ]);
    assert.deepEqual(ids, ["1", "3", "5", "10", "22"]);
  });
});

describe("parseSirupHwid", () => {
  it("unwraps quoted JSON strings", () => {
    assert.equal(parseSirupHwid('"7"'), "7");
    assert.equal(parseSirupHwid("sirup4"), "sirup4");
  });
});

describe("parseSirupStatusReply", () => {
  it("reads forward/reverse/stopped", () => {
    const s = parseSirupStatusReply({
      success: true,
      hwid: 4,
      status: "forward",
    });
    assert.equal(s.success, true);
    assert.equal(s.hwid, "4");
    assert.equal(s.status, "forward");
    assert.equal(sirupStatusLabel(s.status), "вперёд");
  });

  it("unwraps result envelope", () => {
    const s = parseSirupStatusReply({
      result: { success: true, hwid: "2", status: "stopped" },
    });
    assert.equal(s.status, "stopped");
  });
});

describe("parseSirupPumpReply", () => {
  it("success with seconds", () => {
    const r = parseSirupPumpReply({ success: true, seconds: 1.5 });
    assert.equal(r.success, true);
    assert.equal(r.seconds, 1.5);
  });

  it("hardware-failure", () => {
    const r = parseSirupPumpReply({
      error: true,
      message: "hardware-failure",
    });
    assert.equal(r.error, true);
    assert.equal(r.message, "hardware-failure");
  });
});

describe("sirupPumpPayload", () => {
  it("clamps seconds and intensity", () => {
    assert.deepEqual(sirupPumpPayload({ seconds: 0, intensity: 200 }), {
      seconds: 0.1,
      intensity: 100,
    });
    assert.deepEqual(sirupPumpPayload({ seconds: 2, intensity: 50 }), {
      seconds: 2,
      intensity: 50,
    });
  });
});

describe("sirupStatusLabel", () => {
  it("labels unknown as нет ответа", () => {
    assert.equal(sirupStatusLabel("unknown"), "нет ответа");
    assert.equal(sirupStatusLabel("stopped"), "стоп");
  });
});

describe("isSirupStatusTimeout / classify", () => {
  it("detects field timeout strings", () => {
    assert.equal(
      isSirupStatusTimeout("complexos.sirup.status.4 timeout 1200ms"),
      true
    );
    assert.equal(classifySirupStatusFailure("status.12 timeout 1200ms"), "timeout");
    assert.equal(classifySirupStatusFailure("hardware-failure"), "error");
  });
});

describe("formatSirupIdRanges", () => {
  it("collapses consecutive ids", () => {
    assert.equal(formatSirupIdRanges(["1", "2", "3", "5", "10", "11"]), "1–3, 5, 10–11");
    assert.equal(formatSirupIdRanges(["4", "5", "6", "7", "8", "9", "10",
      "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
      "21", "22", "23", "24", "25", "26", "27", "28", "29", "30"]), "4–30");
  });

  it("keeps non-numeric ids and empty list", () => {
    assert.equal(formatSirupIdRanges([]), "");
    assert.equal(formatSirupIdRanges(["sirupA", "2", "1"]), "1–2, sirupA");
  });
});

describe("summarizeSirupPollResults", () => {
  it("field scenario: 1–3 stopped, 4–30 timeout (summary + soft field note)", () => {
    const items: SirupPollItem[] = [];
    for (let n = 1; n <= 3; n++) {
      items.push({ hwid: String(n), kind: "ok", status: "stopped" });
    }
    for (let n = 4; n <= 30; n++) {
      items.push({
        hwid: String(n),
        kind: "timeout",
        message: `complexos.sirup.status.${n} timeout 1200ms`,
      });
    }
    const s = summarizeSirupPollResults(items);
    assert.equal(s.okCount, 3);
    assert.equal(s.timeoutCount, 27);
    assert.equal(s.errorCount, 0);
    assert.equal(s.summaryLine, "ответили: 1–3 (стоп) · нет ответа: 4–30 (27)");
    assert.deepEqual(s.okLines, ["#1 · стоп", "#2 · стоп", "#3 · стоп"]);
    assert.equal(s.noReplyLine, "нет ответа: 4–30 (27)");
    assert.equal(s.errorLines.length, 0);
    assert.ok(s.fieldNote && /последовательн/i.test(s.fieldNote));
    assert.ok(s.fieldNote && /отсутствующ/i.test(s.fieldNote));
  });

  it("keeps non-timeout errors verbose", () => {
    const s = summarizeSirupPollResults([
      { hwid: "1", kind: "ok", status: "forward" },
      { hwid: "2", kind: "error", message: "hardware-failure" },
    ]);
    assert.equal(s.summaryLine, "ответили: 1 (вперёд) · ошибка: 2 (1)");
    assert.deepEqual(s.errorLines, ["#2 · ошибка · hardware-failure"]);
    assert.equal(s.fieldNote, null);
  });

  it("empty poll and mixed reverse/timeout", () => {
    assert.equal(summarizeSirupPollResults([]).summaryLine, "опрос пуст");
    assert.equal(summarizeSirupPollResults([]).fieldNote, null);
    const mixed = summarizeSirupPollResults([
      { hwid: "5", kind: "ok", status: "reverse" },
      { hwid: "6", kind: "timeout", message: "timeout" },
    ]);
    assert.equal(mixed.summaryLine, "ответили: 5 (назад) · нет ответа: 6 (1)");
    assert.ok(mixed.fieldNote);
  });
});
