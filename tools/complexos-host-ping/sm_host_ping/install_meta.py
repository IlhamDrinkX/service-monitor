"""Install metadata — keep in sync with packages/core/src/nats/host-ping.ts."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from . import __version__

REMOTE_ROOT = "/home/pi/sm-host-ping"
UNIT_NAME = "sm-host-ping"
USER_UNIT_PATH = f"/home/pi/.config/systemd/user/{UNIT_NAME}.service"
RING_REL = "data/host-ping.jsonl"
CONFIG_REL = "config.json"

PACKAGE_FILES: List[str] = [
    "main.py",
    "sm_host_ping/__init__.py",
    "sm_host_ping/schema.py",
    "sm_host_ping/ring.py",
    "sm_host_ping/ping.py",
    "sm_host_ping/resolve.py",
    "sm_host_ping/config.py",
    "sm_host_ping/install_meta.py",
]


def package_root() -> Path:
    return Path(__file__).resolve().parent.parent


def build_systemd_user_unit(
    *,
    root: str = REMOTE_ROOT,
    python: str = "/usr/bin/python3",
) -> str:
    config = f"{root}/{CONFIG_REL}"
    return (
        "[Unit]\n"
        "Description=Service Monitor host ping (LAN reachability)\n"
        "After=network.target\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        f"WorkingDirectory={root}\n"
        f"ExecStart={python} {root}/main.py --config {config}\n"
        "Restart=on-failure\n"
        "RestartSec=5\n"
        "Nice=10\n"
        "\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def build_default_config(
    *,
    tablet_ip: Optional[str] = None,
    tablet_mac: Optional[str] = None,
    retain_days: float = 14.0,
    ping_interval_sec: float = 30.0,
) -> Dict[str, Any]:
    tablet: Dict[str, str] = {}
    if tablet_ip:
        tablet["ip"] = tablet_ip
    if tablet_mac:
        tablet["mac"] = tablet_mac
    return {
        "ping_interval_sec": ping_interval_sec,
        "retain_days": retain_days,
        "max_bytes": 5 * 1024 * 1024,
        "min_free_bytes": 50 * 1024 * 1024,
        "heartbeat_hours": 0,
        "snapshot_minutes": 5,
        "data_dir": f"{REMOTE_ROOT}/data",
        "expected": {
            "complexos": "192.168.1.43",
            "milk": "192.168.1.44",
            "coffee": "192.168.1.45",
            "water": "192.168.1.46",
            "router": "192.168.1.1",
            "erp": "erp.fibbee.com",
            "fibbee": "91.206.15.66",
            "dns": "8.8.8.8",
        },
        "tablet": tablet,
    }


__all__ = [
    "__version__",
    "REMOTE_ROOT",
    "UNIT_NAME",
    "USER_UNIT_PATH",
    "RING_REL",
    "CONFIG_REL",
    "PACKAGE_FILES",
    "package_root",
    "build_systemd_user_unit",
    "build_default_config",
]
