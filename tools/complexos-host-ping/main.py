#!/usr/bin/env python3
"""complexos host ping — standalone LAN reachability agent.

Sibling of sm-lab-logger (not part of onboard telemetry). Soft-fail; stdlib only.
See docs/HOST_PING.md.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import List, Optional

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sm_host_ping.config import ConfigError, PingConfig, load_config
from sm_host_ping.ping import (
    AVAILABILITY_FILENAME,
    AvailabilityTracker,
    HostPinger,
    HostTarget,
    PingRing,
    build_targets,
    run_ping_tick,
)
from sm_host_ping.resolve import resolve_mac_to_ip


def _refresh_tablet_ip(
    targets: List[HostTarget],
    cfg: PingConfig,
    *,
    force_resolve: bool = False,
) -> List[HostTarget]:
    """If tablet has MAC (and optional stale IP), soft-resolve via neigh/arp.

    When force_resolve and MAC is set, re-resolve even if an IP is already known
    (helps after DHCP / Wi‑Fi roam). Soft-fail if neigh empty.
    """
    out: List[HostTarget] = []
    for t in targets:
        if t.role != "tablet":
            out.append(t)
            continue
        ip = t.ip
        mac = t.mac or cfg.tablet_mac
        if mac and (not ip or force_resolve):
            resolved = resolve_mac_to_ip(mac)
            if resolved:
                ip = resolved
        out.append(HostTarget(role=t.role, ip=ip, port=t.port, mac=mac))
    return out


def _with_tablet_ip(targets: List[HostTarget], ip: Optional[str]) -> List[HostTarget]:
    if not ip:
        return targets
    out: List[HostTarget] = []
    for t in targets:
        if t.role == "tablet":
            out.append(HostTarget(role=t.role, ip=ip, port=t.port, mac=t.mac))
        else:
            out.append(t)
    return out


def main(argv: Optional[list[str]] = None) -> int:
    try:
        cfg = load_config(argv)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    data_dir = Path(cfg.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    ring_path = data_dir / AVAILABILITY_FILENAME

    targets, warnings = build_targets(
        cfg.expected,
        tablet_ip=cfg.tablet_ip,
        tablet_mac=cfg.tablet_mac,
    )
    ring = PingRing(
        ring_path,
        retain_days=cfg.retain_days,
        max_bytes=cfg.max_bytes,
        min_free_bytes=cfg.min_free_bytes,
    )
    tracker = AvailabilityTracker(snapshot_minutes=cfg.snapshot_minutes)
    # Seed from existing ring so systemd restarts do not re-emit identical states.
    try:
        tracker.seed_from_records(ring.records_since(0))
    except Exception:
        pass
    pinger = HostPinger(timeout_sec=0.5)

    roles = ",".join(t.role for t in targets) or "(none)"
    print(
        "sm-host-ping: "
        f"interval={cfg.ping_interval_sec}s snapshot={cfg.snapshot_minutes}min "
        f"retain_days={cfg.retain_days} "
        f"data={ring_path} targets=[{roles}] "
        f"tablet_ip={cfg.tablet_ip or '-'} tablet_mac={cfg.tablet_mac or '-'}",
        flush=True,
    )
    for w in warnings:
        print(f"warn: {w}", flush=True)
    if cfg.tablet_mac and not cfg.tablet_ip:
        print(
            "note: tablet MAC-only — needs neigh/arp hit; "
            "Wi‑Fi off → оффлайн is expected",
            flush=True,
        )

    tick = 0
    tablet_down_streak = 0
    try:
        while True:
            now_ms = time.time() * 1000.0
            force = tablet_down_streak >= 2 and bool(cfg.tablet_mac)
            live = _refresh_tablet_ip(targets, cfg, force_resolve=force)
            live = [t for t in live if t.ip]
            for t in live:
                if t.role == "tablet" and t.ip:
                    targets = _with_tablet_ip(targets, t.ip)
                    break
            run_ping_tick(pinger, tracker, ring, live, now_ms=now_ms)
            known = tracker.known("tablet")
            if known is False:
                tablet_down_streak += 1
            elif known is True:
                tablet_down_streak = 0
            tick += 1
            if cfg.ticks and tick >= cfg.ticks:
                print(f"done: {tick} ticks", flush=True)
                break
            time.sleep(max(cfg.ping_interval_sec, 5.0))
    except KeyboardInterrupt:
        print("interrupted", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
