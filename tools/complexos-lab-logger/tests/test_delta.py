"""Tests for DeltaEngine — changes only + periodic heartbeat snapshot."""

from __future__ import annotations

import unittest

import _pathsetup  # noqa: F401

from sm_lab_logger.delta import DeltaEngine
from sm_lab_logger.schema import LabEvent, Snapshot


def _ev(ts: float, module: str, name: str, value, kind: str = "valve") -> LabEvent:
    return LabEvent(ts=ts, kind=kind, module=module, name=name, value=value)


class TestDeltaEngineChanges(unittest.TestCase):
    def test_first_samples_emit_as_deltas(self) -> None:
        eng = DeltaEngine(heartbeat_sec=10.0)
        out = eng.process(
            [_ev(1000.0, "milk", "drain", 1), _ev(1000.0, "coffee", "pump", 0)],
            now_ms=1000.0,
        )
        events = [r for r in out if isinstance(r, LabEvent)]
        self.assertEqual(len(events), 2)
        keys = {e.series_key() for e in events}
        self.assertEqual(keys, {"milk.drain", "coffee.pump"})

    def test_unchanged_value_emits_nothing(self) -> None:
        eng = DeltaEngine(heartbeat_sec=10.0)
        eng.process([_ev(1000.0, "milk", "drain", 1)], now_ms=1000.0)
        out = eng.process([_ev(1100.0, "milk", "drain", 1)], now_ms=1100.0)
        events = [r for r in out if isinstance(r, LabEvent)]
        self.assertEqual(events, [])

    def test_changed_value_emits_delta(self) -> None:
        eng = DeltaEngine(heartbeat_sec=10.0)
        eng.process([_ev(1000.0, "milk", "drain", 1)], now_ms=1000.0)
        out = eng.process([_ev(1200.0, "milk", "drain", 0)], now_ms=1200.0)
        events = [r for r in out if isinstance(r, LabEvent)]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].value, 0)
        self.assertEqual(events[0].v, 1)


class TestDeltaEngineHeartbeat(unittest.TestCase):
    def test_heartbeat_full_snapshot_after_interval(self) -> None:
        eng = DeltaEngine(heartbeat_sec=2.0)
        eng.process(
            [_ev(1000.0, "milk", "drain", 1), _ev(1000.0, "coffee", "pump", 1)],
            now_ms=1000.0,
        )
        # Before heartbeat window — no snapshot
        mid = eng.process([_ev(1500.0, "milk", "drain", 1)], now_ms=1500.0)
        self.assertFalse(any(isinstance(r, Snapshot) for r in mid))

        # After 2s (2000 ms) from last heartbeat
        late = eng.process([_ev(3100.0, "milk", "drain", 1)], now_ms=3100.0)
        snaps = [r for r in late if isinstance(r, Snapshot)]
        self.assertEqual(len(snaps), 1)
        self.assertEqual(snaps[0].v, 1)
        self.assertEqual(snaps[0].kind, "snapshot")
        self.assertEqual(snaps[0].values["milk.drain"], 1)
        self.assertEqual(snaps[0].values["coffee.pump"], 1)

    def test_force_heartbeat_on_first_tick_optional(self) -> None:
        eng = DeltaEngine(heartbeat_sec=2.0, heartbeat_on_first=True)
        out = eng.process([_ev(1000.0, "milk", "drain", 1)], now_ms=1000.0)
        snaps = [r for r in out if isinstance(r, Snapshot)]
        self.assertEqual(len(snaps), 1)
        self.assertEqual(snaps[0].values["milk.drain"], 1)

    def test_state_dict_tracks_series_keys(self) -> None:
        eng = DeltaEngine(heartbeat_sec=99.0)
        eng.process([_ev(1.0, "water", "input", 1)], now_ms=1.0)
        self.assertEqual(eng.state()["water.input"], 1)


if __name__ == "__main__":
    unittest.main()
