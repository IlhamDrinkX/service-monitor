"""DX UI HTML parse — mirrors packages/core dx-ui-stat fixtures."""

from __future__ import annotations

import unittest

import _pathsetup  # noqa: F401

from sm_lab_logger.dx_ui import (
    dx_ui_snapshot_has_data,
    parse_dx_ui_snapshot,
    parse_dx_ui_stat_html,
)


class TestDxUi(unittest.TestCase):
    def test_parses_stat_and_graph_like_core(self) -> None:
        html = (
            "<html><body><div>"
            + '{"milk_input":12.3,"pump_R_IS":0.45,"pump_L_IS":0.12,"heater1_out":40}'
            + "</div><script>let data = "
            "[[1,0,50,40,20,30,75,60,55,22,31,40,0.45,0.12,1.2]];</script></body></html>"
        )
        stat = parse_dx_ui_stat_html(html)
        self.assertIsNotNone(stat)
        assert stat is not None
        self.assertEqual(stat["pump_R_IS"], 0.45)
        snap = parse_dx_ui_snapshot(html)
        self.assertEqual(snap["pump_R_IS"], 0.45)
        self.assertEqual(snap["pump_L_IS"], 0.12)
        self.assertEqual(snap["heater1_pwm"], 75.0)
        self.assertEqual(snap["heater2_pwm"], 40.0)
        self.assertTrue(dx_ui_snapshot_has_data(snap))

    def test_regex_fallback_for_broken_json(self) -> None:
        html = '<div>broken { "pump_R_IS": 1.25, </div>'
        snap = parse_dx_ui_snapshot(html)
        self.assertEqual(snap["pump_R_IS"], 1.25)


if __name__ == "__main__":
    unittest.main()
