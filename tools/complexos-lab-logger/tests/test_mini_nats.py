"""Tests for the stdlib-only mini NATS client (no `nats-py` / internet dep).

Uses a tiny in-process mock NATS server (raw socket, minimal wire protocol)
so these tests never touch a real NATS binary or network — same spirit as
the rest of this package's stdlib-first testing.
"""

from __future__ import annotations

import json
import socket
import threading
import time
import unittest

import _pathsetup  # noqa: F401

from sm_lab_logger.mini_nats import MiniNatsClient, NatsError


class _MockNatsServer:
    """Single-connection mock NATS server: INFO/CONNECT/PING + SUB/PUB/MSG.

    ``responses`` maps a request subject -> reply payload (dict). On PUB to
    a known subject with a reply-to inbox the client already SUB'd to, sends
    back one MSG on that inbox. Unknown subjects get no reply (→ client-side
    timeout), exercising the soft-fail path.
    """

    def __init__(self, responses=None, reply_delay=0.0, send_spurious_ping=False):
        self.responses = dict(responses or {})
        self.reply_delay = reply_delay
        self.send_spurious_ping = send_spurious_ping
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(1)
        self.port = self._sock.getsockname()[1]
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._stopped = False

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stopped = True
        try:
            self._sock.close()
        except OSError:
            pass
        self._thread.join(timeout=2)

    def _serve(self) -> None:
        try:
            self._sock.settimeout(5)
            conn, _ = self._sock.accept()
        except OSError:
            return
        conn.settimeout(5)
        buf = b""
        subs = {}
        try:
            conn.sendall(b"INFO {\"server_id\":\"mock\"}\r\n")
            while not self._stopped:
                while b"\r\n" not in buf:
                    chunk = conn.recv(65536)
                    if not chunk:
                        return
                    buf += chunk
                line, buf = buf.split(b"\r\n", 1)
                if line.startswith(b"CONNECT") or line.startswith(b"+OK"):
                    continue
                if line == b"PING":
                    conn.sendall(b"PONG\r\n")
                    continue
                if line == b"PONG":
                    continue
                if line.startswith(b"SUB"):
                    parts = line.decode().split()
                    subs[parts[1]] = parts[2]
                    continue
                if line.startswith(b"UNSUB"):
                    continue
                if line.startswith(b"PUB"):
                    parts = line.decode().split()
                    subject = parts[1]
                    reply_to = parts[2] if len(parts) > 3 else None
                    nbytes = int(parts[-1])
                    while len(buf) < nbytes + 2:
                        chunk = conn.recv(65536)
                        if not chunk:
                            return
                        buf += chunk
                    buf = buf[nbytes + 2 :]  # discard payload + trailing CRLF
                    if self.reply_delay:
                        time.sleep(self.reply_delay)
                    if self.send_spurious_ping:
                        conn.sendall(b"PING\r\n")
                        # Client must PONG back before we continue; read it.
                        while b"\r\n" not in buf:
                            chunk = conn.recv(65536)
                            if not chunk:
                                return
                            buf += chunk
                        pong_line, buf = buf.split(b"\r\n", 1)
                        assert pong_line == b"PONG"
                    if reply_to and subject in self.responses and reply_to in subs:
                        sid = subs[reply_to]
                        body = json.dumps(self.responses[subject]).encode("utf-8")
                        conn.sendall(
                            f"MSG {reply_to} {sid} {len(body)}\r\n".encode("utf-8")
                            + body
                            + b"\r\n"
                        )
                    continue
        finally:
            try:
                conn.close()
            except OSError:
                pass


class TestMiniNatsRoundtrip(unittest.TestCase):
    def test_request_reply_roundtrip(self) -> None:
        server = _MockNatsServer(
            responses={"coffeemachine.status": {"result": {"milkValves": [1]}}}
        )
        server.start()
        try:
            client = MiniNatsClient(url=f"nats://127.0.0.1:{server.port}")
            reply = client.request("coffeemachine.status", {"hwid": "dx"}, timeout=2.0)
            self.assertEqual(reply, {"result": {"milkValves": [1]}})
            client.close()
        finally:
            server.stop()

    def test_multiple_sequential_requests_reuse_connection(self) -> None:
        server = _MockNatsServer(
            responses={
                "pumps.status.milk": {"enabled": True, "power": 80},
                "pumps.status.coffee": {"enabled": False, "power": 0},
            }
        )
        server.start()
        try:
            client = MiniNatsClient(url=f"nats://127.0.0.1:{server.port}")
            r1 = client.request("pumps.status.milk", {"hwid": "dx.milk"}, timeout=2.0)
            r2 = client.request("pumps.status.coffee", {"hwid": "dx.coffee"}, timeout=2.0)
            self.assertTrue(client.connected)
            self.assertEqual(r1["power"], 80)
            self.assertEqual(r2["power"], 0)
            client.close()
            self.assertFalse(client.connected)
        finally:
            server.stop()

    def test_spurious_ping_is_answered_without_breaking_reply(self) -> None:
        server = _MockNatsServer(
            responses={"heaters.status.milk-heater1": {"enabled": True}},
            send_spurious_ping=True,
        )
        server.start()
        try:
            client = MiniNatsClient(url=f"nats://127.0.0.1:{server.port}")
            reply = client.request(
                "heaters.status.milk-heater1", {"hwid": "dx.milk"}, timeout=2.0
            )
            self.assertEqual(reply, {"enabled": True})
            client.close()
        finally:
            server.stop()

    def test_timeout_when_no_responder(self) -> None:
        server = _MockNatsServer(responses={})  # nothing ever replies
        server.start()
        try:
            client = MiniNatsClient(url=f"nats://127.0.0.1:{server.port}")
            with self.assertRaises(NatsError):
                client.request("valves.status.milk-drain", {"hwid": "dx.milk"}, timeout=0.3)
            client.close()
        finally:
            server.stop()

    def test_timeout_does_not_close_connection_for_next_request(self) -> None:
        """Regression: a per-subject timeout (no responder — the normal case
        for most poll subjects on any given tick) must not force a
        reconnect. The mock server here only ever accepts ONE connection, so
        this test would hang/fail if the client tried to redial after the
        first timeout."""
        server = _MockNatsServer(
            responses={"pumps.status.milk": {"enabled": True, "power": 42}}
        )
        server.start()
        try:
            client = MiniNatsClient(url=f"nats://127.0.0.1:{server.port}")
            with self.assertRaises(NatsError):
                client.request("valves.status.water-drain", {"hwid": "dx.water"}, timeout=0.3)
            self.assertTrue(client.connected, "timeout must not close the socket")
            with self.assertRaises(NatsError):
                client.request("valves.status.milk-air", {"hwid": "dx.milk"}, timeout=0.3)
            self.assertTrue(client.connected)
            reply = client.request("pumps.status.milk", {"hwid": "dx.milk"}, timeout=2.0)
            self.assertEqual(reply, {"enabled": True, "power": 42})
            client.close()
        finally:
            server.stop()

    def test_connect_refused_raises_nats_error(self) -> None:
        # Nothing listens on this port — connection must fail fast, not hang.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            free_port = probe.getsockname()[1]
        client = MiniNatsClient(url=f"nats://127.0.0.1:{free_port}", connect_timeout=1.0)
        with self.assertRaises(NatsError):
            client.request("coffeemachine.status", {"hwid": "dx"}, timeout=1.0)


if __name__ == "__main__":
    unittest.main()
