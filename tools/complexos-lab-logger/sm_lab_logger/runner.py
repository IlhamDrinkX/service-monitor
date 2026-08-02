"""One soft-fail poll tick: source → delta → ring; update watchdog."""

from __future__ import annotations

from typing import List, Union

from .delta import DeltaEngine
from .ring import RingStore
from .schema import LabEvent, Snapshot
from .watchdog import Watchdog

Record = Union[LabEvent, Snapshot]


def run_tick(
    source,
    engine: DeltaEngine,
    ring: RingStore,
    watchdog: Watchdog,
    now_ms: float,
) -> List[Record]:
    """Poll once; on error record failure and return [] (soft fail, never crash).

    Serialized: single in-flight poll — do not call concurrently for the same source.
    Gates DX HTTP via ``source.set_dx_allowed(watchdog.dx_allowed)`` when present.
    """
    set_dx = getattr(source, "set_dx_allowed", None)
    if callable(set_dx):
        try:
            set_dx(watchdog.dx_allowed)
        except Exception:
            pass

    try:
        samples = source.poll()
    except Exception:
        watchdog.record_failure()
        return []

    watchdog.record_success()
    records = engine.process(list(samples or []), now_ms=now_ms)
    for rec in records:
        ring.append(rec)
    return records
