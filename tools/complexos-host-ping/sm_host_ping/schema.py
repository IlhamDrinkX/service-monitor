"""Minimal jsonl records for host up/down (compatible shape with lab-logger host events)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional, Union

SCHEMA_VERSION = 1

# Human-readable status strings written to jsonl (RU).
STATUS_ONLINE = "онлайн"
STATUS_OFFLINE = "оффлайн"

KIND_HOST = "host"
KIND_TRACE = "trace"
KIND_SNAPSHOT = "snapshot"
NAME_REACHABLE = "reachable"
NAME_TRACEROUTE = "traceroute"


def format_local_at(ts_ms: float) -> str:
    """Local wall time for logs: YYYY-MM-DDTHH:MM:SS (no timezone suffix)."""
    try:
        return datetime.fromtimestamp(float(ts_ms) / 1000.0).strftime(
            "%Y-%m-%dT%H:%M:%S"
        )
    except (OSError, OverflowError, ValueError):
        return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def status_from_up(up: bool) -> str:
    return STATUS_ONLINE if up else STATUS_OFFLINE


def coerce_reachable_up(value: Any) -> Optional[bool]:
    """Parse reachable value: 0/1, bool, or онлайн/оффлайн (RU/EN). None if unknown."""
    if value is True or value is False:
        return bool(value)
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(int(value))
    if isinstance(value, str):
        s = value.strip().lower()
        if s in ("1", "true", "online", "онлайн", "up"):
            return True
        if s in ("0", "false", "offline", "оффлайн", "down"):
            return False
    return None


@dataclass
class HostEvent:
    ts: float
    kind: str
    module: str
    name: str
    value: Any
    v: int = SCHEMA_VERSION
    at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        at = self.at or format_local_at(self.ts)
        return {
            "v": self.v,
            "ts": self.ts,
            "at": at,
            "kind": self.kind,
            "module": self.module,
            "name": self.name,
            "value": self.value,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "HostEvent":
        at_raw = data.get("at") or data.get("time")
        return cls(
            v=int(data.get("v", SCHEMA_VERSION)),
            ts=float(data["ts"]),
            at=str(at_raw) if at_raw is not None else None,
            kind=str(data["kind"]),
            module=str(data["module"]),
            name=str(data["name"]),
            value=data.get("value"),
        )


@dataclass
class Snapshot:
    ts: float
    values: Dict[str, Any] = field(default_factory=dict)
    kinds: Dict[str, str] = field(default_factory=dict)
    v: int = SCHEMA_VERSION
    kind: str = "snapshot"
    at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        at = self.at or format_local_at(self.ts)
        out: Dict[str, Any] = {
            "v": self.v,
            "ts": self.ts,
            "at": at,
            "kind": self.kind,
            "values": dict(self.values),
        }
        if self.kinds:
            out["kinds"] = dict(self.kinds)
        return out

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Snapshot":
        kinds_raw = data.get("kinds") or {}
        kinds = (
            {str(k): str(v) for k, v in kinds_raw.items()}
            if isinstance(kinds_raw, dict)
            else {}
        )
        at_raw = data.get("at") or data.get("time")
        return cls(
            v=int(data.get("v", SCHEMA_VERSION)),
            ts=float(data["ts"]),
            at=str(at_raw) if at_raw is not None else None,
            kind=str(data.get("kind", "snapshot")),
            values=dict(data.get("values") or {}),
            kinds=kinds,
        )


Record = Union[HostEvent, Snapshot]


def parse_record(raw: str) -> Optional[Record]:
    raw = raw.strip()
    if not raw:
        return None
    data = json.loads(raw)
    kind = data.get("kind")
    if kind == KIND_SNAPSHOT or ("values" in data and "module" not in data):
        return Snapshot.from_dict(data)
    return HostEvent.from_dict(data)
