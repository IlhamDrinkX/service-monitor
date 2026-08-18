"""Tests for sm_host_ping — change-only, retention, MAC resolve, log format."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import List
from unittest import mock

import _pathsetup  # noqa: F401

from sm_host_ping.ping import (
    DEFAULT_TARGETS,
    AvailabilityTracker,
    HostPinger,
    HostTarget,
    PingRing,
    build_targets,
    collect_wan_traces,
    free_disk_bytes,
    run_ping_tick,
)
from sm_host_ping.resolve import normalize_mac, resolve_mac_to_ip
from sm_host_ping.schema import (
    STATUS_OFFLINE,
    STATUS_ONLINE,
    HostEvent,
    Snapshot,
    coerce_reachable_up,
    format_local_at,
)
from sm_host_ping.config import ConfigError, load_config


class TestTracker(unittest.TestCase):
    def test_change_only(self) -> None:
        tr = AvailabilityTracker(heartbeat_hours=0)
        first = tr.process({"tablet": True, "milk": True}, now_ms=1000.0)
        self.assertEqual(len(first), 2)
        self.assertEqual(tr.process({"tablet": True, "milk": True}, now_ms=2000.0), [])
        down = tr.process({"tablet": False, "milk": True}, now_ms=3000.0)
        self.assertEqual(len(down), 1)
        assert isinstance(down[0], HostEvent)
        self.assertEqual(down[0].value, STATUS_OFFLINE)
        self.assertEqual(down[0].module, "tablet")

    def test_no_spam_identical_online(self) -> None:
        tr = AvailabilityTracker(heartbeat_hours=0)
        roles = {
            "complexos": True,
            "milk": True,
            "coffee": True,
            "water": True,
            "router": True,
            "tablet": False,
        }
        first = tr.process(roles, now_ms=1_000.0)
        self.assertEqual(len(first), 6)
        for i in range(2, 20):
            self.assertEqual(tr.process(roles, now_ms=float(i * 1000)), [])

    def test_seed_skips_identical_after_restart(self) -> None:
        tr = AvailabilityTracker(heartbeat_hours=0)
        seed = [
            HostEvent(
                ts=100.0,
                kind="host",
                module="milk",
                name="reachable",
                value=STATUS_ONLINE,
            ),
            HostEvent(
                ts=200.0,
                kind="host",
                module="tablet",
                name="reachable",
                value=0,  # legacy numeric
            ),
        ]
        tr.seed_from_records(seed)
        self.assertEqual(
            tr.process({"milk": True, "tablet": False}, now_ms=300.0), []
        )
        flip = tr.process({"milk": False, "tablet": False}, now_ms=400.0)
        self.assertEqual(len(flip), 1)
        assert isinstance(flip[0], HostEvent)
        self.assertEqual(flip[0].module, "milk")
        self.assertEqual(flip[0].value, STATUS_OFFLINE)

    def test_heartbeat(self) -> None:
        tr = AvailabilityTracker(snapshot_minutes=5.0)
        tr.process({"milk": True}, now_ms=0.0)
        self.assertEqual(tr.process({"milk": True}, now_ms=299_999.0), [])
        hb = tr.process({"milk": True}, now_ms=300_000.0)
        self.assertEqual(len(hb), 1)
        self.assertIsInstance(hb[0], Snapshot)
        assert isinstance(hb[0], Snapshot)
        self.assertEqual(hb[0].values["milk.reachable"], STATUS_ONLINE)
        self.assertIn("at", hb[0].to_dict())

    def test_snapshot_default_is_5min(self) -> None:
        from sm_host_ping.config import PingConfig
        self.assertEqual(PingConfig().snapshot_minutes, 5.0)

    def test_loop_writes_snapshot_after_5min_no_changes(self) -> None:
        """When hosts are stable, a Snapshot must appear after 5 min."""
        tr = AvailabilityTracker(snapshot_minutes=5.0)
        tr.process({"milk": True, "router": True}, now_ms=0.0)
        five_min = 300_000.0
        for i in range(1, 10):
            result = tr.process({"milk": True, "router": True}, now_ms=float(i * 30_000))
            self.assertEqual(result, [], f"unexpected write at tick {i}")
        hb = tr.process({"milk": True, "router": True}, now_ms=five_min)
        self.assertEqual(len(hb), 1)
        self.assertIsInstance(hb[0], Snapshot)


class TestSchemaFormat(unittest.TestCase):
    def test_event_json_has_at_and_ru_status(self) -> None:
        # Fixed epoch: 2026-08-11 10:17:35 local depends on TZ — check shape only.
        ev = HostEvent(
            ts=1_786_375_055_000.0,
            kind="host",
            module="tablet",
            name="reachable",
            value=STATUS_OFFLINE,
            at="2026-08-11T10:17:35",
        )
        d = ev.to_dict()
        self.assertEqual(d["at"], "2026-08-11T10:17:35")
        self.assertEqual(d["value"], "оффлайн")
        self.assertEqual(d["ts"], 1_786_375_055_000.0)
        line = json.loads(ev.to_json())
        self.assertEqual(line["module"], "tablet")
        self.assertEqual(line["value"], STATUS_OFFLINE)

    def test_format_local_at_shape(self) -> None:
        s = format_local_at(1_786_375_055_000.0)
        self.assertRegex(s, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")

    def test_coerce(self) -> None:
        self.assertEqual(coerce_reachable_up(1), True)
        self.assertEqual(coerce_reachable_up(0), False)
        self.assertEqual(coerce_reachable_up("онлайн"), True)
        self.assertEqual(coerce_reachable_up("оффлайн"), False)
        self.assertEqual(coerce_reachable_up("online"), True)
        self.assertIsNone(coerce_reachable_up("maybe"))


class TestRing(unittest.TestCase):
    def test_retain_14d(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "host-ping.jsonl"
            ring = PingRing(path, retain_days=14.0)
            day = 86_400_000.0
            now = 20 * day
            ring.append(
                HostEvent(
                    ts=now - 16 * day,
                    kind="host",
                    module="milk",
                    name="reachable",
                    value=STATUS_OFFLINE,
                )
            )
            ring.append(
                HostEvent(
                    ts=now - 10 * day,
                    kind="host",
                    module="milk",
                    name="reachable",
                    value=STATUS_ONLINE,
                )
            )
            ring.trim(now_ms=now)
            kept = ring.events_since(0)
            self.assertEqual(len(kept), 1)
            self.assertEqual(kept[0].value, STATUS_ONLINE)

    def test_reject_below_14(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                PingRing(Path(tmp) / "x.jsonl", retain_days=7.0)

    def test_rotate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "host-ping.jsonl"
            ring = PingRing(path, retain_days=14.0, max_bytes=120, min_free_bytes=1000)
            for i in range(20):
                ring.append(
                    HostEvent(
                        ts=float(1000 + i),
                        kind="host",
                        module="milk",
                        name="reachable",
                        value=STATUS_ONLINE if i % 2 else STATUS_OFFLINE,
                    )
                )
            with mock.patch("sm_host_ping.ping.free_disk_bytes", return_value=50_000_000):
                archived = ring.maybe_rotate(now_ms=2000.0)
            self.assertIsNotNone(archived)
            assert archived is not None
            self.assertTrue(archived.name.startswith("host-ping-"))
            self.assertEqual(path.stat().st_size, 0)


class TestPingerAndTargets(unittest.TestCase):
    def test_injected_probe(self) -> None:
        calls: List[HostTarget] = []

        def probe(t: HostTarget) -> bool:
            calls.append(t)
            return t.role == "milk"

        pinger = HostPinger(probe_fn=probe)
        got = pinger.probe_all(
            [
                HostTarget(role="milk", ip="192.168.1.44", port=8000),
                HostTarget(role="coffee", ip="192.168.1.45", port=8000),
            ]
        )
        self.assertEqual(got, {"milk": True, "coffee": False})
        self.assertEqual(len(calls), 2)

    def test_tablet_requires_ip_or_mac(self) -> None:
        targets, warnings = build_targets({})
        self.assertNotIn("tablet", {t.role for t in targets})
        self.assertTrue(any("tablet" in w.lower() for w in warnings))

        with_ip, w2 = build_targets({}, tablet_ip="192.168.1.28")
        self.assertIn("tablet", {t.role for t in with_ip})
        self.assertFalse(any("tablet" in w.lower() for w in w2))

        with_mac, _ = build_targets({}, tablet_mac="aa:bb:cc:dd:ee:ff")
        tab = [t for t in with_mac if t.role == "tablet"][0]
        self.assertEqual(tab.mac, "aa:bb:cc:dd:ee:ff")
        self.assertIsNone(tab.ip)

    def test_default_ips(self) -> None:
        by = {t.role: t for t in DEFAULT_TARGETS}
        self.assertEqual(by["complexos"].ip, "192.168.1.43")
        self.assertEqual(by["router"].ip, "192.168.1.1")
        self.assertEqual(by["erp"].ip, "erp.fibbee.com")
        self.assertEqual(by["fibbee"].ip, "91.206.15.66")
        self.assertEqual(by["dns"].ip, "8.8.8.8")
        self.assertIsNone(by["erp"].port)

    def test_build_targets_includes_wan(self) -> None:
        targets, _ = build_targets({})
        roles = {t.role for t in targets}
        self.assertIn("erp", roles)
        self.assertIn("fibbee", roles)
        self.assertIn("dns", roles)


class TestResolve(unittest.TestCase):
    def test_normalize_mac(self) -> None:
        self.assertEqual(normalize_mac("AA-BB-CC-DD-EE-FF"), "aa:bb:cc:dd:ee:ff")
        self.assertEqual(normalize_mac("aabbccddeeff"), "aa:bb:cc:dd:ee:ff")
        self.assertIsNone(normalize_mac("nope"))

    def test_resolve_from_neigh_text(self) -> None:
        fake = "192.168.1.28 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE\n"
        with mock.patch("sm_host_ping.resolve._run_text", side_effect=[fake, "", ""]):
            self.assertEqual(resolve_mac_to_ip("aa:bb:cc:dd:ee:ff"), "192.168.1.28")


class TestRingSafeTrim(unittest.TestCase):
    def test_trim_does_not_rewrite_when_nothing_dropped(self) -> None:
        """trim() must not touch the file if all records are within retention window."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "host-ping.jsonl"
            ring = PingRing(path, retain_days=14.0)
            now_ms = 1_000_000.0
            ring.append(
                HostEvent(ts=now_ms, kind="host", module="milk", name="reachable", value=STATUS_ONLINE)
            )
            mtime_before = path.stat().st_mtime_ns
            ring.trim(now_ms=now_ms)
            mtime_after = path.stat().st_mtime_ns
            self.assertEqual(mtime_before, mtime_after, "trim() must not rewrite file when no records dropped")

    def test_trim_drops_old_and_keeps_recent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "host-ping.jsonl"
            ring = PingRing(path, retain_days=14.0)
            day = 86_400_000.0
            now = 20 * day
            ring.append(HostEvent(ts=now - 16 * day, kind="host", module="milk", name="reachable", value=STATUS_OFFLINE))
            ring.append(HostEvent(ts=now - 10 * day, kind="host", module="milk", name="reachable", value=STATUS_ONLINE))
            ring.trim(now_ms=now)
            kept = ring.events_since(0)
            self.assertEqual(len(kept), 1)
            self.assertEqual(kept[0].value, STATUS_ONLINE)


