"""Soft-resolve MAC → IP via `ip neigh` / `arp` (complexos LAN)."""

from __future__ import annotations

import re
import subprocess
from typing import Optional

_MAC_RE = re.compile(
    r"^([0-9a-f]{2})([:\-.]?)([0-9a-f]{2})\2([0-9a-f]{2})\2"
    r"([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})$",
    re.I,
)


def normalize_mac(mac: str) -> Optional[str]:
    """Return canonical aa:bb:cc:dd:ee:ff or None if invalid."""
    s = (mac or "").strip().lower().replace("-", ":").replace(".", ":")
    if not s:
        return None
    # Collapse if already colon-separated or continuous hex
    if ":" not in s and len(s) == 12 and all(c in "0123456789abcdef" for c in s):
        s = ":".join(s[i : i + 2] for i in range(0, 12, 2))
    m = _MAC_RE.match(s.replace("-", ":"))
    if not m:
        # try loose split
        parts = re.split(r"[:\-.\s]+", s)
        if len(parts) != 6:
            return None
        try:
            parts = [f"{int(p, 16):02x}" for p in parts]
        except ValueError:
            return None
        return ":".join(parts)
    return ":".join(m.group(i) for i in (1, 3, 4, 5, 6, 7)).lower()


def _run_text(cmd: list[str], timeout: float = 2.0) -> str:
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
            text=True,
        )
        return proc.stdout or ""
    except (OSError, subprocess.SubprocessError):
        return ""


def resolve_mac_to_ip(mac: str) -> Optional[str]:
    """Best-effort: find IP for MAC in neighbor table. Soft-fail → None."""
    canon = normalize_mac(mac)
    if not canon:
        return None
    compact = canon.replace(":", "")
    variants = {canon, canon.upper(), compact, compact.upper()}

    for text in (
        _run_text(["ip", "neigh", "show"]),
        _run_text(["arp", "-an"]),
        _run_text(["arp", "-a"]),
    ):
        if not text:
            continue
        for line in text.splitlines():
            low = line.lower()
            hit = False
            for v in variants:
                if v.lower() in low:
                    hit = True
                    break
            if not hit:
                continue
            # IPv4
            m = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})", line)
            if m:
                return m.group(1)
    return None
