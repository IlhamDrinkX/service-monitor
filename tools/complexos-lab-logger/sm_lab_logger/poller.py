"""TelemetrySource interface + FakeSource + NatsSource (Modules parity).

NATS lives behind this interface so tests use FakeSource / mocks. Real NATS
uses :mod:`sm_lab_logger.mini_nats` — a stdlib-only synchronous client, no
pip / internet dependency (field Pi hosts usually cannot reach PyPI; see
mini_nats.py for the incident this fixes). Soft-fail on any NatsError —
never crash cm-drv.

Poll set mirrors SM LabTelemetryController / Modules series-4 charts:
- facade coffeemachine.status {hwid:dx} → temps + milkSystem msValve* + water pressure
- valves.status.{host}-{baseId} for every MODULE_VALVES id (seriesKey = milk.drain)
- heaters.status.{host}-{heaterId} → heater + estimated heaterN_pwm
- pumps.status.{host} → pump + pumpPower
- DX HTTP :8000 on .44/.45/.46 → pumpCurrent / pumpCurrentL only (when dx_allowed).
  Heater PWM is deliberately NOT read from the DX pid-graph — see
  `_events_from_dx_snapshot` docstring; it comes solely from the
  heaters.status-based estimate above.

Serialized ticks: callers must not overlap ``poll()`` (in-flight max = 1).
NatsSource itself is also internally sequential (one NATS request at a time).
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Mapping, Optional, Protocol, runtime_checkable

from .devices import (
    DEFAULT_DX_HTTP,
    HEATER_IDS,
    HOSTS,
    MODULE_VALVES,
    default_hwid,
    heater_status_subject,
    normalize_temp_key,
    pump_status_subject,
    valve_status_subject,
)
from .dx_ui import fetch_dx_ui_snapshot
from .mini_nats import MiniNatsClient, NatsError
from .schema import LabEvent


@runtime_checkable
class TelemetrySource(Protocol):
    """Poll current samples (full or partial state). Soft-fail at the runner layer."""

    def poll(self) -> List[LabEvent]:
        """Return current LabEvent samples. Empty list = nothing new / idle."""
        ...


class FakeSource:
    """Scripted / pushable source for tests and ``--fake-source`` local runs."""

    def __init__(self, frames: Optional[List[List[LabEvent]]] = None) -> None:
        self._frames: List[List[LabEvent]] = [list(f) for f in (frames or [])]
        self._idx = 0

    def push(self, events: List[LabEvent]) -> None:
        self._frames.append(list(events))

    def poll(self) -> List[LabEvent]:
        if self._idx >= len(self._frames):
            return []
        frame = self._frames[self._idx]
        self._idx += 1
        return list(frame)


def _as_mapping(data: Any) -> Dict[str, Any]:
    if isinstance(data, dict):
        result = data.get("result")
        if isinstance(result, dict):
            return result
        return data
    return {}


def _extract_enabled(payload: Any) -> Optional[bool]:
    """Mirror core extractEnabledState."""
    if not isinstance(payload, dict):
        return None
    result = payload.get("result") if isinstance(payload.get("result"), dict) else None
    src = result if result is not None else payload
    direct = src.get("enabled") if isinstance(src, dict) else None
    if isinstance(direct, bool):
        return direct
    if result and isinstance(result.get("result"), dict):
        nested = result["result"].get("enabled")
        if isinstance(nested, bool):
            return nested
    status = src.get("status") if isinstance(src, dict) else None
    if isinstance(status, bool):
        return status
    if isinstance(status, (int, float)) and not isinstance(status, bool):
        return status != 0
    return None


def _extract_pump_power_percent(payload: Any) -> Optional[float]:
    """Mirror core extractPumpPowerPercent."""
    src = _as_mapping(payload)
    raw = src.get("power", src.get("speed", src.get("pwm", src.get("Power", src.get("Speed")))))
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return None
    if n > 100 and n <= 255:
        return round((n / 255) * 100)
    if n < -100 and n >= -255:
        return round((abs(n) / 255) * 100)
    if n < 0:
        return round(min(100.0, abs(n)))
    return round(min(100.0, n))


def _estimate_heater_pwm(
    enabled: Optional[bool],
    target: Optional[float],
    temperature: Optional[float],
) -> Optional[float]:
    """Mirror core estimateHeaterPwmPercent."""
    if enabled is False:
        return 0.0
    if enabled is not True:
        return None
    if target is None or temperature is None:
        return None
    err = target - temperature
    if err <= 0:
        return 0.0
    return float(round(min(75.0, max(25.0, err * 1.5))))


def _valve_numbers(src: Dict[str, Any], *keys: str) -> List[int]:
    out: List[int] = []
    for key in keys:
        raw = src.get(key)
        if not isinstance(raw, list):
            continue
        for item in raw:
            try:
                n = int(item)
            except (TypeError, ValueError):
                continue
            if n >= 0:
                out.append(n)
    return out


def _merge_open_valve_numbers(nums: List[int]) -> List[int]:
    """Mirror core mergeOpenValveNumbers (0-based → +1 only if 0 present)."""
    if not nums:
        return []
    zero_based = 0 in nums
    out = set()
    for n in nums:
        ui = n + 1 if zero_based else n
        if 1 <= ui <= 6:
            out.add(ui)
    return sorted(out)


def _sensor_entries(container: Any) -> List[Dict[str, Any]]:
    """Normalize a `{host}Sensors` container (list or dict) → list of
    ``{name, value, type}`` dicts, mirroring core
    `extractSensorsFromContainer` (module-devices.ts)."""
    out: List[Dict[str, Any]] = []
    if isinstance(container, list):
        for item in container:
            if isinstance(item, dict):
                out.append(item)
            else:
                out.append({"name": "", "value": item})
    elif isinstance(container, dict):
        for name, value in container.items():
            if isinstance(value, dict):
                entry = dict(value)
                entry.setdefault("name", name)
                out.append(entry)
            else:
                out.append({"name": name, "value": value})
    return out


def _clean_sensor_name(name: Any) -> str:
    return str(name or "").replace(" ", "").replace("{", "").replace("}", "").lower()


def _events_from_facade_status(payload: Any, now_ms: float) -> List[LabEvent]:
    """Map coffeemachine.status (facade / dx) → temps, water, milkSystem valves.

    Module DX valves come from valves.status.* (MODULE_VALVES seriesKeys), not
    from milkValves[] indices — those are refrigerator msValve1..6.

    Facade sensors arrive role-prefixed with a `type` field
    (`{role}_heater1_out` type=temp, `{role}_heater1_power` type=power,
    `{role}_water_pressure` type=pressure, `water_total_pulses` type=counter —
    see .agent-notes/BACKEND_PROTOCOL.md). Mirrors core extractTempMap /
    extractWaterPressure / extractWaterTotalPulses: filter by type where the
    JS side does, normalize the name to the canonical TEMP_SENSOR_ORDER key so
    the emitted seriesKey (`milk.heater1_out`) matches SM's own charts instead
    of leaking raw ERP field names (`milk.milk_heater1_power`) into the ring.
    """
    src = _as_mapping(payload)
    events: List[LabEvent] = []

    # Milk system / recipe valves 1..6 (same as Modules milkSystemOpen)
    nums = _valve_numbers(src, "milkValves", "coffeeValves", "waterValves", "valves")
    open_ui = set(_merge_open_valve_numbers(nums))
    for n in range(1, 7):
        events.append(
            LabEvent(
                ts=now_ms,
                kind="valve",
                module="milk",
                name=f"msValve{n}",
                value=1 if n in open_ui else 0,
            )
        )

    water_pressure_found = False
    water_pulses_found = False

    for host in HOSTS:
        container = src.get(f"{host}Sensors")
        if container is None:
            container = src.get(f"{host}Temps")
        for entry in _sensor_entries(container):
            raw_name = entry.get("name")
            value = entry.get("value")
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            sensor_type = str(entry.get("type") or "").lower()
            norm_name = _clean_sensor_name(raw_name)

            # Water pressure — type=pressure OR name ending in *_pressure
            # (bar; real field is `{role}_water_pressure`, only on water host
            # sensors in practice, but scan every host defensively).
            if not water_pressure_found and (
                sensor_type == "pressure"
                or norm_name.endswith("water_pressure")
                or norm_name == "water_pressure"
                or norm_name.endswith("_pressure")
                or norm_name == "pressure"
            ):
                events.append(
                    LabEvent(
                        ts=now_ms,
                        kind="sensor",
                        module="water",
                        name="waterPressure",
                        value=float(value),
                    )
                )
                water_pressure_found = True
                continue

            # Water flow pulses counter — name ending in *_pulses
            if not water_pulses_found and (
                norm_name.endswith("total_pulses")
                or norm_name.endswith("flowmeter_total_pulses")
                or norm_name.endswith("water_total_pulses")
                or norm_name.endswith("pulses")
            ):
                events.append(
                    LabEvent(
                        ts=now_ms,
                        kind="sensor",
                        module="water",
                        name="waterTotalPulses",
                        value=float(value),
                    )
                )
                water_pulses_found = True
                continue

            # Temps only — skip type=power/counter duplicates (same sensor
            # tree also carries `{role}_heaterN_power`, not a temperature).
            if sensor_type and sensor_type != "temp":
                continue
            key = normalize_temp_key(str(raw_name or ""))
            if key is None:
                continue
            events.append(
                LabEvent(
                    ts=now_ms,
                    kind="sensor",
                    module=host,
                    name=key,
                    value=float(value),
                )
            )

    # Defensive fallback for producers that still put pressure/pulses at the
    # top level (older facade shape / test fixtures) — only if not already
    # found via the sensors[] scan above.
    if not water_pressure_found:
        pressure = src.get("waterPressure") or src.get("pressure")
        if isinstance(pressure, (int, float)) and not isinstance(pressure, bool):
            events.append(
                LabEvent(
                    ts=now_ms,
                    kind="sensor",
                    module="water",
                    name="waterPressure",
                    value=float(pressure),
                )
            )
    if not water_pulses_found:
        pulses = src.get("waterTotalPulses") or src.get("totalPulses")
        if isinstance(pulses, (int, float)) and not isinstance(pulses, bool):
            events.append(
                LabEvent(
                    ts=now_ms,
                    kind="sensor",
                    module="water",
                    name="waterTotalPulses",
                    value=float(pulses),
                )
            )

    return events


def _events_from_valve_status(
    host: str, base_id: str, payload: Any, now_ms: float
) -> List[LabEvent]:
    enabled = _extract_enabled(payload)
    if enabled is None:
        return []
    return [
        LabEvent(
            ts=now_ms,
            kind="valve",
            module=host,
            name=base_id,
            value=1 if enabled else 0,
        )
    ]


def _events_from_pump_status(host: str, payload: Any, now_ms: float) -> List[LabEvent]:
    events: List[LabEvent] = []
    power = _extract_pump_power_percent(payload)
    enabled = _extract_enabled(payload)
    if power is not None:
        events.append(
            LabEvent(
                ts=now_ms,
                kind="sensor",
                module=host,
                name="pumpPower",
                value=float(power),
            )
        )
        if enabled is None:
            enabled = power > 0
    if enabled is not None:
        events.append(
            LabEvent(
                ts=now_ms,
                kind="pump",
                module=host,
                name="pump",
                value=1 if enabled else 0,
            )
        )
    return events


def _events_from_heater_status(
    host: str, heater_id: str, payload: Any, now_ms: float
) -> List[LabEvent]:
    src = _as_mapping(payload)
    enabled = _extract_enabled(payload)
    events: List[LabEvent] = []
    if enabled is not None:
        events.append(
            LabEvent(
                ts=now_ms,
                kind="heater",
                module=host,
                name=heater_id,
                value=1 if enabled else 0,
            )
        )
    target = src.get("target")
    temp = src.get("temperature", src.get("lastMeasurement"))
    t_f = float(target) if isinstance(target, (int, float)) and not isinstance(target, bool) else None
    temp_f = float(temp) if isinstance(temp, (int, float)) and not isinstance(temp, bool) else None
    pwm = _estimate_heater_pwm(enabled, t_f, temp_f)
    if pwm is not None:
        events.append(
            LabEvent(
                ts=now_ms,
                kind="sensor",
                module=host,
                name=f"{heater_id}_pwm",
                value=float(pwm),
            )
        )
    return events


def _events_from_dx_snapshot(
    host: str, snap: Mapping[str, Optional[float]], now_ms: float
) -> List[LabEvent]:
    """Pump currents only — see module docstring below for why heater PWM
    from this same snapshot is deliberately NOT emitted as an event here."""
    events: List[LabEvent] = []
    r = snap.get("pump_R_IS")
    l = snap.get("pump_L_IS")
    if r is not None:
        events.append(
            LabEvent(
                ts=now_ms,
                kind="sensor",
                module=host,
                name="pumpCurrent",
                value=float(r),
            )
        )
    if l is not None:
        events.append(
            LabEvent(
                ts=now_ms,
                kind="sensor",
                module=host,
                name="pumpCurrentL",
                value=float(l),
            )
        )
    # heater1_pwm / heater2_pwm are intentionally NOT read from `snap` here.
    #
    # `snap["heater1_pwm"]`/`["heater2_pwm"]` come from `row[6]`/`row[11]` of
    # the DX UI's `let data = [[...]]` pid-log graph (dx_ui.py
    # parse_dx_ui_snapshot, mirroring core's parseDxUiGraphLastRow byte for
    # byte — the index mapping itself is *not* the bug, both sides agree).
    # A field ring capture (2026-08-02, "биг вош"/CIP wash cycle) showed
    # these values swinging between 0 and ~100 with odd many-decimal
    # precision on nearly every ~1.5s poll tick, for BOTH heaters
    # independently — not remotely consistent with a slow-changing PID duty
    # cycle, only with either (a) a genuinely fast-switching bang-bang relay
    # signal aliased by our comparatively slow poll rate into what looks
    # like noise once connected into a line chart, or (b) the pid-graph
    # section being unreliable at this polling cadence in some other way.
    #
    # Crucially: the *reference* Modules implementation
    # (apps/desktop/electron/main/dx-ui-fetch.ts `fetchHtmlCapped`) already
    # treats this exact same graph section as fragile — it deliberately caps
    # how much of the HTML it reads ("во время brew HTML раздувается
    # pid-graph → читаем начало (temps/stat), иначе timeout и токи
    # «пропадают»"), so in practice Modules very often gets `null` here and
    # falls back to the calm `estimateHeaterPwmPercent` guess — it does NOT
    # lean on this value the way our former `_merge_heater_pwm_events`
    # "DX always wins" fix did. Mirroring that caution: heater PWM on the
    # onboard logger now comes *only* from `_estimate_heater_pwm` (bounded,
    # stable, honestly-labelled-as-an-estimate) — never from this raw graph
    # row. Pump currents (`pump_R_IS`/`pump_L_IS`) are unaffected: those come
    # from the small `<div>{stat}</div>` block at the very start of the page
    # (see dx_ui.py `_STAT_DIV_RE`), which both sides always read reliably.
    return events


def _merge_heater_pwm_events(
    estimate_events: List[LabEvent], dx_events: List[LabEvent]
) -> List[LabEvent]:
    """DX UI heater PWM is authoritative over the crude NATS estimate.

    ``_estimate_heater_pwm`` is a clamp(25..75) fallback for when the DX UI
    graph is unavailable (mirrors core ``estimateHeaterPwmPercent`` — see its
    docstring: "Live output during brew comes from DX UI; after OFF do not use
    lastlog, it sticks"). Previously both the heater-status estimate event
    *and* the DX event for the exact same seriesKey (``{host}.heater1_pwm``)
    were appended to the same poll tick unconditionally — two conflicting
    values (e.g. estimate=30% while genuinely idle vs DX's correct 0%)
    landing back-to-back at ~the same timestamp. Field symptom: a sawtooth on
    the heater PWM curve even while the heater is correctly off. Only one
    event per (module, name) survives per tick now; DX wins when present.
    Non-PWM sensor events (pump currents, heater ON/OFF actuator events) pass
    through unchanged and are never deduped.
    """
    by_key: Dict[Any, LabEvent] = {}
    passthrough: List[LabEvent] = []
    for e in estimate_events:
        if e.kind == "sensor" and e.name.endswith("_pwm"):
            by_key[(e.module, e.name)] = e
        else:
            passthrough.append(e)
    for e in dx_events:
        if e.kind == "sensor" and e.name.endswith("_pwm"):
            by_key[(e.module, e.name)] = e  # DX overrides the estimate
        else:
            passthrough.append(e)
    return passthrough + list(by_key.values())


class NatsSource:
    """Full Modules-parity poll on complexos localhost NATS + DX HTTP.

    Uses :class:`~sm_lab_logger.mini_nats.MiniNatsClient` — stdlib-only, no
    pip / internet dependency (see mini_nats.py module docstring for why that
    matters on a field Pi). Synchronous + fully sequential requests: matches
    the plan's "max concurrent NATS in-flight = 1" safety rule instead of the
    old `asyncio.gather` concurrent fan-out.

    Connect / request errors raise :class:`~sm_lab_logger.mini_nats.NatsError`,
    which bubbles to the runner watchdog like any other poll failure (no DX
    hammer when NATS down — ``dx_allowed``).
    """

    def __init__(
        self,
        url: str = "nats://127.0.0.1:4222",
        dx_urls: Optional[Mapping[str, str]] = None,
        profile: str = "4.x",
    ) -> None:
        self.url = url
        self.dx_urls = dict(dx_urls or DEFAULT_DX_HTTP)
        self.profile = profile
        self._dx_allowed = True
        self._client = MiniNatsClient(url=url)
        # Hosts that answered *something* on the most recent poll() — used by
        # main.py to recompute topology warnings against real data instead of
        # a static "missing" placeholder (see check_topology callers).
        self.last_reachable: set = set()

    @property
    def source_kind(self) -> str:
        return "nats"

    def set_dx_allowed(self, allowed: bool) -> None:
        self._dx_allowed = bool(allowed)

    def close(self) -> None:
        self._client.close()

    def _soft_request(
        self, subject: str, payload: Dict[str, Any], timeout: float
    ) -> Any:
        try:
            return self._client.request(subject, payload, timeout)
        except NatsError:
            return None

    def poll(self) -> List[LabEvent]:
        now_ms = time.time() * 1000.0
        events: List[LabEvent] = []
        reachable: set = set()

        # Facade status — required for watchdog success path (temps + ms
        # valves). Connect happens lazily on first request; a hard connect
        # failure here raises NatsError straight out of poll() (soft-fail is
        # the runner's job, not this method's).
        facade = self._soft_request("coffeemachine.status", {"hwid": "dx"}, 1.0)
        if facade is not None:
            facade_events = _events_from_facade_status(facade, now_ms)
            events.extend(facade_events)
            for e in facade_events:
                if e.kind == "sensor" and e.module in HOSTS:
                    reachable.add(e.module)

        # All MODULE_VALVES — seriesKey milk.drain etc. (Modules LabTelemetry).
        # Sequential (in-flight = 1) — gentle on cm-drv, per plan safety rule.
        for host in HOSTS:
            for base_id in MODULE_VALVES[host]:
                payload = self._soft_request(
                    valve_status_subject(host, base_id),
                    {"hwid": default_hwid(host)},
                    0.5,
                )
                if payload is None:
                    continue
                reachable.add(host)
                events.extend(
                    _events_from_valve_status(host, base_id, payload, now_ms)
                )

        # Heaters — collect PWM-estimate events separately from everything
        # else; DX (below) supersedes the estimate for the same seriesKey
        # instead of coexisting with it in the same tick (see
        # _merge_heater_pwm_events docstring — this used to produce a
        # sawtooth on the heater PWM curve).
        heater_estimate_events: List[LabEvent] = []
        for host in HOSTS:
            for hid in HEATER_IDS:
                payload = self._soft_request(
                    heater_status_subject(host, hid),
                    {"hwid": default_hwid(host)},
                    0.5,
                )
                if payload is None:
                    continue
                reachable.add(host)
                heater_estimate_events.extend(
                    _events_from_heater_status(host, hid, payload, now_ms)
                )

        # Pumps
        for host in HOSTS:
            payload = self._soft_request(
                pump_status_subject(host), {"hwid": default_hwid(host)}, 0.5
            )
            if payload is None:
                continue
            reachable.add(host)
            events.extend(_events_from_pump_status(host, payload, now_ms))

        # DX UI currents / PWM — only when NATS healthy and profile 4.x
        dx_events: List[LabEvent] = []
        if self._dx_allowed and not str(self.profile).startswith("3"):
            for host in HOSTS:
                url = self.dx_urls.get(host)
                if not url:
                    continue
                snap, err = fetch_dx_ui_snapshot(url, timeout_s=1.2)
                if err is None:
                    reachable.add(host)
                dx_events.extend(_events_from_dx_snapshot(host, snap, now_ms))

        events.extend(_merge_heater_pwm_events(heater_estimate_events, dx_events))

        self.last_reachable = reachable

        if not events and facade is None:
            # Nothing at all — treat as poll failure for watchdog
            raise RuntimeError("nats poll empty: facade unreachable")

        return events
