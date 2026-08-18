"""TCP/ICMP probe, change-only tracker, dated rotation. Soft-fail; stdlib only."""

from __future__ import annotations

import os
import platform
import shutil
import socket
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Tuple, Union

from .ring import RingStore
from .schema import (
    KIND_HOST,
    KIND_TRACE,
    NAME_REACHABLE,
    NAME_TRACEROUTE,
    HostEvent,
    Record,
    Snapshot,
    coerce_reachable_up,
    format_local_at,
    status_from_up,
)

MIN_RETAIN_DAYS = 14.0
AVAILABILITY_FILENAME = "host-ping.jsonl"
TRACE_MAX_CHARS = 4000
SNAPSHOT_MS_DEFAULT = 5.0 * 60_000.0

# WAN hosts: ICMP every 30s; traceroute when they go (or stay) offline.
WAN_ROLES = frozenset({"erp", "fibbee", "dns"})


@dataclass(frozen=True)
class HostTarget:
    role: str
    ip: Optional[str]
    port: Optional[int] = None
    mac: Optional[str] = None


DEFAULT_TARGETS: Tuple[HostTarget, ...] = (
    HostTarget(role="complexos", ip="192.168.1.43", port=22),
    HostTarget(role="milk", ip="192.168.1.44", port=8000),
    HostTarget(role="coffee", ip="192.168.1.45", port=8000),
    HostTarget(role="water", ip="192.168.1.46", port=8000),
    HostTarget(role="router", ip="192.168.1.1", port=80),
    HostTarget(role="erp", ip="erp.fibbee.com", port=None),
    HostTarget(role="fibbee", ip="91.206.15.66", port=None),
    HostTarget(role="dns", ip="8.8.8.8", port=None),
)

_DEFAULT_PORTS: Dict[str, int] = {
    "complexos": 22,
    "milk": 8000,
    "coffee": 8000,
    "water": 8000,
    "router": 80,
    "tablet": 80,
}

# Android tablets commonly respond to ADB (5555) or alternate HTTP ports.
# Port 80 is rarely open on stock Android; try these after ICMP.
_TABLET_FALLBACK_PORTS: Tuple[int, ...] = (5555, 8080, 443)


def free_disk_bytes(path: Union[str, Path]) -> int:
    try:
        return int(shutil.disk_usage(str(path)).free)
    except OSError:
        return 0


def build_targets(
    expected: Optional[Mapping[str, str]] = None,
    *,
    tablet_ip: Optional[str] = None,
    tablet_mac: Optional[str] = None,
) -> Tuple[List[HostTarget], List[str]]:
    """Build probe list. Tablet requires IP and/or MAC."""
    exp = dict(expected or {})
    warnings: List[str] = []
    by_role: Dict[str, HostTarget] = {}

    for base in DEFAULT_TARGETS:
        ip = (exp.get(base.role) or base.ip or "").strip() or None
        by_role[base.role] = HostTarget(role=base.role, ip=ip, port=base.port)

    tip = (tablet_ip or exp.get("tablet") or "").strip() or None
    tmac = (tablet_mac or "").strip() or None
    if tip or tmac:
        by_role["tablet"] = HostTarget(
            role="tablet",
            ip=tip,
            port=_DEFAULT_PORTS["tablet"],
            mac=tmac,
        )
    else:
        warnings.append("tablet IP/MAC not set — tablet skipped")

    targets = [t for t in by_role.values() if t.ip or t.mac]
    order = [
        "complexos",
        "milk",
        "coffee",
        "water",
        "router",
        "tablet",
        "erp",
        "fibbee",
        "dns",
    ]
    rank = {r: i for i, r in enumerate(order)}
    targets.sort(key=lambda t: (rank.get(t.role, 100), t.role))
    return targets, warnings


def tcp_reachable(ip: str, port: int, timeout_sec: float = 1.0) -> bool:
    try:
        with socket.create_connection((ip, int(port)), timeout=timeout_sec):
            return True
    except OSError:
        return False


def icmp_reachable(ip: str, timeout_sec: float = 1.0) -> bool:
    system = platform.system().lower()
    try:
        if system == "windows":
            ms = max(1, int(timeout_sec * 1000))
            cmd = ["ping", "-n", "1", "-w", str(ms), ip]
        else:
            sec = max(1, int(timeout_sec))
            cmd = ["ping", "-c", "1", "-W", str(sec), ip]
        proc = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout_sec + 2.0,
            check=False,
        )
        return proc.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def tablet_probe(ip: str, timeout_sec: float = 0.5) -> bool:
    """Probe an Android tablet: ICMP first, then TCP fallback ports.

    Android stock ROM blocks TCP :80 from LAN peers but responds to ICMP
    (same path as MikroTik/router ping). ADB :5555, alt-HTTP :8080/:443 are
    tried as secondary checks — sufficient for determining Wi-Fi connectivity.
    """
    if icmp_reachable(ip, timeout_sec=timeout_sec):
        return True
    for port in _TABLET_FALLBACK_PORTS:
        if tcp_reachable(ip, port, timeout_sec=timeout_sec):
            return True
    return False


