"""CLI + config.json for sm-host-ping (stdlib)."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from .ping import MIN_RETAIN_DAYS

MIN_PING_INTERVAL_SEC = 5.0

DEFAULT_EXPECTED: Dict[str, str] = {
    "complexos": "192.168.1.43",
    "milk": "192.168.1.44",
    "coffee": "192.168.1.45",
    "water": "192.168.1.46",
    "router": "192.168.1.1",
    "erp": "erp.fibbee.com",
    "fibbee": "91.206.15.66",
    "dns": "8.8.8.8",
}


class ConfigError(ValueError):
    pass


@dataclass
class PingConfig:
    data_dir: str = "./data"
    ping_interval_sec: float = 30.0
    retain_days: float = MIN_RETAIN_DAYS
    max_bytes: Optional[int] = 5 * 1024 * 1024
    min_free_bytes: int = 50 * 1024 * 1024
    snapshot_minutes: float = 5.0
    heartbeat_hours: float = 0.0
    expected: Dict[str, str] = field(default_factory=lambda: dict(DEFAULT_EXPECTED))
    tablet_ip: Optional[str] = None
    tablet_mac: Optional[str] = None
    config_path: Optional[str] = None
    ticks: int = 0


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Service Monitor host ping (complexos)")
    p.add_argument("--config", type=str, default=None)
    p.add_argument("--data-dir", type=str, default=None)
    p.add_argument("--ping-interval-sec", type=float, default=None)
    p.add_argument("--retain-days", type=float, default=None)
    p.add_argument("--tablet-ip", type=str, default=None)
    p.add_argument("--tablet-mac", type=str, default=None)
    p.add_argument("--ticks", type=int, default=None)
    return p.parse_args(argv)


def _load_file(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ConfigError(f"config root must be object: {path}")
    return data


def _snapshot_minutes(file_data: Dict[str, Any]) -> float:
    """Prefer snapshot_minutes (default 5). Legacy heartbeat_hours → minutes."""
    if file_data.get("snapshot_minutes") is not None:
        return float(file_data["snapshot_minutes"])
    if file_data.get("snapshot-minutes") is not None:
        return float(file_data["snapshot-minutes"])
    hb = file_data.get("heartbeat_hours")
    if hb is None:
        hb = file_data.get("heartbeat-hours")
    if hb is not None:
        hours = float(hb)
        if hours > 0:
            return hours * 60.0
    return 5.0


def _validate(cfg: PingConfig) -> None:
    if cfg.ping_interval_sec < MIN_PING_INTERVAL_SEC:
        raise ConfigError(
            f"ping-interval-sec must be >= {MIN_PING_INTERVAL_SEC}, got {cfg.ping_interval_sec}"
        )
    if cfg.retain_days < MIN_RETAIN_DAYS:
        raise ConfigError(
            f"retain-days must be >= {MIN_RETAIN_DAYS}, got {cfg.retain_days}"
        )


def load_config(argv: Optional[List[str]] = None) -> PingConfig:
    ns = parse_args(argv)
    file_data: Dict[str, Any] = {}
    if ns.config:
        path = Path(ns.config)
        if not path.is_file():
            raise ConfigError(f"config file not found: {path}")
        file_data = _load_file(path)

    def pick(cli: Any, *keys: str, default: Any) -> Any:
        if cli is not None:
            return cli
        for k in keys:
            if k in file_data and file_data[k] is not None:
                return file_data[k]
        return default

    expected = dict(DEFAULT_EXPECTED)
    file_exp = file_data.get("expected")
    if isinstance(file_exp, Mapping):
        expected.update({str(k): str(v) for k, v in file_exp.items() if v is not None})

    tablet = file_data.get("tablet")
    tip = ns.tablet_ip
    tmac = ns.tablet_mac
    if isinstance(tablet, Mapping):
        if tip is None and tablet.get("ip") is not None:
            tip = str(tablet.get("ip") or "") or None
        if tmac is None and tablet.get("mac") is not None:
            tmac = str(tablet.get("mac") or "") or None
    # Flat keys also accepted
    if tip is None and file_data.get("tablet_ip"):
        tip = str(file_data["tablet_ip"])
    if tmac is None and file_data.get("tablet_mac"):
        tmac = str(file_data["tablet_mac"])

    tip_s = (str(tip).strip() if tip else "") or None
    tmac_s = (str(tmac).strip() if tmac else "") or None

    max_b = file_data.get("max_bytes")
    max_bytes: Optional[int]
    if max_b is None:
        max_bytes = 5 * 1024 * 1024
    else:
        max_bytes = int(max_b)

    cfg = PingConfig(
        data_dir=str(pick(ns.data_dir, "data_dir", "data-dir", default="./data")),
        ping_interval_sec=float(
            pick(ns.ping_interval_sec, "ping_interval_sec", "ping-interval-sec", default=30.0)
        ),
        retain_days=float(
            pick(ns.retain_days, "retain_days", "retain-days", default=MIN_RETAIN_DAYS)
        ),
        max_bytes=max_bytes,
        min_free_bytes=int(
            pick(None, "min_free_bytes", "min-free-bytes", default=50 * 1024 * 1024)
        ),
        snapshot_minutes=_snapshot_minutes(file_data),
        heartbeat_hours=float(
            pick(None, "heartbeat_hours", "heartbeat-hours", default=0.0)
        ),
        expected=expected,
        tablet_ip=tip_s,
        tablet_mac=tmac_s,
        config_path=ns.config,
        ticks=int(pick(ns.ticks, "ticks", default=0) or 0),
    )
    _validate(cfg)
    return cfg
