"""Tests for sm_lab_logger.schema — write before implementation (TDD)."""

from __future__ import annotations

import json
import unittest

import _pathsetup  # noqa: F401 — put package root on sys.path

from sm_lab_logger.schema import LabEvent, Snapshot, series_key


class TestSeriesKey(unittest.TestCase):
    def test_milk_drain(self) -> None:
        self.assertEqual(series_key("milk", "drain"), "milk.drain")

    def test_sm_chart_compatible_names(self) -> None:
        # Same naming as packages/core seriesKey(module, name)
        self.assertEqual(series_key("coffee", "pump"), "coffee.pump")
        self.assertEqual(series_key("water", "input"), "water.input")
        self.assertEqual(series_key("milk", "heater1_pwm"), "milk.heater1_pwm")


class TestLabEventRoundtrip(unittest.TestCase):
    def test_to_json_includes_required_fields(self) -> None:
        ev = LabEvent(
            ts=1_700_000_000_000.0,
            kind="valve",
            module="milk",
            name="drain",
            value=1,
        )
        raw = ev.to_json()
        data = json.loads(raw)
        self.assertEqual(data["v"], 1)
        self.assertEqual(data["ts"], 1_700_000_000_000.0)
        self.assertEqual(data["kind"], "valve")
        self.assertEqual(data["module"], "milk")
        self.assertEqual(data["name"], "drain")
        self.assertEqual(data["value"], 1)

    def test_from_json_roundtrip(self) -> None:
        ev = LabEvent(
            ts=1_700_000_000_100.0,
            kind="sensor",
            module="coffee",
            name="pumpCurrent",
            value=2.5,
        )
        restored = LabEvent.from_json(ev.to_json())
        self.assertEqual(restored.v, 1)
        self.assertEqual(restored.ts, ev.ts)
        self.assertEqual(restored.kind, ev.kind)
        self.assertEqual(restored.module, ev.module)
        self.assertEqual(restored.name, ev.name)
        self.assertEqual(restored.value, ev.value)
        self.assertEqual(restored.series_key(), "coffee.pumpCurrent")


class TestSnapshotRoundtrip(unittest.TestCase):
    def test_snapshot_json_has_v_and_series(self) -> None:
        snap = Snapshot(
            ts=1_700_000_000_200.0,
            values={
                "milk.drain": 0,
                "coffee.pump": 1,
            },
        )
        data = json.loads(snap.to_json())
        self.assertEqual(data["v"], 1)
        self.assertEqual(data["ts"], 1_700_000_000_200.0)
        self.assertEqual(data["kind"], "snapshot")
        self.assertEqual(data["values"]["milk.drain"], 0)
        restored = Snapshot.from_json(snap.to_json())
        self.assertEqual(restored.values["coffee.pump"], 1)


if __name__ == "__main__":
    unittest.main()
