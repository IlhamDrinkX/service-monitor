"""DrinkX module device map — mirrors @service-monitor/core MODULE_VALVES / HEATER_IDS."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

HOSTS: Tuple[str, ...] = ("milk", "coffee", "water")

# Same base ids as packages/core/src/nats/module-devices.ts MODULE_VALVES
MODULE_VALVES: Dict[str, List[str]] = {
    "water": ["milkInput", "drain", "dump"],
    "milk": ["milkInput", "waterInput", "drain", "dump", "drysideValve", "air"],
    "coffee": ["milkInput", "waterInput", "drain", "dump", "drysideValve", "air"],
}

HEATER_IDS: Tuple[str, ...] = ("heater1", "heater2")

# Local LAN DX UI (:8000) — same etalon IPs as SM Modules / topology
DEFAULT_DX_HTTP: Dict[str, str] = {
    "milk": "http://192.168.1.44:8000/",
    "coffee": "http://192.168.1.45:8000/",
    "water": "http://192.168.1.46:8000/",
}

# Same canonical temp keys as packages/core/src/nats/module-devices.ts
# TEMP_SENSOR_ORDER — facade sensor names are role-prefixed on the wire
# (e.g. `milk_heater1_out`, `water_water_pressure`; see BACKEND_PROTOCOL.md
# §"cm-drv sensors"), matched here by suffix exactly like the JS side.
TEMP_SENSOR_ORDER: Tuple[str, ...] = (
    "input",
    "heater1_out",
    "heater2_out",
    "heater1_overheat",
    "heater2_overheat",
)


def normalize_temp_key(name: str) -> Optional[str]:
    """Mirror core `normalizeTempKey` — role-prefixed sensor name → canonical key."""
    n = (name or "").lower()
    for key in TEMP_SENSOR_ORDER:
        if n == key or n.endswith(key) or n.endswith(key.replace("_", "")):
            return key
    if "input" in n or n.endswith("_in") or n == "in":
        return "input"
    if "heater1" in n and "over" in n:
        return "heater1_overheat"
    if "heater2" in n and "over" in n:
        return "heater2_overheat"
    if "heater1" in n and "out" in n:
        return "heater1_out"
    if "heater2" in n and "out" in n:
        return "heater2_out"
    return None


def valve_status_subject(host: str, base_id: str) -> str:
    return f"valves.status.{host}-{base_id}"


def pump_status_subject(host: str) -> str:
    return f"pumps.status.{host}"


def heater_status_subject(host: str, heater_id: str) -> str:
    return f"heaters.status.{host}-{heater_id}"


def default_hwid(host: str) -> str:
    return f"dx.{host}"
