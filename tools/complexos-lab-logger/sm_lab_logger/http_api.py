"""Localhost-only HTTP API: /lab/health, /lab/snapshot, /lab/events."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

HealthFn = Callable[[], Dict[str, Any]]
SnapshotFn = Callable[[], Dict[str, Any]]
EventsFn = Callable[[Optional[float], Optional[float]], List[Dict[str, Any]]]


class LabHttpServer:
    """Serve lab endpoints bound to 127.0.0.1 only (SSH tunnel from SM)."""

    def __init__(
        self,
        host: str,
        port: int,
        health_fn: HealthFn,
        snapshot_fn: SnapshotFn,
        events_fn: EventsFn,
    ) -> None:
        if host not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError(
                f"LabHttpServer must bind localhost only, got host={host!r}"
            )
        # Normalize localhost → 127.0.0.1 for IPv4 tests
        if host == "localhost":
            host = "127.0.0.1"
        self.host = host
        self._port_requested = int(port)
        self._health_fn = health_fn
        self._snapshot_fn = snapshot_fn
        self._events_fn = events_fn
        self._httpd: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self.port = 0

    def start(self) -> None:
        if self._httpd is not None:
            return
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
                return  # quiet in tests / field

            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                path = parsed.path.rstrip("/") or "/"
                if path == "/lab/health":
                    self._json(200, outer._health_fn())
                    return
                if path == "/lab/snapshot":
                    self._json(200, outer._snapshot_fn())
                    return
                if path == "/lab/events":
                    qs = parse_qs(parsed.query)
                    from_ts = _opt_float(qs.get("from", [None])[0])
                    to_ts = _opt_float(qs.get("to", [None])[0])
                    events = outer._events_fn(from_ts, to_ts)
                    self._json(200, {"events": events})
                    return
                self._json(404, {"error": "not found"})

            def _json(self, code: int, payload: Dict[str, Any]) -> None:
                raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(
                    "utf-8"
                )
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self._httpd = ThreadingHTTPServer((self.host, self._port_requested), Handler)
        self.port = int(self._httpd.server_address[1])
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._httpd is None:
            return
        self._httpd.shutdown()
        self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._httpd = None
        self._thread = None


def _opt_float(raw: Optional[str]) -> Optional[float]:
    if raw is None or raw == "":
        return None
    return float(raw)
