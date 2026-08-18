#!/usr/bin/env python3
"""complexos Lab onboard logger — CLI (Phase 1.6+).

FakeSource (--fake-source) for local demo; default tries NatsSource
on nats://127.0.0.1:4222 with Modules-parity valves/heaters/pumps + DX :8000.
Soft-fail ticks; never brick complexos. See docs/LAB_ONBOARD_LOGGER.md.

Host LAN reachability is a **sibling** tool: tools/complexos-host-ping
(sm-host-ping) — not part of this logger.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Allow `python main.py` from this directory without PYTHONPATH.
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sm_lab_logger.config import ConfigError, LoggerConfig, load_config
from sm_lab_logger.delta import DeltaEngine
from sm_lab_logger.http_api import LabHttpServer
from sm_lab_logger.lock import LockError, PidLock
from sm_lab_logger.poller import NatsSource
from sm_lab_logger.ring import RingStore
from sm_lab_logger.runner import run_tick
from sm_lab_logger.schema import LabEvent, Snapshot
from sm_lab_logger.topology import check_topology
from sm_lab_logger.watchdog import Watchdog


def _dx_urls_from_expected(expected: Dict[str, str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for role in ("milk", "coffee", "water"):
        ip = expected.get(role)
        if not ip:
            continue
        host = ip if "://" in ip else f"http://{ip}:8000/"
        if not host.endswith("/"):
            host = host + "/"
        out[role] = host
    return out


class _Runtime:
    """Shared state for HTTP handlers + poll loop."""

    def __init__(
        self,
        cfg: LoggerConfig,
        ring: RingStore,
        lock: PidLock,
        source_kind: str = "idle",
    ) -> None:
        self.cfg = cfg
        self.ring = ring
        self.lock = lock
        self.source_kind = source_kind
        self.engine = DeltaEngine(heartbeat_sec=cfg.heartbeat_sec, heartbeat_on_first=True)
        self.watchdog = Watchdog(
            max_failures=cfg.nats_max_failures,
            base_interval_ms=cfg.interval_ms,
            max_interval_ms=max(cfg.interval_ms * 64, 30_000),
        )
        self.last_sample_ms: Optional[float] = None
        self.topology_warnings: List[str] = []
        self.tick_count = 0

    def health(self) -> Dict[str, Any]:
        age = None
        if self.last_sample_ms is not None:
            age = max(0.0, time.time() * 1000.0 - self.last_sample_ms)
        disk = 0
        try:
            disk = self.ring.path.stat().st_size
        except OSError:
            pass
        return {
            "ok": True,
            "last_sample_age_ms": age,
            "lock_held": self.lock.held,
            "topology_warnings": list(self.topology_warnings),
            "disk_bytes": disk,
            "ticks": self.tick_count,
            "watchdog_backoff": self.watchdog.in_backoff,
            "dx_allowed": self.watchdog.dx_allowed,
            "interval_ms": self.watchdog.interval_ms(),
            "source": self.source_kind,
            "fake_source": self.source_kind == "fake",
        }

    def snapshot(self) -> Dict[str, Any]:
        state = self.engine.state()
        ts = self.last_sample_ms if self.last_sample_ms is not None else time.time() * 1000.0
        return Snapshot(ts=ts, values=state, kinds=self.engine.kinds()).to_dict()

    def events(self, from_ts: Optional[float], to_ts: Optional[float]) -> List[Dict[str, Any]]:
        start = from_ts if from_ts is not None else 0.0
        recs = self.ring.records_since(start)
        if to_ts is not None:
            recs = [r for r in recs if r.ts <= to_ts]
        return [r.to_dict() for r in recs]


def _cycling_fake_frame(tick: int, now_ms: float) -> List[LabEvent]:
    """Deterministic valve/sensor demo frames for --fake-source."""
    drain = tick % 2
    pump = (tick // 2) % 2
    current = 1.0 + (tick % 5) * 0.1
    pwm = 25.0 if tick % 3 else 0.0
    return [
        LabEvent(ts=now_ms, kind="valve", module="milk", name="drain", value=drain),
        LabEvent(ts=now_ms, kind="valve", module="coffee", name="milkInput", value=pump),
        LabEvent(ts=now_ms, kind="pump", module="coffee", name="pump", value=pump),
        LabEvent(ts=now_ms, kind="sensor", module="coffee", name="pumpCurrent", value=current),
        LabEvent(ts=now_ms, kind="sensor", module="milk", name="heater1_pwm", value=pwm),
        LabEvent(ts=now_ms, kind="heater", module="milk", name="heater1", value=1 if pwm else 0),
    ]


class _CyclingFakeSource:
    """Endless FakeSource-compatible poller for local demo."""

    def __init__(self) -> None:
        self._tick = 0

    def poll(self) -> List[LabEvent]:
        now_ms = time.time() * 1000.0
        frame = _cycling_fake_frame(self._tick, now_ms)
        self._tick += 1
        return frame


def _run_poll_loop(
    rt: _Runtime,
    source,
    http: Optional[LabHttpServer],
    cfg: LoggerConfig,
) -> int:
    try:
        while True:
            now_ms = time.time() * 1000.0
            written = run_tick(source, rt.engine, rt.ring, rt.watchdog, now_ms=now_ms)
            if written:
                rt.last_sample_ms = now_ms
            rt.ring.trim(now_ms=now_ms)
            reachable = getattr(source, "last_reachable", None)
            if reachable is not None:
                discovered = {
                    role: ip for role, ip in cfg.expected.items() if role in reachable
                }
                topo_expected = {
                    k: v
                    for k, v in cfg.expected.items()
                    if k in ("milk", "coffee", "water")
                }
                rt.topology_warnings = list(
                    check_topology(discovered, expected=topo_expected or cfg.expected).warnings
                )
            rt.tick_count += 1
            if cfg.ticks and rt.tick_count >= cfg.ticks:
                print(f"poll: completed {rt.tick_count} ticks", flush=True)
                break
            sleep_s = rt.watchdog.interval_ms() / 1000.0
            time.sleep(sleep_s)
    except KeyboardInterrupt:
        print("interrupted", flush=True)
    finally:
        if http:
            http.stop()
        close = getattr(source, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass
        rt.lock.release()
    return 0


def main(argv: list[str] | None = None) -> int:
    try:
        cfg = load_config(argv)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    data_dir = Path(cfg.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    ring_path = data_dir / "lab-events.jsonl"
    lock_path = data_dir / "lab-logger.lock"

    print(
        "sm-lab-logger: "
        f"retain-hours={cfg.retain_hours} interval-ms={cfg.interval_ms} "
        f"http-port={cfg.http_port or 'off'} data-dir={data_dir} "
        f"profile={cfg.profile} dry-run={cfg.dry_run} fake-source={cfg.fake_source} "
        f"nats-url={cfg.nats_url}",
        flush=True,
    )

    if cfg.dry_run:
        store = RingStore(
            ring_path,
            retain_hours=cfg.retain_hours,
            max_bytes=cfg.max_bytes,
        )
        snap = Snapshot(
            ts=time.time() * 1000.0,
            values={"_heartbeat": 1, "profile": cfg.profile},
        )
        store.append(snap)
        store.trim(now_ms=snap.ts)
        print(f"dry-run: wrote heartbeat -> {ring_path}", flush=True)
        return 0

    try:
        lock = PidLock(lock_path)
        lock.acquire()
    except LockError as exc:
        print(f"lock error: {exc}", file=sys.stderr)
        return 3

    ring = RingStore(ring_path, retain_hours=cfg.retain_hours, max_bytes=cfg.max_bytes)

    source_kind = "idle"
    source = None

    if cfg.fake_source:
        source = _CyclingFakeSource()
        source_kind = "fake"
        print(
            f"fake-source loop: heartbeat_sec={cfg.heartbeat_sec} "
            f"ticks={'∞' if not cfg.ticks else cfg.ticks} "
            "(demo only — not field valves)",
            flush=True,
        )
    else:
        source = NatsSource(
            url=cfg.nats_url,
            dx_urls=_dx_urls_from_expected(cfg.expected),
            profile=cfg.profile,
        )
        source_kind = "nats"
        print(
            f"nats-source: {cfg.nats_url} profile={cfg.profile} "
            "(MODULE_VALVES + heaters + pumps + DX :8000, stdlib mini-NATS client)",
            flush=True,
        )

    rt = _Runtime(cfg, ring, lock, source_kind=source_kind)
    rt.topology_warnings = []

    http: Optional[LabHttpServer] = None
    if cfg.http_port and cfg.http_port > 0:
        http = LabHttpServer(
            host="127.0.0.1",
            port=cfg.http_port,
            health_fn=rt.health,
            snapshot_fn=rt.snapshot,
            events_fn=rt.events,
        )
        http.start()
        print(f"http: http://127.0.0.1:{http.port}/lab/health", flush=True)

    if source is None:
        try:
            while True:
                time.sleep(max(cfg.interval_ms, 1000) / 1000.0)
                rt.tick_count += 1
                if cfg.ticks and rt.tick_count >= cfg.ticks:
                    break
        except KeyboardInterrupt:
            pass
        finally:
            if http:
                http.stop()
            lock.release()
        return 0

    return _run_poll_loop(rt, source, http, cfg)


if __name__ == "__main__":
    sys.exit(main())
