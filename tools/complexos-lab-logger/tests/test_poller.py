"""Tests for TelemetrySource / FakeSource / NatsSource mappers — Modules parity."""

from __future__ import annotations

import unittest

import _pathsetup  # noqa: F401

from sm_lab_logger.devices import MODULE_VALVES, valve_status_subject
from sm_lab_logger.dx_ui import parse_dx_ui_snapshot
from sm_lab_logger.poller import (
    FakeSource,
    NatsSource,
    TelemetrySource,
    _events_from_dx_snapshot,
    _events_from_facade_status,
    _events_from_heater_status,
    _events_from_pump_status,
    _events_from_valve_status,
    _merge_heater_pwm_events,
)
from sm_lab_logger.schema import LabEvent


def _valve(ts: float, module: str, name: str, value: int) -> LabEvent:
    return LabEvent(ts=ts, kind="valve", module=module, name=name, value=value)


def _sensor(ts: float, module: str, name: str, value: float) -> LabEvent:
    return LabEvent(ts=ts, kind="sensor", module=module, name=name, value=value)


class TestFakeSource(unittest.TestCase):
    def test_implements_telemetry_source(self) -> None:
        src = FakeSource()
        self.assertIsInstance(src, TelemetrySource)

    def test_poll_emits_scripted_valve_and_sensor_changes(self) -> None:
        frames = [
            [_valve(1000.0, "milk", "drain", 1), _sensor(1000.0, "coffee", "pumpCurrent", 1.5)],
            [_valve(1100.0, "milk", "drain", 0)],
        ]
        src = FakeSource(frames=frames)
        first = src.poll()
        self.assertEqual(len(first), 2)
        self.assertEqual(first[0].kind, "valve")
        self.assertEqual(first[0].module, "milk")
        self.assertEqual(first[0].name, "drain")
        self.assertEqual(first[0].value, 1)
        self.assertEqual(first[1].series_key(), "coffee.pumpCurrent")

        second = src.poll()
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0].value, 0)

    def test_poll_after_frames_exhausted_returns_empty(self) -> None:
        src = FakeSource(frames=[[_valve(1.0, "water", "input", 1)]])
        self.assertEqual(len(src.poll()), 1)
        self.assertEqual(src.poll(), [])

    def test_push_frame_for_dynamic_tests(self) -> None:
        src = FakeSource()
        src.push([_valve(2000.0, "milk", "drain", 1)])
        got = src.poll()
        self.assertEqual(got[0].value, 1)


