"""Single-writer PidLock (flock on Unix, msvcrt on Windows)."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional, Union


class LockError(RuntimeError):
    """Raised when another logger instance already holds the data-dir lock."""


class PidLock:
    """Exclusive lock for the lab-logger data directory.

    Second instance fails cleanly with ``LockError`` (no dual writers on the ring).
    """

    def __init__(self, path: Union[str, Path]) -> None:
        self.path = Path(path)
        self._fh: Optional[object] = None
        self._held = False
        self.pid: Optional[int] = None

    @property
    def held(self) -> bool:
        return self._held

    def acquire(self) -> None:
        if self._held:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(self.path, "a+b")
        try:
            self._try_lock(fh)
        except Exception:
            fh.close()
            raise
        self._fh = fh
        self.pid = os.getpid()
        self._write_pid(fh, self.pid)
        self._held = True

    def _write_pid(self, fh, pid: int) -> None:
        """Write pid via the owning handle (Windows may deny other readers on lock byte)."""
        payload = f"{pid}\n".encode("utf-8")
        if sys.platform == "win32":
            # Byte 0 stays under msvcrt lock; pid text starts at offset 1.
            fh.seek(1)
            fh.write(payload)
            fh.truncate()
            fh.flush()
            return
        fh.seek(0)
        fh.truncate()
        fh.write(payload)
        fh.flush()

    def read_pid(self) -> Optional[int]:
        """Best-effort pid from lock file (owning handle preferred on Windows)."""
        if self.pid is not None:
            return self.pid
        try:
            text = self.path.read_text(encoding="utf-8").strip()
            # Windows layout: \0 + "pid\n"
            text = text.lstrip("\x00").strip()
            return int(text) if text.isdigit() else None
        except (OSError, ValueError, PermissionError):
            return None

    def _try_lock(self, fh) -> None:
        if sys.platform == "win32":
            import msvcrt

            try:
                fh.seek(0, os.SEEK_END)
                size = fh.tell()
                if size < 1:
                    fh.seek(0)
                    fh.write(b"\0")
                    fh.flush()
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            except (OSError, PermissionError) as exc:
                raise LockError(
                    f"lab-logger lock held by another process: {self.path}"
                ) from exc
            return

        import fcntl

        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError) as exc:
            raise LockError(
                f"lab-logger lock held by another process: {self.path}"
            ) from exc

    def release(self) -> None:
        if not self._held or self._fh is None:
            self._held = False
            return
        fh = self._fh
        try:
            if sys.platform == "win32":
                import msvcrt

                try:
                    fh.seek(0)
                    msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
                except (OSError, PermissionError):
                    pass
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        finally:
            try:
                fh.close()
            except OSError:
                pass
            self._fh = None
            self._held = False
            self.pid = None

    def __enter__(self) -> "PidLock":
        self.acquire()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()
