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
            # RingStore timestamps are epoch-ms; retain window is wall-clock.
            store = RingStore(
                Path(tmp) / "lab-events.jsonl",
                retain_hours=1.0,
            )
            t_now = 10_000_000.0  # synthetic ms (below unix-sec band)
            hour_ms = 3_600_000.0
            store.append(_ev(t_now - hour_ms - 1, "old"))
            store.append(_ev(t_now - hour_ms // 2, "mid"))
            store.append(_ev(t_now, "new"))
            store.trim(now_ms=t_now)
            all_ev = store.events_since(0)
            names = [e.name for e in all_ev]
            self.assertNotIn("old", names)
            self.assertIn("mid", names)
            self.assertIn("new", names)

    def test_trim_wall_clock_empties_when_no_recent_writes(self) -> None:
        """retain=48h + T+3d with no new samples → empty (not a prune bug)."""
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(
                Path(tmp) / "lab-events.jsonl",
                retain_hours=48.0,
            )
            t0 = 1_720_000_000_000.0  # real-looking epoch ms
            store.append(_ev(t0, "a"))
            store.append(_ev(t0 + 60_000, "b"))
            three_days_later = t0 + 3 * 24 * 3_600_000.0
            store.trim(now_ms=three_days_later)
            self.assertEqual(store.events_since(0), [])
            self.assertEqual(Path(tmp, "lab-events.jsonl").read_text(encoding="utf-8"), "")

    def test_trim_keeps_last_48h_window(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(
                Path(tmp) / "lab-events.jsonl",
                retain_hours=48.0,
            )
            t_now = 1_720_000_000_000.0
            day_ms = 24 * 3_600_000.0
            store.append(_ev(t_now - 3 * day_ms, "old3d"))
            store.append(_ev(t_now - 1 * day_ms, "mid1d"))
            store.append(_ev(t_now - 1_000, "fresh"))
            store.trim(now_ms=t_now)
            names = [e.name for e in store.events_since(0)]
            self.assertNotIn("old3d", names)
            self.assertIn("mid1d", names)
            self.assertIn("fresh", names)

    def test_trim_normalizes_unix_seconds_so_mixed_units_do_not_wipe(self) -> None:
        """One ms heartbeat must not make every seconds-row look ancient."""
        with tempfile.TemporaryDirectory() as tmp:
            store = RingStore(
                Path(tmp) / "lab-events.jsonl",
                retain_hours=1.0,
            )
            # Seconds-scale samples around "now", plus one already-ms twin.
            sec_now = 1_720_000_000.0
            store.append(_ev(sec_now - 100, "sec_oldish"))
            store.append(_ev(sec_now, "sec_new"))
            store.append(_ev(sec_now * 1000.0, "ms_new"))
            store.trim(now_ms=sec_now * 1000.0)
            names = [e.name for e in store.events_since(0)]
            self.assertIn("sec_new", names)
            self.assertIn("ms_new", names)


class TestRingSizeCap(unittest.TestCase):
    def test_size_cap_drops_oldest_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab-events.jsonl"
            # tiny max_bytes forces drop of oldest after append+trim
            store = RingStore(path, retain_hours=24.0, max_bytes=180)
            for i in range(20):
                store.append(_ev(1000.0 + i, f"n{i}", value=i))
            store.trim(now_ms=2000.0)
            remaining = store.events_since(0)
            self.assertGreater(len(remaining), 0)
            self.assertLess(len(remaining), 20)
            names = [e.name for e in remaining]
            self.assertEqual(names, sorted(names, key=lambda n: int(n[1:])))
            self.assertTrue(path.stat().st_size <= 180 + 200)
            self.assertNotIn("n0", names)

    def test_size_cap_never_deletes_last_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab-events.jsonl"
            store = RingStore(path, retain_hours=24.0, max_bytes=1)
            store.append(_ev(1000.0, "only", value=1))
            store.trim(now_ms=1000.0)
            remaining = store.events_since(0)
            self.assertEqual(len(remaining), 1)
            self.assertEqual(remaining[0].name, "only")
            self.assertGreater(path.stat().st_size, 0)


class TestRingSingleProcessNote(unittest.TestCase):
    def test_documented_single_process(self) -> None:
        # Concurrent-safe enough for single process: document via attribute / docstring.
        self.assertTrue(
            "single" in (RingStore.__doc__ or "").lower()
            or getattr(RingStore, "SINGLE_PROCESS", False)
        )


if __name__ == "__main__":
    unittest.main()
