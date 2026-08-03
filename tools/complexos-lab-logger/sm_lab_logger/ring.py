"""Append-only ring store with time + size trimming.

Single-process only: one writer owns the file (pair with pidfile/flock in later phases).
Not safe for multi-process concurrent writers.
"""

from __future__ import annotations

import bisect
import threading
from pathlib import Path
from typing import List, Optional, Tuple, Union

from .schema import LabEvent, Record, Snapshot, parse_record

# Concurrent-safe enough for a single process (documented for tests / callers).
SINGLE_PROCESS = True


class RingStore:
    """JSONL ring: append events; trim by retain_hours (vs newest ts) and max_bytes.

    Single-process use only — not multi-writer safe. Use an external flock/pidfile
    so only one logger instance owns the data directory.

    Reads (`events_since`/`records_since`) are served from an in-memory cache
    kept in lockstep with the file by `append()`/`trim()`, instead of
    re-reading and re-JSON-parsing the whole file on every call. `/lab/events`
    is polled by SM's realtime chart every ~1.5s over SSH curl (8s client
    timeout); with the old disk-rescan approach, cost grew with ring size
    (retain_hours=24 by default means real field rings reach tens of MB), and
    once a poll took longer than curl's timeout the chart saw a silent
    "0 bytes received" — looked like an SSH/network problem but was actually
    this handler doing O(ring size) work on every single poll.
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
        self._lock = threading.Lock()
        # (raw_line_without_trailing_newline, parsed_record), sorted by ts —
        # a parallel `_cache_ts` list enables bisect for the since-cursor
        # lookup instead of a full linear scan on every poll.
        self._cache: List[Tuple[str, Record]] = []
        self._cache_ts: List[float] = []
        if not self.path.exists():
            self.path.touch()
        else:
            self._reload_cache_from_disk()

    def _reload_cache_from_disk(self) -> None:
        """One-time full parse at startup (or after an external file change).

        Cheap relative to the field cost this fixes: paid once per process
        start, not on every ~1.5s HTTP poll.
        """
        cache: List[Tuple[str, Record]] = []
        for ln in self._read_all_lines():
            rec = parse_record(ln)
            if rec is not None:
                cache.append((ln, rec))
        self._cache = cache
        self._cache_ts = [rec.ts for _ln, rec in cache]

    def append(self, record: Union[LabEvent, Snapshot, str]) -> None:
        line = (record if isinstance(record, str) else record.to_json()).rstrip("\n")
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        rec = parse_record(line) if isinstance(record, str) else record
        if rec is not None:
            with self._lock:
                self._cache.append((line, rec))
                self._cache_ts.append(rec.ts)

    def _read_all_lines(self) -> List[str]:
        if not self.path.exists():
            return []
        text = self.path.read_text(encoding="utf-8")
        return [ln for ln in text.splitlines() if ln.strip()]

    def _cache_tail(self, ts: float) -> List[Record]:
        """Records with ``r.ts >= ts`` from the in-memory cache, via bisect

        instead of a linear scan — `_cache_ts` is non-decreasing because
        appends happen in chronological order (single writer, one poll tick
        at a time).
        """
        with self._lock:
            i = bisect.bisect_left(self._cache_ts, ts)
            return [rec for _ln, rec in self._cache[i:]]

    def events_since(self, ts: float) -> List[LabEvent]:
        """Return LabEvents with ``e.ts >= ts``, chronological.

        Deliberately **excludes** ``Snapshot`` heartbeat records — internal
        callers (retention bookkeeping, tests) want only state-change deltas.
        Realtime HTTP consumers (SM `/lab/events`) must use
        :meth:`records_since` instead, or heartbeats never reach them — see
        its docstring for why that used to be exactly the "curves disappear"
        field bug.
        """
        events = [r for r in self._cache_tail(ts) if isinstance(r, LabEvent)]
        events.sort(key=lambda e: e.ts)
        return events

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

        Served from the in-memory cache (see class docstring) — this is the
        method `/lab/events` calls on every ~1.5s poll, so it must stay cheap
        regardless of how large the ring on disk has grown.
        """
        records = self._cache_tail(ts)
        records.sort(key=lambda r: r.ts)
        return records

    def trim(self) -> None:
        """Drop lines older than retain_hours (relative to newest ts) and over max_bytes."""
        with self._lock:
            records = list(self._cache)

        if not records:
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

        with self._lock:
            self._cache = kept
            self._cache_ts = [r.ts for _ln, r in kept]
