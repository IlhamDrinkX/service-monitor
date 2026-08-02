/**
 * POS / printer / payments NATS helpers + CashDev password.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CASH_DEV_GATE_ID,
  CASH_DEV_PASSWORD_PLAIN,
  hashCashDevPassword,
  verifyCashDevPassword,
} from "./security/cash-dev-password.js";
import {
  PAYMENTS_SUBJECTS,
  POS_BARCODE_TEST,
  POS_HOST_PROBE_CMD,
  POS_STATUS_AUTO_COMMIT_WARNING,
  PRINTER_SUBJECTS,
  formatPosHostProbeLog,
  formatPosStatusLine,
  parsePaymentsCheckReply,
  parsePaymentsStatusReply,
  parsePosActionReply,
  parsePosHwid,
  parsePosHostProbeOutput,
  parsePosMusterReplies,
  parsePrinterStatusReply,
  posBarcodeTestPayload,
  posWorkdayLabel,
} from "./nats/pos.js";
import { WriteGate } from "./security/write-gate.js";
import {
  SERVICE_PASSWORD_PLAIN,
  verifyServicePassword,
} from "./security/password.js";

describe("pos subjects", () => {
  it("builds printer/payments subjects (no invented names)", () => {
    assert.equal(PRINTER_SUBJECTS.muster, "complexos.printer.muster");
    assert.equal(
      PRINTER_SUBJECTS.status("kiosk2"),
      "complexos.printer.status.kiosk2"
    );
    assert.equal(
      PRINTER_SUBJECTS.commit("kiosk2"),
      "complexos.printer.commit.kiosk2"
    );
    assert.equal(
      PRINTER_SUBJECTS.printCheque("kiosk2"),
      "complexos.printer.print-cheque.kiosk2"
    );
    assert.equal(
      PRINTER_SUBJECTS.printRefund("kiosk2"),
      "complexos.printer.print-refund.kiosk2"
    );
    assert.equal(PAYMENTS_SUBJECTS.muster, "complexos.payments.muster");
    assert.equal(
      PAYMENTS_SUBJECTS.status("kiosk2"),
      "complexos.payments.status.kiosk2"
    );
    assert.equal(
      PAYMENTS_SUBJECTS.check("kiosk2"),
      "complexos.payments.check.kiosk2"
    );
    assert.equal(
      PAYMENTS_SUBJECTS.commit("kiosk2"),
      "complexos.payments.commit.kiosk2"
    );
    assert.equal(
      PAYMENTS_SUBJECTS.charge("kiosk2"),
      "complexos.payments.charge.kiosk2"
    );
    assert.equal(
      PAYMENTS_SUBJECTS.refund("kiosk2"),
      "complexos.payments.refund.kiosk2"
    );
  });
});

describe("parsePosMusterReplies", () => {
  it("parses kiosk hwid strings", () => {
    const ids = parsePosMusterReplies([
      '"kiosk2"',
      "kiosk2",
      { hwid: "kiosk2" },
      null,
      "",
    ]);
    assert.deepEqual(ids, ["kiosk2"]);
    assert.equal(parsePosHwid('"kiosk2"'), "kiosk2");
  });

  it("unwraps result/value envelopes", () => {
    assert.equal(parsePosHwid({ result: { hwid: "kiosk2" } }), "kiosk2");
    assert.equal(parsePosHwid({ value: "desk1" }), "desk1");
    assert.deepEqual(
      parsePosMusterReplies([{ result: "kiosk2" }, { value: "desk1" }]),
      ["desk1", "kiosk2"]
    );
  });
});

describe("parsePrinterStatusReply", () => {
  it("reads connected/workday", () => {
    const s = parsePrinterStatusReply({
      connected: true,
      workday: "open",
    });
    assert.equal(s.success, true);
    assert.equal(s.connected, true);
    assert.equal(posWorkdayLabel(s.workday), "открыта");
    assert.match(
      formatPosStatusLine("printer", s),
      /connected.*открыта/
    );
  });

  it("flags expired workday label", () => {
    assert.equal(posWorkdayLabel("expired"), "истекла (>24ч)");
    assert.equal(posWorkdayLabel("closed"), "закрыта");
    assert.equal(posWorkdayLabel(undefined), "—");
    assert.ok(POS_STATUS_AUTO_COMMIT_WARNING.includes("commit"));
  });

  it("parses JSON string and barcode-mode connected+workday", () => {
    const s = parsePrinterStatusReply(
      JSON.stringify({ connected: true, workday: "open" })
    );
    assert.equal(s.connected, true);
    assert.equal(s.workday, "open");
    assert.equal(s.success, true);
  });

  it("marks disconnected printer and empty status as error", () => {
    const d = parsePrinterStatusReply({ connected: false, workday: "closed" });
    assert.equal(d.connected, false);
    assert.match(formatPosStatusLine("printer", d), /disconnected/);
    const empty = parsePrinterStatusReply(null);
    assert.equal(empty.error, true);
    assert.equal(empty.message, "empty status");
  });
});

describe("parsePaymentsStatusReply / check", () => {
  it("reads workday/openedAt; connected usually absent", () => {
    const st = parsePaymentsStatusReply({
      result: { workday: "open", openedAt: 123 },
    });
    assert.equal(st.workday, "open");
    assert.equal(st.openedAt, 123);
    assert.equal(st.connected, undefined);
    assert.match(
      formatPosStatusLine("payments", st),
      /смена: открыта.*openedAt=123/
    );

    const ck = parsePaymentsCheckReply({ success: true, ready: true });
    assert.equal(ck.ready, true);
    assert.equal(ck.success, true);
  });

  it("treats ready without connected as success (field payments.status)", () => {
    const st = parsePaymentsStatusReply({ workday: "closed" });
    assert.equal(st.success, true);
    assert.equal(st.connected, undefined);
    assert.equal(posWorkdayLabel(st.workday), "закрыта");

    const notReady = parsePaymentsCheckReply({ ready: false });
    assert.equal(notReady.ready, false);
    assert.equal(notReady.success, true);
    assert.match(
      formatPosStatusLine("payments", {
        ready: false,
        workday: "open",
      }),
      /not-ready/
    );

    const fail = parsePaymentsCheckReply({
      error: true,
      message: "terminal-busy",
    });
    assert.equal(fail.error, true);
    assert.equal(fail.message, "terminal-busy");
  });
});

describe("parsePosActionReply / barcode payload", () => {
  it("parses commit success and builds barcode test payload", () => {
    const r = parsePosActionReply({ success: true });
    assert.equal(r.success, true);
    assert.deepEqual(posBarcodeTestPayload(), { ...POS_BARCODE_TEST });
    assert.equal(
      posBarcodeTestPayload({ barcode: "  X  ", ordernumber: "9" }).barcode,
      "X"
    );
  });

  it("falls back empty barcode and surfaces action errors", () => {
    assert.deepEqual(posBarcodeTestPayload({ barcode: "   ", ordernumber: "" }), {
      ...POS_BARCODE_TEST,
    });
    const err = parsePosActionReply({ error: true, message: "no-paper" });
    assert.equal(err.error, true);
    assert.equal(err.message, "no-paper");
    const empty = parsePosActionReply(null);
    assert.equal(empty.error, true);
  });
});

describe("CashDev password gate", () => {
  it("accepts CashDev and rejects service password", () => {
    assert.equal(CASH_DEV_GATE_ID, "cashDev");
    assert.equal(CASH_DEV_PASSWORD_PLAIN, "CashDev");
    assert.equal(verifyCashDevPassword("CashDev"), true);
    assert.equal(verifyCashDevPassword("cashdev"), false);
    assert.equal(verifyCashDevPassword(""), false);
    assert.equal(verifyCashDevPassword(SERVICE_PASSWORD_PLAIN), false);
    assert.equal(verifyServicePassword("CashDev"), false);
    assert.ok(hashCashDevPassword("CashDev").length === 64);
  });

  it("WriteGate unlocks with CashDev verify (parallel session)", async () => {
    let now = 1_000_000;
    const gate = new WriteGate({
      sessionTtlMs: 1000,
      verifyPassword: (p) => verifyCashDevPassword(p),
      now: () => now,
    });
    assert.equal(gate.isUnlocked(), false);
    assert.equal((await gate.unlock("wrong")).unlocked, false);
    assert.equal((await gate.unlock("CashDev")).unlocked, true);
    assert.equal(gate.assertCanWrite(), undefined);
    gate.lock();
    assert.equal(gate.isUnlocked(), false);
    assert.throws(() => gate.assertCanWrite(), /Write locked/);
    assert.equal((await gate.unlock("CashDev")).unlocked, true);
    now += 2000;
    assert.equal(gate.isUnlocked(), false);
  });
});

describe("parsePosHostProbeOutput", () => {
  it("marks ok when both units active and USB present", () => {
    const out = [
      "###UNITS###",
      "active",
      "active",
      "###USB###",
      "Bus 001 Device 004: ID 2912:0005 ATOL",
      "Bus 001 Device 005: ID 0e8d:2006 MediaTek",
    ].join("\n");
    const p = parsePosHostProbeOutput(out);
    assert.equal(p.printerUnit, "active");
    assert.equal(p.paymentsUnit, "active");
    assert.equal(p.usb.atol, true);
    assert.equal(p.usb.kozen, true);
    assert.equal(p.usb.niimbot, false);
    assert.equal(p.level, "ok");
  });

  it("warns when units up but no known USB", () => {
    const p = parsePosHostProbeOutput(
      "###UNITS###\nactive\nactive\n###USB###\nBus 001 Device 001: ID 1d6b:0002"
    );
    assert.equal(p.level, "warn");
    assert.equal(p.usb.atol, false);
  });

  it("warns when only one unit active (other inactive)", () => {
    const p = parsePosHostProbeOutput(
      "###UNITS###\nactive\ninactive\n###USB###\n2912:0005"
    );
    assert.equal(p.level, "warn");
    assert.equal(p.paymentsUnit, "inactive");
    assert.equal(p.usb.atol, true);
  });

  it("errors when a unit failed", () => {
    const p = parsePosHostProbeOutput(
      "###UNITS###\nfailed\nactive\n###USB###\nID 3513:0002 NIIMBOT"
    );
    assert.equal(p.level, "error");
    assert.equal(p.usb.niimbot, true);
  });

  it("errors when both units down", () => {
    const p = parsePosHostProbeOutput(
      "###UNITS###\ninactive\ninactive\n###USB###\n2912:0005"
    );
    assert.equal(p.level, "error");
  });

  it("formatPosHostProbeLog includes level", () => {
    const p = parsePosHostProbeOutput(
      "###UNITS###\nactive\nactive\n###USB###\n3513:0002"
    );
    assert.match(formatPosHostProbeLog(p), /host USB\/systemd · ok/);
  });

  it("POS_HOST_PROBE_CMD mentions markers and tools", () => {
    assert.match(POS_HOST_PROBE_CMD, /###UNITS###/);
    assert.match(POS_HOST_PROBE_CMD, /ft-printer-drv/);
    assert.match(POS_HOST_PROBE_CMD, /lsusb/);
  });
});
