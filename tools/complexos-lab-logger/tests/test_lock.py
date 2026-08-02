"""Tests for PidLock / flock — second instance fails cleanly."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import _pathsetup  # noqa: F401

from sm_lab_logger.lock import LockError, PidLock


class TestPidLock(unittest.TestCase):
    def test_acquire_and_release(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab-logger.lock"
            lock = PidLock(path)
            lock.acquire()
            self.assertTrue(lock.held)
            self.assertTrue(path.exists())
            lock.release()
            self.assertFalse(lock.held)

    def test_second_instance_fails_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab-logger.lock"
            first = PidLock(path)
            first.acquire()
            try:
                second = PidLock(path)
                with self.assertRaises(LockError) as ctx:
                    second.acquire()
                msg = str(ctx.exception).lower()
                self.assertTrue(
                    "lock" in msg or "held" in msg or "busy" in msg or "pid" in msg,
                    msg=str(ctx.exception),
                )
            finally:
                first.release()

    def test_context_manager(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab-logger.lock"
            with PidLock(path) as lock:
                self.assertTrue(lock.held)
                with self.assertRaises(LockError):
                    PidLock(path).acquire()
            # After exit, another acquire works
            again = PidLock(path)
            again.acquire()
            again.release()

    def test_pid_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab-logger.lock"
            lock = PidLock(path)
            lock.acquire()
            try:
                self.assertEqual(lock.pid, lock.read_pid())
                self.assertTrue(str(lock.pid).isdigit() if lock.pid else False)
                # Owning handle can read payload (Windows locks byte 0 only)
                assert lock._fh is not None
                lock._fh.seek(0)
                raw = lock._fh.read().decode("utf-8", errors="ignore")
                self.assertIn(str(lock.pid), raw)
            finally:
                lock.release()


if __name__ == "__main__":
    unittest.main()
