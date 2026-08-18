"""Append-only jsonl ring with time retention (stdlib)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import List, Optional, Union

from .schema import HostEvent, Record, Snapshot, parse_record


class RingStore:
    def __init__(
        self,
        path: Union[str, Path],
        retain_hours: float = 24.0 * 14,
        max_bytes: Optional[int] = None,
    ) -> None:
        self.path = Path(path)
        self.retain_hours = float(retain_hours)
        self.max_bytes = max_bytes
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.touch()

    def append(self, record: Union[HostEvent, Snapshot, str]) -> None:
        line = (record if isinstance(record, str) else record.to_json()).rstrip("\n")
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    def _read_all(self) -> List[Record]:
        if not self.path.exists():
            return []
        out: List[Record] = []
        for ln in self.path.read_text(encoding="utf-8").splitlines():
            if not ln.strip():
                continue
            try:
                rec = parse_record(ln)
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                continue
            if rec is not None:
                out.append(rec)
        return out

    def events_since(self, ts: float) -> List[HostEvent]:
        return [r for r in self._read_all() if isinstance(r, HostEvent) and r.ts >= ts]

    def records_since(self, ts: float) -> List[Record]:
        return [r for r in self._read_all() if r.ts >= ts]

    def trim(self, now_ms: Optional[float] = None) -> None:
        wall = float(now_ms) if now_ms is not None else time.time() * 1000.0
        cutoff = wall - self.retain_hours * 3_600_000.0
        all_records = self._read_all()
        kept = [(r.to_json(), r) for r in all_records if r.ts >= cutoff]
        # Never rewrite unless there's actually something to drop.
        if len(kept) == len(all_records):
            return
        if self.max_bytes is not None and self.max_bytes > 0:
            while len(kept) > 1:
                blob = "\n".join(ln for ln, _ in kept) + "\n"
                if len(blob.encode("utf-8")) <= self.max_bytes:
                    break
                kept = kept[1:]
        blob = "\n".join(ln for ln, _ in kept)
        if blob:
            blob += "\n"
        # Write atomically via a temp file to avoid truncation on error.
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(blob, encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
