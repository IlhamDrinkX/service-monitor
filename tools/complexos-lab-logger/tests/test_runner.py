"""Tests for soft-fail tick runner (FakeSource → DeltaEngine → ring)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import _pathsetup  # noqa: F401

from sm_lab_logger.delta import DeltaEngine
from sm_lab_logger.poller import FakeSource
from sm_lab_logger.ring import RingStore
from sm_lab_logger.runner import run_tick
from sm_lab_logger.schema import LabEvent, Snapshot
from sm_lab_logger.watchdog import Watchdog


class _BoomSource:
    def poll(self):
        raise ConnectionError("nats down")


class TestRunTick(unittest.TestCase):
    def test_fake_source_writes_deltas_to_ring(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ring = RingStore(Path(tmp) / "lab-events.jsonl")
            src = FakeSource(
                frames=[
                    [
                        LabEvent(ts=1000.0, kind="valve", module="milk", name="drain", value=1),
                    ]
                ]
            )
            eng = DeltaEngine(heartbeat_sec=99.0)
            wd = Watchdog(max_failures=3, base_interval_ms=200)
            written = run_tick(src, eng, ring, wd, now_ms=1000.0)
            self.assertEqual(len(written), 1)
            self.assertIsInstance(written[0], LabEvent)
            got = ring.events_since(0)
            self.assertEqual(len(got), 1)
            self.assertEqual(got[0].series_key(), "milk.drain")
            self.assertFalse(wd.in_backoff)

    def test_soft_fail_on_source_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ring = RingStore(Path(tmp) / "lab-events.jsonl")
            eng = DeltaEngine(heartbeat_sec=99.0)
            wd = Watchdog(max_failures=2, base_interval_ms=200, max_interval_ms=4000)
            out = run_tick(_BoomSource(), eng, ring, wd, now_ms=1000.0)
            self.assertEqual(out, [])
            self.assertEqual(ring.events_since(0), [])
            self.assertEqual(wd.consecutive_failures, 1)

    def test_heartbeat_snapshot_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ring = RingStore(Path(tmp) / "lab-events.jsonl")
            src = FakeSource(
                frames=[
                    [LabEvent(ts=1000.0, kind="valve", module="milk", name="drain", value=1)],
                    [LabEvent(ts=4000.0, kind="valve", module="milk", name="drain", value=1)],
                ]
            )
            eng = DeltaEngine(heartbeat_sec=2.0, heartbeat_on_first=False)
            wd = Watchdog(max_failures=5, base_interval_ms=200)
            run_tick(src, eng, ring, wd, now_ms=1000.0)
            written = run_tick(src, eng, ring, wd, now_ms=4000.0)
            snaps = [r for r in written if isinstance(r, Snapshot)]
            self.assertEqual(len(snaps), 1)


if __name__ == "__main__":
    unittest.main()
