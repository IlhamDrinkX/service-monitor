"""Tests for localhost HTTP API — /lab/health, /lab/snapshot, /lab/events."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import _pathsetup  # noqa: F401

from sm_lab_logger.http_api import LabHttpServer
from sm_lab_logger.ring import RingStore
from sm_lab_logger.schema import LabEvent, Snapshot


class _State:
    def __init__(self) -> None:
        self.ok = True
        self.last_sample_age_ms = 12.0
        self.lock_held = True
        self.topology_warnings = ["role mismatch: coffee at 192.168.1.44"]
        self.snapshot = Snapshot(ts=1000.0, values={"milk.drain": 1})
        self.disk_bytes = 42


class TestLabHttpApi(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.ring = RingStore(Path(self._tmpdir.name) / "lab-events.jsonl")
        self.ring.append(
            LabEvent(ts=1000.0, kind="valve", module="milk", name="drain", value=1)
        )
        self.ring.append(
            LabEvent(ts=2000.0, kind="valve", module="milk", name="drain", value=0)
        )
        self.state = _State()
        self.server = LabHttpServer(
            host="127.0.0.1",
            port=0,  # ephemeral
            health_fn=self._health,
            snapshot_fn=self._snapshot,
            events_fn=self._events,
        )
        self.server.start()
        self.base = f"http://127.0.0.1:{self.server.port}"

    def tearDown(self) -> None:
        self.server.stop()
        self._tmpdir.cleanup()

    def _health(self) -> dict:
        return {
            "ok": self.state.ok,
            "last_sample_age_ms": self.state.last_sample_age_ms,
            "lock_held": self.state.lock_held,
            "topology_warnings": list(self.state.topology_warnings),
            "disk_bytes": self.state.disk_bytes,
        }

    def _snapshot(self) -> dict:
        return self.state.snapshot.to_dict()

    def _events(self, from_ts: float | None, to_ts: float | None) -> list:
        evs = self.ring.events_since(from_ts if from_ts is not None else 0.0)
        if to_ts is not None:
            evs = [e for e in evs if e.ts <= to_ts]
        return [e.to_dict() for e in evs]

    def _get(self, path: str) -> tuple[int, dict]:
        with urllib.request.urlopen(self.base + path, timeout=2) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body

    def test_binds_localhost_only(self) -> None:
        self.assertEqual(self.server.host, "127.0.0.1")
        self.assertGreater(self.server.port, 0)

    def test_health(self) -> None:
        status, body = self._get("/lab/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["last_sample_age_ms"], 12.0)
        self.assertTrue(body["lock_held"])
        self.assertEqual(len(body["topology_warnings"]), 1)

    def test_snapshot(self) -> None:
        status, body = self._get("/lab/snapshot")
        self.assertEqual(status, 200)
        self.assertEqual(body["v"], 1)
        self.assertEqual(body["kind"], "snapshot")
        self.assertEqual(body["values"]["milk.drain"], 1)

    def test_events_range(self) -> None:
        status, body = self._get("/lab/events?from=1500&to=2500")
        self.assertEqual(status, 200)
        self.assertIsInstance(body.get("events"), list)
        self.assertEqual(len(body["events"]), 1)
        self.assertEqual(body["events"][0]["value"], 0)

    def test_events_all(self) -> None:
        status, body = self._get("/lab/events")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["events"]), 2)

    def test_unknown_path_404(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.base + "/nope", timeout=2)
        self.assertEqual(ctx.exception.code, 404)


class TestLabHttpRejectsNonLocalhost(unittest.TestCase):
    def test_constructor_rejects_public_bind(self) -> None:
        with self.assertRaises(ValueError):
            LabHttpServer(
                host="0.0.0.0",
                port=8765,
                health_fn=lambda: {},
                snapshot_fn=lambda: {},
                events_fn=lambda _a, _b: [],
            )


if __name__ == "__main__":
    unittest.main()