class TestTickSoft(unittest.TestCase):
    def test_writes_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ring = PingRing(Path(tmp) / "host-ping.jsonl", retain_days=14.0)
            tracker = AvailabilityTracker(heartbeat_hours=0)
            pinger = HostPinger(probe_fn=lambda t: t.role != "router")
            targets = [
                HostTarget(role="milk", ip="192.168.1.44", port=8000),
                HostTarget(role="router", ip="192.168.1.1", port=80),
            ]
            written = run_ping_tick(pinger, tracker, ring, targets, now_ms=5000.0)
            self.assertEqual(len(written), 2)
            self.assertEqual(
                run_ping_tick(pinger, tracker, ring, targets, now_ms=6000.0), []
            )
            path_lines = ring.path.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(path_lines), 2)
            row = json.loads(path_lines[0])
            self.assertIn(row["value"], (STATUS_ONLINE, STATUS_OFFLINE))
            self.assertRegex(row["at"], r"^\d{4}-\d{2}-\d{2}T")


class TestConfig(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = load_config(argv=[])
        self.assertEqual(cfg.ping_interval_sec, 30.0)
        self.assertEqual(cfg.retain_days, 14.0)
        self.assertEqual(cfg.snapshot_minutes, 5.0)
        self.assertEqual(cfg.expected["erp"], "erp.fibbee.com")
        self.assertEqual(cfg.expected["fibbee"], "91.206.15.66")
        self.assertEqual(cfg.expected["dns"], "8.8.8.8")

    def test_reject_retain(self) -> None:
        with self.assertRaises(ConfigError):
            load_config(argv=["--retain-days", "7"])

    def test_tablet_from_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                '{"tablet":{"ip":"192.168.1.9","mac":"aa:bb:cc:dd:ee:01"},'
                '"ping_interval_sec":30,"retain_days":14}',
                encoding="utf-8",
            )
            cfg = load_config(argv=["--config", str(path)])
            self.assertEqual(cfg.tablet_ip, "192.168.1.9")
            self.assertEqual(cfg.tablet_mac, "aa:bb:cc:dd:ee:01")


