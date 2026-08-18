"""Install metadata: file list, version, remote paths (stdlib).

Used by SM bundler and Python tests — keep in sync with
packages/core/src/nats/lab-logger.ts LAB_LOGGER_PACKAGE_FILES.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from . import __version__

REMOTE_ROOT = "/home/pi/sm-lab-logger"
UNIT_NAME = "sm-lab-logger"
USER_UNIT_PATH = f"/home/pi/.config/systemd/user/{UNIT_NAME}.service"
HTTP_PORT = 8765
RING_REL = "data/lab-events.jsonl"
CONFIG_REL = "config.json"

# Relative to tools/complexos-lab-logger/
PACKAGE_FILES: List[str] = [
    "main.py",
    "sm_lab_logger/__init__.py",
    "sm_lab_logger/config.py",
    "sm_lab_logger/schema.py",
    "sm_lab_logger/ring.py",
    "sm_lab_logger/topology.py",
    "sm_lab_logger/delta.py",
    "sm_lab_logger/lock.py",
    "sm_lab_logger/watchdog.py",
    "sm_lab_logger/devices.py",
    "sm_lab_logger/dx_ui.py",
    "sm_lab_logger/mini_nats.py",
    "sm_lab_logger/poller.py",
    "sm_lab_logger/runner.py",
    "sm_lab_logger/http_api.py",
    "requirements.txt",
]


def package_root() -> Path:
    """tools/complexos-lab-logger directory."""
    return Path(__file__).resolve().parent.parent


def list_package_paths() -> List[Path]:
    root = package_root()
    return [root / rel for rel in PACKAGE_FILES]


def missing_package_files() -> List[str]:
    return [rel for rel, p in zip(PACKAGE_FILES, list_package_paths()) if not p.is_file()]


def build_systemd_user_unit(
    *,
    root: str = REMOTE_ROOT,
    http_port: int = HTTP_PORT,
    python: str = "/usr/bin/python3",
    fake_source: bool = False,
) -> str:
    config = f"{root}/{CONFIG_REL}"
    fake = " --fake-source" if fake_source else ""
    return (
        "[Unit]\n"
        "Description=Service Monitor Lab onboard logger\n"
        "After=network.target\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        f"WorkingDirectory={root}\n"
        f"ExecStart={python} {root}/main.py --config {config} --http-port {http_port}{fake}\n"
        "Restart=on-failure\n"
        "RestartSec=5\n"
        "Nice=10\n"
        "\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def build_default_config(
    *,
    retain_hours: float = 24.0,
    interval_ms: int = 200,
    http_port: int = HTTP_PORT,
    fake_source: bool = False,
) -> dict:
    return {
        "retain_hours": retain_hours,
        "interval_ms": interval_ms,
        "heartbeat_sec": 2.0,
        "http_port": http_port,
        "data_dir": f"{REMOTE_ROOT}/data",
        "profile": "4.x",
        "fake_source": fake_source,
        "nats_url": "nats://127.0.0.1:4222",
        "expected": {
            "milk": "192.168.1.44",
            "coffee": "192.168.1.45",
            "water": "192.168.1.46",
            "complexos": "192.168.1.43",
        },
    }


__all__ = [
    "__version__",
    "REMOTE_ROOT",
    "UNIT_NAME",
    "USER_UNIT_PATH",
    "HTTP_PORT",
    "RING_REL",
    "CONFIG_REL",
    "PACKAGE_FILES",
    "package_root",
    "list_package_paths",
    "missing_package_files",
    "build_systemd_user_unit",
    "build_default_config",
]
