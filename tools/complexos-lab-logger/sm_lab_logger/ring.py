"""Append-only ring store with time + size trimming.

Single-process only: one writer owns the file (pair with pidfile/flock in later phases).
Not safe for multi-process concurrent writers.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, List, Optional, Union

from .schema import LabEvent, Record, Snapshot, parse_record

# Concurrent-safe enough for a single process (documented for tests / callers).
SINGLE_PROCESS = True


class RingStore:
    """JSONL ring: append events; trim by retain_hours (vs newest ts) and max_bytes.

    Single-process use only — not multi-writer safe. Use an external flock/pidfile
    so only one logger instance owns the data directory.
    """

    SINGLE_PROCESS = True

    def __init__(
        self,
        path: Union[str, Path],
        retain_hours: float = 24.0,
        max_bytes: Optional[int] = None,
    ) -> None:
        self.path = Path(path)
        self.retain_hours = float(retain_hours)
        self.max_bytes = max_bytes
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.touch()

    def append(self, record: Union[LabEvent, Snapshot, str]) -> None:
        line = record if isinstance(record, str) else record.to_json()
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line.rstrip("\n") + "\n")

    def _read_all_lines(self) -> List[str]:
        if not self.path.exists():
            return []
        text = self.path.read_text(encoding="utf-8")
        return [ln for ln in text.splitlines() if ln.strip()]

    def _parse_events(self, lines: Iterable[str]) -> List[LabEvent]:
        out: List[LabEvent] = []
        for ln in lines:
            rec = parse_record(ln)
            if isinstance(rec, LabEvent):
                out.append(rec)
        return out

    def events_since(self, ts: float) -> List[LabEvent]:
        """Return LabEvents with ``e.ts >= ts``, chronological.

        Deliberately **excludes** ``Snapshot`` heartbeat records — internal
        callers (retention bookkeeping, tests) want only state-change deltas.
        Realtime HTTP consumers (SM `/lab/events`) must use
        :meth:`records_since` instead, or heartbeats never reach them — see
        its docstring for why that used to be exactly the "curves disappear"
        field bug.
        """
        events = self._parse_events(self._read_all_lines())
        events = [e for e in events if e.ts >= ts]
        events.sort(key=lambda e: e.ts)
        return events

    def _parse_records(self, lines: Iterable[str]) -> List[Record]:
        out: List[Record] = []
        for ln in lines:
            rec = parse_record(ln)
            if rec is not None:
                out.append(rec)
        return out

    def records_since(self, ts: float) -> List[Record]:
        """Return LabEvents **and** Snapshot heartbeats with ``r.ts >= ts``.

        The onboard delta+heartbeat design (`DeltaEngine`) relies on a
        periodic full-state ``Snapshot`` to keep still-unchanged series alive
        for realtime consumers — a sensor that stops changing should still
        show up every ``heartbeat_sec`` so the chart doesn't go stale.
        ``events_since`` filters Snapshot records out entirely (by design,
        for internal callers that only want deltas); the realtime HTTP
        endpoint (`/lab/events`, polled by SM's chart window over SSH curl)
        used to reuse that same filtered method, so heartbeats **never**
        reached the chart at all — any series that stopped changing simply
        vanished from the realtime view forever once SM's render-side hold
        window elapsed (~8s), since no further record for that key would
        ever arrive again. Field symptom: "curves disappear after a while".
        Use this method for any consumer that must stay visually alive.
        """
        records = self._parse_records(self._read_all_lines())
        records = [r for r in records if r.ts >= ts]
        records.sort(key=lambda r: r.ts)
        return records

    def trim(self) -> None:
        """Drop lines older than retain_hours (relative to newest ts) and over max_bytes."""
        lines = self._read_all_lines()
        if not lines:
            return

        records = []
        for ln in lines:
            rec = parse_record(ln)
            if rec is None:
                continue
            records.append((ln, rec))

        if not records:
            self.path.write_text("", encoding="utf-8")
            return

        newest_ts = max(r.ts for _, r in records)
        retain_ms = self.retain_hours * 3_600_000.0
        cutoff = newest_ts - retain_ms
        kept = [(ln, r) for ln, r in records if r.ts >= cutoff]

        if self.max_bytes is not None and self.max_bytes > 0:
            # Drop oldest until encoded size fits.
            while kept:
                blob = "\n".join(ln for ln, _ in kept) + ("\n" if kept else "")
                if len(blob.encode("utf-8")) <= self.max_bytes:
                    break
                kept = kept[1:]

        blob = "\n".join(ln for ln, _ in kept)
        if blob:
            blob += "\n"
        self.path.write_text(blob, encoding="utf-8")
