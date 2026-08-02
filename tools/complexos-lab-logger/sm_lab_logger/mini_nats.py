"""Minimal synchronous NATS client — stdlib only, no `nats-py` / pip.

Why this exists (read before "helpfully" swapping it for `import nats` again):
complexos Raspberry Pi hosts have LAN access + a reverse SSH tunnel to the ERP
jump host, but typically **no general internet route to PyPI**. The previous
`NatsSource` required `import nats` (the `nats-py` package) and the installer
did a soft `pip install --user nats-py`, silently swallowing failure. On an
offline field Pi that pip install always fails, `import nats` then raises
`ImportError`, and `main.py` fell back to an idle loop that never polls and
never writes to the ring — matching the exact symptom reported in the field:
`/lab/health` says `source=idle`, `disk_bytes=0`, downloaded ring is empty.
This was a real regression against the plan's own stated principle
("stdlib-only Python 3.9+ MVP; NATS behind interface") — Phase 1.6 quietly
reintroduced an external dependency on the one thing the plan explicitly
called a field risk (`Pip on field: Prefer stdlib-only MVP`).

This module reimplements just enough of the NATS text protocol to do
synchronous request/reply, which is all `sm_lab_logger` ever needs (it never
subscribes to a long-lived subject, only asks status/valve/heater/pump
subjects and reads one reply). Wire protocol: https://docs.nats.io/reference/reference-protocols/nats-protocol
— text lines terminated by CRLF; INFO/CONNECT handshake once, then
SUB <subject> <sid> / UNSUB <sid> [max-msgs] / PUB <subject> [reply-to] <#bytes>\\r\\n<payload>\\r\\n,
server replies with MSG <subject> <sid> [reply-to] <#bytes>\\r\\n<payload>\\r\\n.

One TCP connection is reused across requests (like the old async client);
each request is a fresh unique inbox + sid, `UNSUB <sid> 1` auto-cleans the
subscription after exactly one message so nothing leaks across polls. Only
one request is ever in flight at a time — this is not just simplicity, it
matches the plan's own safety rule ("max concurrent NATS in-flight = 1",
serialize reads like SM's `commandChain`) which the previous
`asyncio.gather`-based implementation did not actually honor.
"""

from __future__ import annotations

import json
import socket
import time
import uuid
from typing import Any, Dict, Optional
from urllib.parse import urlparse


class NatsError(Exception):
    """Any NATS-level failure (connect, protocol, timeout, server -ERR)."""