class TestNatsSource(unittest.TestCase):
    def test_construct_requires_nats_or_raises(self) -> None:
        try:
            src = NatsSource()
        except ImportError:
            return  # expected without nats-py
        self.assertEqual(src.source_kind, "nats")

    def test_valve_status_subject_matches_core(self) -> None:
        self.assertEqual(
            valve_status_subject("milk", "drain"), "valves.status.milk-drain"
        )
        self.assertIn("drain", MODULE_VALVES["milk"])
        self.assertIn("milkInput", MODULE_VALVES["coffee"])

    def test_facade_status_maps_ms_valves_and_temps(self) -> None:
        # Mirrors core extractOpenValveNumbers / applyLabStatusReplies fixtures
        events = _events_from_facade_status(
            {
                "result": {
                    "milkValves": [1, 3],
                    "coffeeValves": [],
                    "milkSensors": {"input": 4.2, "heater1_out": 41.0},
                    "waterPressure": 1.1,
                }
            },
            now_ms=5000.0,
        )
        milk_ms = {
            e.name: e.value
            for e in events
            if e.module == "milk" and e.kind == "valve" and e.name.startswith("msValve")
        }
        self.assertEqual(milk_ms.get("msValve1"), 1)
        self.assertEqual(milk_ms.get("msValve2"), 0)
        self.assertEqual(milk_ms.get("msValve3"), 1)
        # Must NOT invent MODULE_VALVES names from facade indices
        module_valves = [
            e.name
            for e in events
            if e.module == "milk" and e.kind == "valve" and e.name == "drain"
        ]
        self.assertEqual(module_valves, [])
        temps = {
            e.name: e.value
            for e in events
            if e.module == "milk" and e.kind == "sensor"
        }
        self.assertEqual(temps.get("input"), 4.2)
        water = [
            e for e in events if e.module == "water" and e.name == "waterPressure"
        ]
        self.assertEqual(len(water), 1)
        self.assertEqual(water[0].value, 1.1)

    def test_facade_status_real_shape_filters_type_and_normalizes_names(self) -> None:
        """Real facade wire format (BACKEND_PROTOCOL.md): role-prefixed sensor
        names + `type` field inside `{role}Sensors` arrays — not the flat
        {"input": 4.2} test-only dict shape. Power-type duplicates of a temp
        reading must be excluded; names must be normalized to the canonical
        seriesKey SM charts already use (`milk.heater1_out`, not
        `milk.milk_heater1_out` / `milk.milk_heater1_power`).
        """
        events = _events_from_facade_status(
            {
                "result": {
                    "format": "drinkx-1.0",
                    "milkValves": [1],
                    "milkSensors": [
                        {"name": "milk_input", "type": "temp", "value": 4.2},
                        {"name": "milk_heater1_out", "type": "temp", "value": 41.0},
                        # Duplicate power reading under a similar name — must
                        # NOT be emitted as a temp (core extractTempMap skips
                        # type != "temp").
                        {"name": "milk_heater1_power", "type": "power", "value": 55.0},
                        {"name": "milk_heater1_overheat", "type": "temp", "value": 38.0},
                    ],
                    "waterSensors": [
                        {"name": "water_water_pressure", "type": "pressure", "value": 2.3},
                        {"name": "water_total_pulses", "type": "counter", "value": 918273},
                    ],
                }
            },
            now_ms=6000.0,
        )
        temps = {
            e.name: e.value
            for e in events
            if e.module == "milk" and e.kind == "sensor"
        }
        self.assertEqual(temps.get("input"), 4.2)
        self.assertEqual(temps.get("heater1_out"), 41.0)
        self.assertEqual(temps.get("heater1_overheat"), 38.0)
        # The type=power duplicate must not leak in under any key.
        self.assertNotIn("heater1_power", temps)
        self.assertNotIn("milk_heater1_power", temps)
        self.assertEqual(len(temps), 3)

        water = {
            e.name: e.value
            for e in events
            if e.module == "water" and e.kind == "sensor"
        }
        self.assertEqual(water.get("waterPressure"), 2.3)
        self.assertEqual(water.get("waterTotalPulses"), 918273.0)

    def test_valve_status_uses_module_valve_series_keys(self) -> None:
        # Same shape as core extractEnabledState tests
        events = _events_from_valve_status(
            "milk", "drain", {"result": {"enabled": True}}, now_ms=100.0
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].series_key(), "milk.drain")
        self.assertEqual(events[0].value, 1)

        off = _events_from_valve_status(
            "coffee", "milkInput", {"enabled": False}, now_ms=100.0
        )
        self.assertEqual(off[0].series_key(), "coffee.milkInput")
        self.assertEqual(off[0].value, 0)

    def test_pump_status_power_and_enabled(self) -> None:
        events = _events_from_pump_status(
            "coffee", {"result": {"enabled": True, "power": 80}}, now_ms=200.0
        )
        keys = {e.series_key(): e for e in events}
        self.assertEqual(keys["coffee.pumpPower"].value, 80.0)
        self.assertEqual(keys["coffee.pump"].value, 1)
        self.assertEqual(keys["coffee.pump"].kind, "pump")

    def test_heater_status_estimates_pwm(self) -> None:
        events = _events_from_heater_status(
            "milk",
            "heater1",
            {"result": {"enabled": True, "target": 60, "temperature": 40}},
            now_ms=300.0,
        )
        keys = {e.series_key(): e for e in events}
        self.assertEqual(keys["milk.heater1"].kind, "heater")
        self.assertEqual(keys["milk.heater1"].value, 1)
        # estimateHeaterPwmPercent(true, 60, 40) → 30
        self.assertEqual(keys["milk.heater1_pwm"].value, 30.0)
        self.assertEqual(keys["milk.heater1_pwm"].kind, "sensor")

        off = _events_from_heater_status(
            "milk",
            "heater2",
            {"enabled": False, "target": 60, "temperature": 40},
            now_ms=300.0,
        )
        off_keys = {e.series_key(): e for e in off}
        self.assertEqual(off_keys["milk.heater2_pwm"].value, 0.0)

    def test_dx_snapshot_maps_currents_only_not_pwm(self) -> None:
        """Regression: DX pid-graph heater PWM (row[6]/row[11]) is real but
        unreliable at our poll cadence — a field capture showed it swinging
        0..100 with implausible precision on nearly every tick, even during
        a wash cycle. Modules itself avoids leaning on this value (see
        dx-ui-fetch.ts's stat-first truncation comment). Only pump currents
        (from the small, always-reliable stat div) should become events;
        heater1_pwm/heater2_pwm must come solely from `_estimate_heater_pwm`.
        """
        html = (
            '<div>{"pump_R_IS":0.45,"pump_L_IS":0.12}</div>'
            "<script>let data = "
            "[[1,0,50,40,20,30,75,60,55,22,31,40,0.45,0.12,1.2]];</script>"
        )
        snap = parse_dx_ui_snapshot(html)
        self.assertEqual(snap["pump_R_IS"], 0.45)
        # parse_dx_ui_snapshot itself still extracts the row (mirrors core
        # parseDxUiSnapshot byte for byte) — the fix is in what the poller
        # *does* with it, not in the shared HTML-parsing helper.
        self.assertEqual(snap["heater1_pwm"], 75.0)
        events = _events_from_dx_snapshot("milk", snap, now_ms=400.0)
        keys = {e.series_key(): e.value for e in events}
        self.assertEqual(keys["milk.pumpCurrent"], 0.45)
        self.assertEqual(keys["milk.pumpCurrentL"], 0.12)
        self.assertNotIn("milk.heater1_pwm", keys)
        self.assertNotIn("milk.heater2_pwm", keys)

    def test_merge_heater_pwm_prefers_dx_over_estimate(self) -> None:
        """`_merge_heater_pwm_events`'s own contract, tested generically:
        given a DX-shaped PWM candidate for the same seriesKey as an
        estimate, DX wins and only one point survives per tick.

        NOTE: as of the dx-pid-graph-is-unreliable fix,
        `_events_from_dx_snapshot` itself no longer produces such a
        candidate in production (see its docstring — a field capture showed
        the underlying `row[6]`/`row[11]` values swinging implausibly).
        This test constructs the DX-shaped event directly to keep covering
        the merge function's arbitration logic in isolation, in case a
        future, better-validated DX PWM source is wired in again.
        """
        estimate_events = _events_from_heater_status(
            "milk",
            "heater1",
            {"result": {"enabled": True, "target": 60, "temperature": 40}},
            now_ms=1000.0,
        )
        dx_events = [
            LabEvent(
                ts=1000.0,
                kind="sensor",
                module="milk",
                name="heater1_pwm",
                value=0.0,
            )
        ]
        merged = _merge_heater_pwm_events(estimate_events, dx_events)
        pwm = [e for e in merged if e.series_key() == "milk.heater1_pwm"]
        self.assertEqual(len(pwm), 1, "estimate + DX must not coexist as two points")
        self.assertEqual(pwm[0].value, 0.0)
        # Heater ON/OFF actuator event (non-PWM) passes through untouched.
        onoff = [e for e in merged if e.series_key() == "milk.heater1"]
        self.assertEqual(len(onoff), 1)
        self.assertEqual(onoff[0].kind, "heater")

    def test_merge_heater_pwm_keeps_estimate_when_dx_has_no_reading(self) -> None:
        estimate_events = _events_from_heater_status(
            "coffee",
            "heater2",
            {"result": {"enabled": True, "target": 60, "temperature": 40}},
            now_ms=2000.0,
        )
        merged = _merge_heater_pwm_events(estimate_events, [])
        pwm = [e for e in merged if e.series_key() == "coffee.heater2_pwm"]
        self.assertEqual(len(pwm), 1)
        self.assertEqual(pwm[0].value, 30.0)

    def test_merge_heater_pwm_passes_through_pump_currents(self) -> None:
        dx_events = _events_from_dx_snapshot(
            "water", {"pump_R_IS": 0.3, "pump_L_IS": 0.2}, now_ms=3000.0
        )
        merged = _merge_heater_pwm_events([], dx_events)
        keys = {e.series_key(): e.value for e in merged}
        self.assertEqual(keys["water.pumpCurrent"], 0.3)
        self.assertEqual(keys["water.pumpCurrentL"], 0.2)


if __name__ == "__main__":
    unittest.main()
