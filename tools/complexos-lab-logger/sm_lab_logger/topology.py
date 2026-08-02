"""Expected vs discovered module IPs → topology warnings."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional


# Last-octet expectations (LAN prefix may vary); also accept full IPs in config.
DEFAULT_EXPECTED: Dict[str, str] = {
    "milk": "192.168.1.44",
    "coffee": "192.168.1.45",
    "water": "192.168.1.46",
}


@dataclass
class TopologyCheck:
    warnings: List[str] = field(default_factory=list)


def _host_key(ip: str) -> str:
    """Normalize for comparison: full IP or trailing octet (.44 / 44)."""
    ip = (ip or "").strip()
    if not ip:
        return ""
    if ip.startswith("."):
        return ip
    parts = ip.split(".")
    if len(parts) == 1 and parts[0].isdigit():
        return f".{parts[0]}"
    return ip


def _same_endpoint(a: str, b: str) -> bool:
    ka, kb = _host_key(a), _host_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    # Compare last octet if either side is suffix-only
    def octet(x: str) -> Optional[str]:
        if x.startswith("."):
            return x[1:]
        parts = x.split(".")
        return parts[-1] if parts else None

    oa, ob = octet(ka), octet(kb)
    if oa is not None and ob is not None and (ka.startswith(".") or kb.startswith(".")):
        return oa == ob
    return False


def check_topology(
    discovered: Mapping[str, str],
    expected: Optional[Mapping[str, str]] = None,
) -> TopologyCheck:
    """Compare discovered role→IP map to expected; emit role-mismatch warnings."""
    exp = dict(expected or DEFAULT_EXPECTED)
    warnings: List[str] = []

    # Direct role vs expected IP
    for role, want in exp.items():
        got = discovered.get(role)
        if got is None:
            warnings.append(f"missing role {role}: expected {want}")
            continue
        if not _same_endpoint(got, want):
            warnings.append(
                f"role mismatch: {role} at {got}, expected {want}"
            )

    # Cross-role: discovered IP matches another role's expected address
    for role, got in discovered.items():
        for other_role, want in exp.items():
            if other_role == role:
                continue
            if _same_endpoint(got, want):
                msg = (
                    f"role mismatch: {role} discovered on {got} "
                    f"(expected address of {other_role}={want})"
                )
                if msg not in warnings:
                    warnings.append(msg)

    return TopologyCheck(warnings=warnings)
