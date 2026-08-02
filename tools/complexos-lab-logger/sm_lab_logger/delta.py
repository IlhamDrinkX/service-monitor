"""DeltaEngine — emit state changes + periodic full-snapshot heartbeat."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from .schema import LabEvent, Snapshot

Record = Union[LabEvent, Snapshot]


class DeltaEngine:
    """Track last values; emit only changes; periodic Snapshot heartbeat."""

    def __init__(
        self,
        heartbeat_sec: float = 2.0,
        heartbeat_on_first: bool = False,
    ) -> None:
        self.heartbeat_sec = float(heartbeat_sec)
        self.heartbeat_on_first = bool(heartbeat_on_first)
        self._state: Dict[str, Any] = {}
        self._kinds: Dict[str, str] = {}
        self._last_heartbeat_ms: Optional[float] = None

    def state(self) -> Dict[str, Any]:
        return dict(self._state)

    def kinds(self) -> Dict[str, str]:
        return dict(self._kinds)

    def process(self, samples: List[LabEvent], now_ms: float) -> List[Record]:
        out: List[Record] = []
        for ev in samples:
            key = ev.series_key()
            prev = self._state.get(key, _MISSING)
            self._kinds[key] = ev.kind
            if prev is _MISSING or prev != ev.value:
                self._state[key] = ev.value
                out.append(
                    LabEvent(
                        ts=ev.ts,
                        kind=ev.kind,
                        module=ev.module,
                        name=ev.name,
                        value=ev.value,
                        v=ev.v,
                    )
                )
            else:
                # Touch state even when equal (already same)
                self._state[key] = ev.value

        need_hb = False
        if self._last_heartbeat_ms is None:
            if self.heartbeat_on_first:
                need_hb = True
        else:
            elapsed_ms = now_ms - self._last_heartbeat_ms
            if elapsed_ms >= self.heartbeat_sec * 1000.0:
                need_hb = True

        if need_hb and self._state:
            out.append(
                Snapshot(
                    ts=now_ms,
                    values=dict(self._state),
                    kinds=dict(self._kinds),
                )
            )
            self._last_heartbeat_ms = now_ms
        elif self._last_heartbeat_ms is None and not self.heartbeat_on_first:
            # Start heartbeat clock on first process even without emitting
            self._last_heartbeat_ms = now_ms

        return out


class _Missing:
    pass


_MISSING = _Missing()
