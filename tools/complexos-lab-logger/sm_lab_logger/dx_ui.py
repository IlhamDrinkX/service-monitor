"""Parse DX UI HTML (:8000) — same fields as packages/core dx-ui-stat.ts."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Tuple
from urllib.error import URLError
from urllib.request import Request, urlopen

_PUMP_R_RE = re.compile(
    r'"pump_R_IS"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)'
)
_PUMP_L_RE = re.compile(
    r'"pump_L_IS"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)'
)
_STAT_DIV_RE = re.compile(r"<div>\s*(\{[\s\S]*?\})\s*</div>")


def _num(v: Any) -> Optional[float]:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n:  # NaN
        return None
    return n


def parse_dx_ui_stat_html(html: str) -> Optional[Dict[str, float]]:
    if not html:
        return None
    m = _STAT_DIV_RE.search(html)
    if not m:
        return None
    try:
        raw = json.loads(m.group(1))
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None
    out: Dict[str, float] = {}
    for k, v in raw.items():
        n = _num(v)
        if n is not None:
            out[str(k)] = n
    return out or None


def extract_json_array_after(html: str, marker: str) -> Optional[Any]:
    start = html.find(marker)
    if start < 0:
        return None
    i = start + len(marker)
    while i < len(html) and html[i].isspace():
        i += 1
    if i >= len(html) or html[i] != "[":
        return None
    depth = 0
    from_i = i
    while i < len(html):
        c = html[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[from_i : i + 1])
                except json.JSONDecodeError:
                    return None
        i += 1
    return None


def parse_dx_ui_graph_last_row(html: str) -> Optional[list]:
    data = extract_json_array_after(html, "let data =")
    if not isinstance(data, list) or not data:
        return None
    last = data[-1]
    if not isinstance(last, list):
        return None
    return [_num(x) for x in last]


def parse_dx_ui_snapshot(html: str) -> Dict[str, Optional[float]]:
    empty = {
        "pump_R_IS": None,
        "pump_L_IS": None,
        "heater1_pwm": None,
        "heater2_pwm": None,
    }
    if not html:
        return dict(empty)
    r_m = _PUMP_R_RE.search(html)
    l_m = _PUMP_L_RE.search(html)
    stat = parse_dx_ui_stat_html(html)
    row = parse_dx_ui_graph_last_row(html)
    pump_r = (
        _num(r_m.group(1) if r_m else None)
        or (stat.get("pump_R_IS") if stat else None)
        or (stat.get("pump_r_is") if stat else None)
        or (row[12] if row and len(row) > 12 else None)
    )
    pump_l = (
        _num(l_m.group(1) if l_m else None)
        or (stat.get("pump_L_IS") if stat else None)
        or (stat.get("pump_l_is") if stat else None)
        or (row[13] if row and len(row) > 13 else None)
    )
    return {
        "pump_R_IS": pump_r,
        "pump_L_IS": pump_l,
        "heater1_pwm": row[6] if row and len(row) > 6 else None,
        "heater2_pwm": row[11] if row and len(row) > 11 else None,
    }


def dx_ui_snapshot_has_data(snap: Dict[str, Optional[float]]) -> bool:
    return any(snap.get(k) is not None for k in ("pump_R_IS", "pump_L_IS", "heater1_pwm", "heater2_pwm"))


def fetch_dx_ui_html(url: str, timeout_s: float = 1.5, max_bytes: int = 96_000) -> str:
    """Soft HTTP GET of DX UI page head (temps/stat enough for currents)."""
    req = Request(url, headers={"User-Agent": "sm-lab-logger/0.2"})
    with urlopen(req, timeout=timeout_s) as resp:  # noqa: S310 — local LAN only
        raw = resp.read(max_bytes)
    return raw.decode("utf-8", errors="replace")


def fetch_dx_ui_snapshot(
    url: str, timeout_s: float = 1.5
) -> Tuple[Dict[str, Optional[float]], Optional[str]]:
    """Return (snapshot, error). Soft-fail: never raise to caller."""
    try:
        html = fetch_dx_ui_html(url, timeout_s=timeout_s)
        snap = parse_dx_ui_snapshot(html)
        if not dx_ui_snapshot_has_data(snap):
            return snap, f"empty DX UI ({url})"
        return snap, None
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        return {
            "pump_R_IS": None,
            "pump_L_IS": None,
            "heater1_pwm": None,
            "heater2_pwm": None,
        }, str(exc)
