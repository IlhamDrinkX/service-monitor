"""CLI args + config file (JSON; optional simple YAML) — stdlib only."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from .topology import DEFAULT_EXPECTED

MIN_INTERVAL_MS = 50


class ConfigError(ValueError):
    """Invalid configuration (interval / retain / file)."""


@dataclass
class LoggerConfig:
    retain_hours: float = 24.0
    interval_ms: int = 200
    data_dir: str = "./data"
    http_port: int = 0
    config_path: Optional[str] = None
    expected: Dict[str, str] = field(default_factory=lambda: dict(DEFAULT_EXPECTED))
    heartbeat_sec: float = 2.0
    max_bytes: Optional[int] = None
    dry_run: bool = False
    fake_source: bool = False
    ticks: int = 0  # 0 = run until interrupt
    profile: str = "4.x"
    nats_max_failures: int = 5
    nats_url: str = "nats://127.0.0.1:4222"


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Service Monitor Lab onboard logger (complexos)")
    p.add_argument("--retain-hours", type=float, default=None, help="Ring retention window (hours)")
    p.add_argument("--interval-ms", type=int, default=None, help="Poll interval in milliseconds")
    p.add_argument("--http-port", type=int, default=None, help="If >0, serve on 127.0.0.1")
    p.add_argument("--data-dir", type=str, default=None, help="Ring / snapshot directory")
    p.add_argument("--config", type=str, default=None, help="Path to config.json or config.yaml")
    p.add_argument("--heartbeat-sec", type=float, default=None, help="Full snapshot interval (seconds)")
    p.add_argument("--max-bytes", type=int, default=None, help="Ring soft size cap")
    p.add_argument("--profile", type=str, default=None, help="Complex profile: 4.x or 3.x")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Write one heartbeat to the ring and exit (no NATS loop)",
    )
    p.add_argument(
        "--fake-source",
        action="store_true",
        help="Run poll loop with FakeSource (demo only; not field valves)",
    )
    p.add_argument(
        "--nats-url",
        type=str,
        default=None,
        help="NATS URL for Phase 1.6 NatsSource (default nats://127.0.0.1:4222)",
    )
    p.add_argument(
        "--ticks",
        type=int,
        default=None,
        help="Stop after N ticks (0 or omit = until Ctrl-C); useful with --fake-source",
    )
    return p.parse_args(argv)


def _load_file_dict(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    suffix = path.suffix.lower()
    if suffix == ".json":
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ConfigError(f"config root must be object: {path}")
        return data
    if suffix in (".yaml", ".yml"):
        return _parse_simple_yaml(text, path)
    # Try JSON first, then YAML
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    return _parse_simple_yaml(text, path)


def _parse_simple_yaml(text: str, path: Path) -> Dict[str, Any]:
    """Minimal YAML subset (flat + one-level nested mapping) — no PyYAML dependency."""
    root: Dict[str, Any] = {}
    stack: List[tuple[int, Dict[str, Any]]] = [(0, root)]
    for lineno, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if ":" not in line:
            raise ConfigError(f"invalid YAML at {path}:{lineno}: {raw!r}")
        key, _, rest = line.partition(":")
        key = key.strip()
        val = rest.strip()
        while len(stack) > 1 and indent < stack[-1][0]:
            stack.pop()
        cur = stack[-1][1]
        if val == "":
            nested: Dict[str, Any] = {}
            cur[key] = nested
            stack.append((indent + 1, nested))
        else:
            cur[key] = _yaml_scalar(val)
    return root


def _yaml_scalar(val: str) -> Any:
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        return val[1:-1]
    low = val.lower()
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    if low in ("null", "~"):
        return None
    try:
        if "." in val:
            return float(val)
        return int(val)
    except ValueError:
        return val


def _validate(cfg: LoggerConfig) -> None:
    if cfg.interval_ms < MIN_INTERVAL_MS:
        raise ConfigError(f"interval-ms must be >= {MIN_INTERVAL_MS}, got {cfg.interval_ms}")
    if cfg.retain_hours <= 0:
        raise ConfigError(f"retain-hours must be > 0, got {cfg.retain_hours}")


def load_config(argv: Optional[List[str]] = None) -> LoggerConfig:
    """Load defaults ← config file ← CLI overrides, then validate."""
    ns = parse_args(argv)
    file_data: Dict[str, Any] = {}
    if ns.config:
        path = Path(ns.config)
        if not path.is_file():
            raise ConfigError(f"config file not found: {path}")
        file_data = _load_file_dict(path)

    def pick(cli_val: Any, *keys: str, default: Any) -> Any:
        if cli_val is not None:
            return cli_val
        for k in keys:
            if k in file_data and file_data[k] is not None:
                return file_data[k]
        return default

    expected = dict(DEFAULT_EXPECTED)
    file_exp = file_data.get("expected")
    if isinstance(file_exp, Mapping):
        expected.update({str(k): str(v) for k, v in file_exp.items()})

    cfg = LoggerConfig(
        retain_hours=float(pick(ns.retain_hours, "retain_hours", "retain-hours", default=24.0)),
        interval_ms=int(pick(ns.interval_ms, "interval_ms", "interval-ms", default=200)),
        data_dir=str(pick(ns.data_dir, "data_dir", "data-dir", default="./data")),
        http_port=int(pick(ns.http_port, "http_port", "http-port", default=0)),
        config_path=ns.config,
        expected=expected,
        heartbeat_sec=float(
            pick(ns.heartbeat_sec, "heartbeat_sec", "heartbeat-sec", default=2.0)
        ),
        max_bytes=(
            int(ns.max_bytes)
            if ns.max_bytes is not None
            else (
                int(file_data["max_bytes"])
                if file_data.get("max_bytes") is not None
                else None
            )
        ),
        dry_run=bool(ns.dry_run),
        fake_source=(
            True
            if ns.fake_source
            else bool(pick(None, "fake_source", "fake-source", default=False))
        ),
        ticks=int(pick(ns.ticks, "ticks", default=0) or 0),
        profile=str(pick(ns.profile, "profile", default="4.x")),
        nats_max_failures=int(
            pick(None, "nats_max_failures", "nats-max-failures", default=5)
        ),
        nats_url=str(
            pick(ns.nats_url, "nats_url", "nats-url", default="nats://127.0.0.1:4222")
        ),
    )
    _validate(cfg)
    return cfg
