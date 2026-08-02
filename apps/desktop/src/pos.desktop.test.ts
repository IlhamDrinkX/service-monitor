/**
 * Pos / CashDev UI helpers + help wiring (без Electron).
 * Запуск: npm test -w @service-monitor/desktop
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTROL_HELPS,
  PAYMENTS_SUBJECTS,
  PRINTER_SUBJECTS,
  parsePaymentsCheckReply,
  parsePrinterStatusReply,
} from "@service-monitor/core";
import {
  CASH_DEV_GATE_ID,
  verifyCashDevPassword,
} from "@service-monitor/core/security/cash-dev-password";
import {
  CASH_DEV_SESSION_KEY,
  CASH_DEV_VERIFY_IPC,
  fmtBool,
  fmtReadyLine,
  isCashDevSessionFlag,
  posStatusCardClass,
} from "./lib/pos-ui.ts";

describe("desktop / pos-ui helpers", () => {
  it("formats bool and ready lines like PosPage cards", () => {
    assert.equal(fmtBool(true), "да");
    assert.equal(fmtBool(false), "нет");
    assert.equal(fmtBool(undefined), "—");
    assert.equal(fmtReadyLine(true), "ready (check)");
    assert.equal(fmtReadyLine(false), "not-ready (check)");
    assert.match(fmtReadyLine(undefined), /жмите check/);
  });

  it("picks status card CSS class by priority stub>error>warn>ok", () => {
    assert.equal(posStatusCardClass({ stub: true, ok: true }), "pos-status-card stub");
    assert.equal(
      posStatusCardClass({ error: true, warn: true }),
      "pos-status-card error"
    );
    assert.equal(posStatusCardClass({ warn: true }), "pos-status-card warn");
    assert.equal(posStatusCardClass({ ok: true }), "pos-status-card ok");
    assert.equal(posStatusCardClass({}), "pos-status-card");
  });

  it("CashDev session flag + IPC channel constants", () => {
    assert.equal(CASH_DEV_SESSION_KEY, "sm.cashDevUnlocked");
    assert.equal(CASH_DEV_VERIFY_IPC, "profiles:verifyCashDevPassword");
    assert.equal(CASH_DEV_GATE_ID, "cashDev");
    assert.equal(isCashDevSessionFlag("1"), true);
    assert.equal(isCashDevSessionFlag("0"), false);
    assert.equal(isCashDevSessionFlag(null), false);
    assert.equal(verifyCashDevPassword("CashDev"), true);
  });
});

describe("desktop / pos help + core parsers still wired", () => {
  it("exposes all PosPage help ids", () => {
    const required = [
      "nav.pos",
      "pos.unlock",
      "pos.printerMuster",
      "pos.printerStatus",
      "pos.paymentsMuster",
      "pos.paymentsStatus",
      "pos.paymentsCheck",
      "pos.healthRefresh",
      "pos.barcodeTest",
      "pos.printerCommit",
      "pos.paymentsCommit",
      "pos.fnView",
      "pos.ofdSettings",
      "pos.factoryWipe",
      "pos.charge",
      "modules.sirupNats",
    ];
    for (const id of required) {
      assert.ok(CONTROL_HELPS[id], id);
      assert.ok(CONTROL_HELPS[id]!.body.length > 20, id);
    }
  });

  it("uses real printer/payments subjects for kiosk2", () => {
    assert.equal(PRINTER_SUBJECTS.status("kiosk2"), "complexos.printer.status.kiosk2");
    assert.equal(PAYMENTS_SUBJECTS.check("kiosk2"), "complexos.payments.check.kiosk2");
    const printer = parsePrinterStatusReply({ connected: true, workday: "open" });
    assert.equal(printer.connected, true);
    const check = parsePaymentsCheckReply({ ready: true });
    assert.equal(check.ready, true);
  });
});