class MiniNatsClient:
    """Synchronous NATS client: connect + request/reply only. Stdlib-only."""

    def __init__(
        self,
        url: str = "nats://127.0.0.1:4222",
        connect_timeout: float = 2.0,
    ) -> None:
        parsed = urlparse(url if "://" in url else f"nats://{url}")
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or 4222
        self.connect_timeout = connect_timeout
        self._sock: Optional[socket.socket] = None
        self._buf = b""
        self._sid = 0

    @property
    def connected(self) -> bool:
        return self._sock is not None

    def connect(self) -> None:
        """Open TCP connection + NATS INFO/CONNECT/PING handshake."""
        self.close()
        try:
            sock = socket.create_connection(
                (self.host, self.port), timeout=self.connect_timeout
            )
        except OSError as exc:
            raise NatsError(f"connect failed ({self.host}:{self.port}): {exc}") from exc
        sock.settimeout(self.connect_timeout)
        self._sock = sock
        self._buf = b""
        try:
            # Server greets with INFO {...} first — read and ignore contents
            # (we do not need auth/tls/max_payload negotiation for a plain
            # localhost NATS on complexos).
            self._read_line(self.connect_timeout)
            connect_json = json.dumps(
                {
                    "verbose": False,
                    "pedantic": False,
                    "lang": "python3",
                    "name": "sm-lab-logger",
                    "protocol": 1,
                }
            )
            self._write(f"CONNECT {connect_json}\r\n".encode("utf-8"))
            self._write(b"PING\r\n")
            self._await_pong(self.connect_timeout)
        except Exception:
            self.close()
            raise

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        self._sock = None
        self._buf = b""

    # -- low-level framing -------------------------------------------------

    def _write(self, data: bytes) -> None:
        assert self._sock is not None
        try:
            self._sock.sendall(data)
        except OSError as exc:
            self.close()
            raise NatsError(f"write failed: {exc}") from exc

    def _read_line(self, timeout: float) -> bytes:
        assert self._sock is not None
        deadline = time.monotonic() + max(0.001, timeout)
        while b"\r\n" not in self._buf:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise NatsError("timeout reading line")
            self._sock.settimeout(remaining)
            try:
                chunk = self._sock.recv(65536)
            except socket.timeout as exc:
                raise NatsError("timeout reading line") from exc
            except OSError as exc:
                self.close()
                raise NatsError(f"read failed: {exc}") from exc
            if not chunk:
                self.close()
                raise NatsError("connection closed by server")
            self._buf += chunk
        line, self._buf = self._buf.split(b"\r\n", 1)
        return line

    def _read_exact(self, n: int, timeout: float) -> bytes:
        assert self._sock is not None
        deadline = time.monotonic() + max(0.001, timeout)
        while len(self._buf) < n:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise NatsError("timeout reading payload")
            self._sock.settimeout(remaining)
            try:
                chunk = self._sock.recv(65536)
            except socket.timeout as exc:
                raise NatsError("timeout reading payload") from exc
            except OSError as exc:
                self.close()
                raise NatsError(f"read failed: {exc}") from exc
            if not chunk:
                self.close()
                raise NatsError("connection closed by server")
            self._buf += chunk
        data, self._buf = self._buf[:n], self._buf[n:]
        return data

    def _await_pong(self, timeout: float) -> None:
        deadline = time.monotonic() + max(0.001, timeout)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise NatsError("timeout waiting for PONG")
            line = self._read_line(remaining)
            if line == b"PONG":
                return
            if line == b"PING":
                self._write(b"PONG\r\n")
                continue
            if line.startswith(b"-ERR"):
                raise NatsError(f"server error: {line!r}")
            # Ignore anything else pre-handshake (extra INFO, etc.)

    # -- request/reply ------------------------------------------------------

    def request(
        self, subject: str, payload: Dict[str, Any], timeout: float
    ) -> Any:
        """Synchronous request/reply. Raises NatsError on any failure/timeout."""
        if self._sock is None:
            self.connect()
        self._sid += 1
        sid = str(self._sid)
        inbox = f"_INBOX.sm{uuid.uuid4().hex[:16]}"
        body = json.dumps(payload).encode("utf-8")
        # NOTE on error handling below: a plain "nothing replied before our
        # deadline" is the *normal* case here — most poll subjects legitimately
        # have no responder (e.g. a host missing an optional valve/heater), and
        # this happens on every tick against a perfectly healthy NATS server.
        # It must NOT tear down the TCP connection: `_write`/`_read_line`/
        # `_read_exact` already call `self.close()` themselves on a genuine
        # I/O failure (socket error, EOF), so by the time a bare `NatsError`
        # reaches here without the socket having been closed, it is safe (and
        # much cheaper) to just leave the connection open for the next
        # request. Reconnecting on every timeout was tried and made every
        # poll tick pay a full CONNECT/PING handshake per unanswered subject.
        self._write(f"SUB {inbox} {sid}\r\n".encode("utf-8"))
        # Auto-unsub after exactly one message — no leaked subscriptions
        # across poll ticks even if the reply never arrives.
        self._write(f"UNSUB {sid} 1\r\n".encode("utf-8"))
        self._write(f"PUB {subject} {inbox} {len(body)}\r\n".encode("utf-8"))
        self._write(body + b"\r\n")

        deadline = time.monotonic() + max(0.001, timeout)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise NatsError(f"request timeout: {subject}")
            line = self._read_line(remaining)
            if line.startswith(b"MSG"):
                parts = line.decode("ascii", errors="replace").split()
                # MSG <subject> <sid> [reply-to] <#bytes>
                got_sid = parts[2] if len(parts) > 2 else ""
                nbytes = int(parts[-1])
                remaining = deadline - time.monotonic()
                # Must drain the payload even if our deadline just passed —
                # otherwise these bytes desync the next request's framing.
                # Use a short floor timeout rather than the caller's timeout
                # so a slow/stuck peer still can't hang us indefinitely.
                drain_timeout = max(0.2, remaining)
                raw = self._read_exact(nbytes, drain_timeout)
                self._read_exact(2, drain_timeout)  # trailing CRLF
                if got_sid != sid:
                    # Late reply for an earlier, already-abandoned request
                    # (arrived after we gave up waiting on it) — discard and
                    # keep waiting for our own sid.
                    continue
                text = raw.decode("utf-8", errors="replace")
                if not text:
                    return {}
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return text
            if line == b"PING":
                self._write(b"PONG\r\n")
                continue
            if line.startswith(b"-ERR"):
                # Protocol-level server error (e.g. auth violation) — this one
                # really does mean the connection is in a bad state.
                self.close()
                raise NatsError(f"server error: {line!r}")
            # +OK / stray INFO — ignore, keep waiting for our MSG
