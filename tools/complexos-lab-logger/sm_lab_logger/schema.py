"""Event / snapshot models and series_key naming (SM chart compatible)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Union

SCHEMA_VERSION = 1


def series_key(module: str, name: str) -> str:
    """Same naming as @service-monitor/core `seriesKey(module, name)` → `milk.drain`."""
    return f"{module}.{name}"


@dataclass
class LabEvent:
    """One delta / sample record written to the ring."""

    ts: float
    kind: str
    module: str
    name: str
    value: Any
    v: int = SCHEMA_VERSION

    def series_key(self) -> str:
        return series_key(self.module, self.name)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "v": self.v,
            "ts": self.ts,
            "kind": self.kind,
            "module": self.module,
            "name": self.name,
            "value": self.value,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LabEvent":
        return cls(
            v=int(data.get("v", SCHEMA_VERSION)),
            ts=float(data["ts"]),
            kind=str(data["kind"]),
            module=str(data["module"]),
            name=str(data["name"]),
            value=data.get("value"),
        )

    @classmethod
    def from_json(cls, raw: str) -> "LabEvent":
        return cls.from_dict(json.loads(raw))


@dataclass
class Snapshot:
    """Periodic full snapshot (heartbeat) of series values."""

    ts: float
    values: Dict[str, Any] = field(default_factory=dict)
    kinds: Dict[str, str] = field(default_factory=dict)
    v: int = SCHEMA_VERSION
    kind: str = "snapshot"

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "v": self.v,
            "ts": self.ts,
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
        kinds = {str(k): str(v) for k, v in kinds_raw.items()} if isinstance(kinds_raw, dict) else {}
        return cls(
            v=int(data.get("v", SCHEMA_VERSION)),
            ts=float(data["ts"]),
            kind=str(data.get("kind", "snapshot")),
            values=dict(data.get("values") or {}),
            kinds=kinds,
        )

    @classmethod
    def from_json(cls, raw: str) -> "Snapshot":
        return cls.from_dict(json.loads(raw))


Record = Union[LabEvent, Snapshot]


def parse_record(raw: str) -> Optional[Record]:
    """Parse a jsonl line into LabEvent or Snapshot; unknown kinds with module/name → LabEvent."""
    raw = raw.strip()
    if not raw:
        return None
    data = json.loads(raw)
    kind = data.get("kind")
    if kind == "snapshot" or ("values" in data and "module" not in data):
        return Snapshot.from_dict(data)
    return LabEvent.from_dict(data)