class TestFreeDisk(unittest.TestCase):
    def test_non_neg(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertGreaterEqual(free_disk_bytes(Path(tmp)), 0)


class TestTabletProbeMethods(unittest.TestCase):
    """Issue 1: tablet probe must use ICMP first, then TCP fallback ports."""

    def test_icmp_first_succeeds(self) -> None:
        """If ICMP responds, tablet is online — no TCP needed."""
        from sm_host_ping.ping import tablet_probe, icmp_reachable, tcp_reachable

        with mock.patch("sm_host_ping.ping.icmp_reachable", return_value=True) as m_icmp, \
             mock.patch("sm_host_ping.ping.tcp_reachable", return_value=False) as m_tcp:
            result = tablet_probe("192.168.1.33", timeout_sec=0.5)
        self.assertTrue(result)
        m_icmp.assert_called_once_with("192.168.1.33", timeout_sec=0.5)
        m_tcp.assert_not_called()

    def test_icmp_fails_tcp_fallback_adb(self) -> None:
        """If ICMP fails but ADB :5555 responds, tablet is online."""
        from sm_host_ping.ping import tablet_probe, _TABLET_FALLBACK_PORTS

        def fake_tcp(ip: str, port: int, timeout_sec: float = 0.5) -> bool:
            return port == 5555

        with mock.patch("sm_host_ping.ping.icmp_reachable", return_value=False), \
             mock.patch("sm_host_ping.ping.tcp_reachable", side_effect=fake_tcp):
            result = tablet_probe("192.168.1.33", timeout_sec=0.5)
        self.assertTrue(result)

    def test_all_fail_tablet_offline(self) -> None:
        """If ICMP and all TCP ports fail, tablet is offline."""
        from sm_host_ping.ping import tablet_probe

        with mock.patch("sm_host_ping.ping.icmp_reachable", return_value=False), \
             mock.patch("sm_host_ping.ping.tcp_reachable", return_value=False):
            result = tablet_probe("192.168.1.33", timeout_sec=0.5)
        self.assertFalse(result)

    def test_default_probe_tablet_uses_icmp_first(self) -> None:
        """default_probe for tablet role must call tablet_probe, not TCP :80."""
        from sm_host_ping.ping import default_probe

        with mock.patch("sm_host_ping.ping.tablet_probe", return_value=True) as m, \
             mock.patch("sm_host_ping.ping.tcp_reachable") as m_tcp:
            result = default_probe(
                HostTarget(role="tablet", ip="192.168.1.33", port=80), timeout_sec=0.5
            )
        self.assertTrue(result)
        m.assert_called_once_with("192.168.1.33", timeout_sec=0.5)
        m_tcp.assert_not_called()

    def test_fallback_ports_include_adb_8080_443(self) -> None:
        from sm_host_ping.ping import _TABLET_FALLBACK_PORTS
        self.assertIn(5555, _TABLET_FALLBACK_PORTS)
        self.assertIn(8080, _TABLET_FALLBACK_PORTS)
        self.assertIn(443, _TABLET_FALLBACK_PORTS)

    def test_subprocess_icmp_called_for_tablet(self) -> None:
        """Verify subprocess.run is invoked for ICMP (not socket.create_connection)."""
        from sm_host_ping.ping import icmp_reachable

        with mock.patch("subprocess.run") as m_run:
            m_run.return_value = mock.Mock(returncode=0)
            result = icmp_reachable("192.168.1.33", timeout_sec=1.0)
        self.assertTrue(result)
        m_run.assert_called_once()
        cmd = m_run.call_args[0][0]
        self.assertIn("ping", cmd[0])
        self.assertIn("192.168.1.33", cmd)


class TestInstallConfigWithTargets(unittest.TestCase):
    """Issue 2: install bundle must always include tablet IP/MAC in config.json."""

    def test_config_json_includes_tablet_ip_and_mac(self) -> None:
        """buildHostPingConfigJson must embed tablet fields when provided."""
        import sys
        import os

        # Locate packages/core dist or source for the TS-generated config builder.
        # We test the Python side: load_config must read tablet from config.json.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            cfg_dict = {
                "ping_interval_sec": 30,
                "retain_days": 14,
                "snapshot_minutes": 5,
                "data_dir": str(tmp) + "/data",
                "tablet": {"ip": "192.168.1.33", "mac": "aa:bb:cc:dd:ee:33"},
                "expected": {
                    "complexos": "192.168.1.43",
                    "milk": "192.168.1.44",
                    "coffee": "192.168.1.45",
                    "water": "192.168.1.46",
                    "router": "192.168.1.1",
                },
            }
            path.write_text(json.dumps(cfg_dict), encoding="utf-8")
            cfg = load_config(argv=["--config", str(path)])

        self.assertEqual(cfg.tablet_ip, "192.168.1.33")
        self.assertEqual(cfg.tablet_mac, "aa:bb:cc:dd:ee:33")

    def test_unit_starts_with_tablet_config(self) -> None:
        """main.py must include tablet in probe targets when config has tablet."""
        with tempfile.TemporaryDirectory() as tmp:
            ring = PingRing(Path(tmp) / "host-ping.jsonl", retain_days=14.0)
            tracker = AvailabilityTracker(heartbeat_hours=0)
            probe_calls: List[HostTarget] = []

            def probe(t: HostTarget) -> bool:
                probe_calls.append(t)
                return True

            pinger = HostPinger(probe_fn=probe)
            targets, warnings = build_targets(
                {}, tablet_ip="192.168.1.33", tablet_mac="aa:bb:cc:dd:ee:33"
            )
            self.assertFalse(any("tablet" in w.lower() for w in warnings))
            tab = next((t for t in targets if t.role == "tablet"), None)
            self.assertIsNotNone(tab)
            assert tab is not None
            self.assertEqual(tab.ip, "192.168.1.33")

            records = run_ping_tick(pinger, tracker, ring, targets, now_ms=1000.0)
            probed_roles = {t.role for t in probe_calls}
            self.assertIn("tablet", probed_roles)

    def test_install_without_tablet_returns_error(self) -> None:
        """build_targets with no IP/MAC must warn and exclude tablet (not crash)."""
        targets, warnings = build_targets({})
        roles = {t.role for t in targets}
        self.assertNotIn("tablet", roles)
        self.assertTrue(any("tablet" in w.lower() for w in warnings))

    def test_config_parse_error_prints_and_exits(self) -> None:
        """Invalid config must cause ConfigError (exit 2 in main) not a crash."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text('{"retain_days": 3}', encoding="utf-8")
            with self.assertRaises(Exception):
                load_config(argv=["--config", str(path)])


class TestWanTrace(unittest.TestCase):
    def test_trace_on_wan_offline_flip(self) -> None:
        traces_called: List[str] = []

        def fake_tr(host: str) -> str:
            traces_called.append(host)
            return f"1  192.168.1.1  {host}"

        with tempfile.TemporaryDirectory() as tmp:
            ring = PingRing(Path(tmp) / "host-ping.jsonl", retain_days=14.0)
            tracker = AvailabilityTracker(heartbeat_hours=0)
            pinger = HostPinger(
                probe_fn=lambda t: t.role not in ("erp", "fibbee", "dns")
            )
            targets = [
                HostTarget(role="milk", ip="192.168.1.44", port=8000),
                HostTarget(role="erp", ip="erp.fibbee.com", port=None),
                HostTarget(role="fibbee", ip="91.206.15.66", port=None),
                HostTarget(role="dns", ip="8.8.8.8", port=None),
            ]
            written = run_ping_tick(
                pinger,
                tracker,
                ring,
                targets,
                now_ms=1000.0,
                traceroute_fn=fake_tr,
            )
            kinds = [getattr(r, "kind", None) for r in written]
            self.assertIn("host", kinds)
            self.assertEqual(kinds.count("trace"), 3)
            self.assertEqual(
                set(traces_called),
                {"erp.fibbee.com", "91.206.15.66", "8.8.8.8"},
            )
            written2 = run_ping_tick(
                pinger,
                tracker,
                ring,
                targets,
                now_ms=31_000.0,
                traceroute_fn=fake_tr,
            )
            self.assertEqual(written2, [])
            self.assertEqual(len(traces_called), 3)

    def test_trace_on_snapshot_if_still_down(self) -> None:
        traces_called: List[str] = []

        def fake_tr(host: str) -> str:
            traces_called.append(host)
            return "hop"

        tracker = AvailabilityTracker(snapshot_minutes=5.0)
        targets = [
            HostTarget(role="erp", ip="erp.fibbee.com", port=None),
        ]
        recs = tracker.process({"erp": False}, now_ms=0.0)
        traces = collect_wan_traces(
            targets, {"erp": False}, recs, 0.0, traceroute_fn=fake_tr
        )
        self.assertEqual(len(traces), 1)
        self.assertEqual(traces[0].kind, "trace")
        traces_called.clear()
        recs2 = tracker.process({"erp": False}, now_ms=300_000.0)
        self.assertTrue(any(isinstance(r, Snapshot) for r in recs2))
        traces2 = collect_wan_traces(
            targets, {"erp": False}, recs2, 300_000.0, traceroute_fn=fake_tr
        )
        self.assertEqual(len(traces2), 1)

    def test_legacy_heartbeat_hours_maps_to_snapshot_minutes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                '{"heartbeat_hours": 1, "retain_days": 14, "ping_interval_sec": 30}',
                encoding="utf-8",
            )
            cfg = load_config(argv=["--config", str(path)])
            self.assertEqual(cfg.snapshot_minutes, 60.0)


if __name__ == "__main__":
    unittest.main()