def default_probe(target: HostTarget, timeout_sec: float = 0.5) -> bool:
    """TCP to role port when set; ICMP otherwise.

    Tablet: ICMP first (same path as MikroTik), then TCP fallback ports.
    WAN (erp / fibbee): ICMP (hostname or IP).
    Other LAN hosts: TCP to role port; no ICMP fallback (they serve known ports).
    """
    if not target.ip:
        return False
    try:
        if target.role == "tablet":
            return tablet_probe(target.ip, timeout_sec=timeout_sec)
        if target.role in WAN_ROLES or target.port is None:
            return icmp_reachable(target.ip, timeout_sec=max(timeout_sec, 1.5))
        return tcp_reachable(target.ip, target.port, timeout_sec=timeout_sec)
    except Exception:
        return False


def traceroute_host(
    host: str,
    *,
    max_hops: int = 12,
    timeout_sec: float = 15.0,
) -> str:
    """Best-effort traceroute. Soft-fail; truncate for jsonl.

    Linux: traceroute -n, else tracepath. Windows: tracert -d.
    """
    host = (host or "").strip()
    if not host:
        return "traceroute: empty host"
    system = platform.system().lower()
    cmd: Optional[List[str]] = None
    try:
        if system == "windows":
            cmd = ["tracert", "-d", "-h", str(max_hops), "-w", "1000", host]
        elif shutil.which("traceroute"):
            cmd = [
                "traceroute",
                "-n",
                "-w",
                "1",
                "-q",
                "1",
                "-m",
                str(max_hops),
                host,
            ]
        elif shutil.which("tracepath"):
            cmd = ["tracepath", "-n", "-m", str(max_hops), host]
        else:
            return "traceroute: command not found"
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
        text = ((proc.stdout or "") + (proc.stderr or "")).strip()
        if not text:
            text = f"traceroute empty (exit {proc.returncode})"
        if len(text) > TRACE_MAX_CHARS:
            text = text[:TRACE_MAX_CHARS] + "…"
        return text
    except (OSError, subprocess.SubprocessError) as exc:
        return f"traceroute error: {exc}"


TracerouteFn = Callable[[str], str]


def collect_wan_traces(
    targets: Sequence[HostTarget],
    results: Mapping[str, bool],
    records: Sequence[Record],
    now_ms: float,
    traceroute_fn: Optional[TracerouteFn] = None,
) -> List[HostEvent]:
    """Trace WAN hosts when they flip offline, and again on 5-min snapshot if still down."""
    fn = traceroute_fn or traceroute_host
    by_role = {t.role: t for t in targets}
    flipped_off: set[str] = set()
    snapshot_tick = False
    for rec in records:
        if isinstance(rec, HostEvent) and rec.kind == KIND_HOST:
            if rec.module in WAN_ROLES and coerce_reachable_up(rec.value) is False:
                flipped_off.add(str(rec.module))
        elif isinstance(rec, Snapshot):
            snapshot_tick = True
    roles: List[str] = []
    seen: set[str] = set()
    for role in list(flipped_off):
        if role not in seen:
            roles.append(role)
            seen.add(role)
    if snapshot_tick:
        for role in ("erp", "fibbee", "dns"):
            if results.get(role) is False and role not in seen:
                roles.append(role)
                seen.add(role)
    out: List[HostEvent] = []
    at = format_local_at(now_ms)
    for role in roles:
        t = by_role.get(role)
        host = (t.ip if t else None) or role
        try:
            text = fn(host)
        except Exception as exc:
            text = f"traceroute error: {exc}"
        out.append(
            HostEvent(
                ts=now_ms,
                at=at,
                kind=KIND_TRACE,
                module=role,
                name=NAME_TRACEROUTE,
                value=text,
            )
        )
    return out


ProbeFn = Callable[[HostTarget], bool]


class HostPinger:
    def __init__(
        self,
        probe_fn: Optional[ProbeFn] = None,
        timeout_sec: float = 0.5,
    ) -> None:
        self.timeout_sec = float(timeout_sec)
        self._probe_fn = probe_fn

    def probe_one(self, target: HostTarget) -> bool:
        if not target.ip:
            return False
        fn = self._probe_fn
        try:
            if fn is not None:
                return bool(fn(target))
            return default_probe(target, timeout_sec=self.timeout_sec)
        except Exception:
            return False

    def probe_all(self, targets: Sequence[HostTarget]) -> Dict[str, bool]:
        out: Dict[str, bool] = {}
        for t in targets:
            if not t.ip:
                continue
            out[t.role] = self.probe_one(t)
        return out


