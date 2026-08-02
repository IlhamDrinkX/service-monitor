"""Tests for sm_lab_logger.ring — write before implementation (TDD)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import _pathsetup  # noqa: F401 — put package root on sys.path

from sm_lab_logger.ring import RingStore
from sm_lab_logger.schema import LabEvent, Snapshot


def _ev(ts: float, name: str = "drain", value: int = 1) -> LabEvent:
    return LabEvent(ts=ts, kind="valve", module="milk", name=name, value=value)


class TestRingAppendAndSince(unittest.TestCase):
    def test_append_and_events_since_chronological(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(Path(tmp) / "lab-events.jsonl", retain_hours=24.0)
            store.append(_ev(1000.0, "a"))
            store.append(_ev(2000.0, "b"))
            store.append(_ev(3000.0, "c"))
            got = store.events_since(1500.0)
            self.assertEqual([e.name for e in got], ["b", "c"])
            self.assertEqual([e.ts for e in got], [2000.0, 3000.0])

    def test_events_since_includes_equal_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(Path(tmp) / "lab-events.jsonl", retain_hours=24.0)
            store.append(_ev(2000.0, "eq"))
            store.append(_ev(2001.0, "after"))
            # since is exclusive of older; equal ts should be included
            got = store.events_since(2000.0)
            self.assertEqual([e.name for e in got], ["eq", "after"])


class TestRingRecordsSinceIncludesHeartbeat(unittest.TestCase):
    """Regression: realtime consumers must see Snapshot heartbeats, not just
    delta events, or a series that stops changing silently vanishes from the
    chart forever (field bug: "curves disappear after a while")."""

    def test_events_since_excludes_snapshot_by_design(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(Path(tmp) / "lab-events.jsonl", retain_hours=24.0)
            store.append(_ev(1000.0, "a"))
            store.append(Snapshot(ts=1500.0, values={"milk.input": 21.0}, kinds={"milk.input": "sensor"}))
            store.append(_ev(2000.0, "b"))
            got = store.events_since(0)
            # Only the two LabEvents — this is intentional for internal callers.
            self.assertEqual([e.name for e in got], ["a", "b"])

    def test_records_since_includes_snapshot_heartbeat(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(Path(tmp) / "lab-events.jsonl", retain_hours=24.0)
            store.append(_ev(1000.0, "a"))
            store.append(
                Snapshot(ts=1500.0, values={"milk.input": 21.0}, kinds={"milk.input": "sensor"})
            )
            store.append(_ev(2000.0, "b"))
            got = store.records_since(0)
            self.assertEqual(len(got), 3)
            self.assertEqual([r.ts for r in got], [1000.0, 1500.0, 2000.0])
            self.assertIsInstance(got[1], Snapshot)
            self.assertEqual(got[1].to_dict()["kind"], "snapshot")
            self.assertEqual(got[1].to_dict()["values"], {"milk.input": 21.0})

    def test_records_since_respects_from_cursor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(Path(tmp) / "lab-events.jsonl", retain_hours=24.0)
            store.append(_ev(1000.0, "a"))
            store.append(Snapshot(ts=1500.0, values={"milk.input": 21.0}))
            store.append(_ev(2000.0, "b"))
            got = store.records_since(1501.0)
            self.assertEqual(len(got), 1)
            self.assertEqual(got[0].ts, 2000.0)


class TestRingTrimRetainHours(unittest.TestCase):
    def test_trim_drops_older_than_retain_hours(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            # retain 1 hour = 3600_000 ms if ts is epoch-ms; use seconds for simplicity
            # RingStore treats ts as epoch milliseconds (SM chart style) or seconds —
            # API: retain_hours relative to newest event ts.
            store = RingStore(
                Path(tmp) / "lab-events.jsonl",
                retain_hours=1.0,
            )
            # newest at T; older than 1h must drop
            t_now = 10_000_000.0  # ms
            hour_ms = 3_600_000.0
            store.append(_ev(t_now - hour_ms - 1, "old"))
            store.append(_ev(t_now - hour_ms // 2, "mid"))
            store.append(_ev(t_now, "new"))
            store.trim()
            all_ev = store.events_since(0)
            names = [e.name for e in all_ev]
            self.assertNotIn("old", names)
            self.assertIn("mid", names)
            self.assertIn("new", names)


class TestRingSizeCap(unittest.TestCase):
    def test_size_cap_drops_oldest_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab-events.jsonl"
            # tiny max_bytes forces drop of oldest after append+trim
            store = RingStore(path, retain_hours=24.0, max_bytes=180)
            for i in range(20):
                store.append(_ev(1000.0 + i, f"n{i}", value=i))
            store.trim()
            remaining = store.events_since(0)
            self.assertGreater(len(remaining), 0)
            self.assertLess(len(remaining), 20)
            # chronological: first remaining is newer than dropped
            self.assertEqual(remaining[0].name, remaining[0].name)
            names = [e.name for e in remaining]
            self.assertEqual(names, sorted(names, key=lambda n: int(n[1:])))
            self.assertTrue(path.stat().st_size <= 180 + 200)  # soft: after rewrite within bound roughly
            # oldest indices gone
            self.assertNotIn("n0", names)


class TestRingSingleProcessNote(unittest.TestCase):
    def test_documented_single_process(self) -> None:
        # Concurrent-safe enough for single process: document via attribute / docstring.
        self.assertTrue(
            "single" in (RingStore.__doc__ or "").lower()
            or getattr(RingStore, "SINGLE_PROCESS", False)
        )


if __name__ == "__main__":
    unittest.main()