class AvailabilityTracker:
    def __init__(
        self,
        snapshot_minutes: float = 5.0,
        heartbeat_hours: Optional[float] = None,
    ) -> None:
        # heartbeat_hours is legacy (tests pass 0 to disable). Prefer snapshot_minutes.
        if heartbeat_hours is not None:
            self.snapshot_ms = float(heartbeat_hours) * 3_600_000.0
        else:
            self.snapshot_ms = float(snapshot_minutes) * 60_000.0
        self._state: Dict[str, bool] = {}
        self._last_heartbeat_ms: Optional[float] = None

    def seed_from_records(self, records: Sequence[Record]) -> None:
        """Restore last known reachable state so restarts do not re-spam identical lines."""
        for rec in records:
            if isinstance(rec, HostEvent):
                if rec.name != NAME_REACHABLE:
                    continue
                up = coerce_reachable_up(rec.value)
                if up is None:
                    continue
                self._state[str(rec.module)] = up
            elif isinstance(rec, Snapshot):
                for key, val in rec.values.items():
                    if not str(key).endswith(f".{NAME_REACHABLE}"):
                        continue
                    role = str(key)[: -len(f".{NAME_REACHABLE}")]
                    up = coerce_reachable_up(val)
                    if up is None or not role:
                        continue
                    self._state[role] = up

    def known(self, role: str) -> Optional[bool]:
        return self._state.get(role)

    def process(self, results: Mapping[str, bool], now_ms: float) -> List[Record]:
        out: List[Record] = []
        at = format_local_at(now_ms)
        for role, up in results.items():
            prev = self._state.get(role)
            cur = bool(up)
            if prev is None or prev != cur:
                self._state[role] = cur
                out.append(
                    HostEvent(
                        ts=now_ms,
                        at=at,
                        kind=KIND_HOST,
                        module=role,
                        name=NAME_REACHABLE,
                        value=status_from_up(cur),
                    )
                )
            else:
                self._state[role] = cur

        if self.snapshot_ms > 0 and self._state:
            need_hb = False
            if self._last_heartbeat_ms is None:
                self._last_heartbeat_ms = now_ms
            else:
                if now_ms - self._last_heartbeat_ms >= self.snapshot_ms:
                    need_hb = True
            if need_hb:
                values = {
                    f"{role}.{NAME_REACHABLE}": status_from_up(up)
                    for role, up in self._state.items()
                }
                kinds = {k: KIND_HOST for k in values}
                out.append(
                    Snapshot(ts=now_ms, at=at, values=values, kinds=kinds)
                )
                self._last_heartbeat_ms = now_ms
        return out


class PingRing:
    def __init__(
        self,
        path: Union[str, Path],
        retain_days: float = MIN_RETAIN_DAYS,
        max_bytes: Optional[int] = None,
        min_free_bytes: int = 50 * 1024 * 1024,
    ) -> None:
        days = float(retain_days)
        if days < MIN_RETAIN_DAYS:
            raise ValueError(f"retain_days must be >= {MIN_RETAIN_DAYS}, got {days}")
        self.path = Path(path)
        self.retain_days = days
        self.max_bytes = max_bytes
        self.min_free_bytes = int(min_free_bytes)
        self._store = RingStore(
            self.path,
            retain_hours=days * 24.0,
            max_bytes=None,
        )

    def append(self, record: Union[HostEvent, Snapshot, str]) -> None:
        self._store.append(record)

    def events_since(self, ts: float) -> List[HostEvent]:
        return self._store.events_since(ts)

    def records_since(self, ts: float) -> List[Record]:
        return self._store.records_since(ts)

    def trim(self, now_ms: Optional[float] = None) -> None:
        self._store.trim(now_ms=now_ms)

    def disk_bytes(self) -> int:
        try:
            return int(self.path.stat().st_size)
        except OSError:
            return 0

    def maybe_rotate(self, now_ms: Optional[float] = None) -> Optional[Path]:
        if self.max_bytes is None or self.max_bytes <= 0:
            return None
        try:
            size = self.path.stat().st_size
        except OSError:
            return None
        if size <= self.max_bytes:
            return None
        if free_disk_bytes(self.path.parent) < self.min_free_bytes:
            return None

        wall = float(now_ms) if now_ms is not None else time.time() * 1000.0
        try:
            stamp = datetime.fromtimestamp(wall / 1000.0).strftime("%Y%m%d")
        except (OSError, OverflowError, ValueError):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d")

        archive = self.path.parent / f"host-ping-{stamp}.jsonl"
        n = 1
        while archive.exists():
            archive = self.path.parent / f"host-ping-{stamp}-{n}.jsonl"
            n += 1
        try:
            os.replace(str(self.path), str(archive))
        except OSError:
            return None
        self.path.touch()
        self._store = RingStore(
            self.path,
            retain_hours=self.retain_days * 24.0,
            max_bytes=None,
        )
        return archive


def run_ping_tick(
    pinger: HostPinger,
    tracker: AvailabilityTracker,
    ring: PingRing,
    targets: Sequence[HostTarget],
    now_ms: float,
    traceroute_fn: Optional[TracerouteFn] = None,
) -> List[Record]:
    try:
        results = pinger.probe_all(targets)
        records = tracker.process(results, now_ms=now_ms)
        traces = collect_wan_traces(
            targets,
            results,
            records,
            now_ms,
            traceroute_fn=traceroute_fn,
        )
        written: List[Record] = list(records) + traces
        for rec in written:
            ring.append(rec)
        ring.trim(now_ms=now_ms)
        ring.maybe_rotate(now_ms=now_ms)
        return written
    except Exception:
        return []
