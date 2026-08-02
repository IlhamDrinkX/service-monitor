"""Tests for NATS Watchdog — backoff after N failures; no DX when down."""

from __future__ import annotations

import unittest

import _pathsetup  # noqa: F401

from sm_lab_logger.watchdog import Watchdog


class TestWatchdogBackoff(unittest.TestCase):
    def test_success_keeps_base_interval(self) -> None:
        wd = Watchdog(max_failures=3, base_interval_ms=200, max_interval_ms=8000)
        wd.record_success()
        self.assertEqual(wd.interval_ms(), 200)
        self.assertTrue(wd.dx_allowed)
        self.assertFalse(wd.in_backoff)

    def test_below_threshold_no_backoff(self) -> None:
        wd = Watchdog(max_failures=3, base_interval_ms=200, max_interval_ms=8000)
        wd.record_failure()
        wd.record_failure()
        self.assertFalse(wd.in_backoff)
        self.assertEqual(wd.interval_ms(), 200)
        self.assertTrue(wd.dx_allowed)

    def test_after_n_failures_backs_off(self) -> None:
        wd = Watchdog(max_failures=3, base_interval_ms=200, max_interval_ms=8000)
        for _ in range(3):
            wd.record_failure()
        self.assertTrue(wd.in_backoff)
        self.assertGreater(wd.interval_ms(), 200)
        self.assertFalse(wd.dx_allowed)  # no DX hammer when NATS down

    def test_exponential_growth_capped(self) -> None:
        wd = Watchdog(max_failures=2, base_interval_ms=200, max_interval_ms=1600)
        wd.record_failure()
        wd.record_failure()  # enter backoff: 400
        self.assertEqual(wd.interval_ms(), 400)
        wd.record_failure()  # 800
        self.assertEqual(wd.interval_ms(), 800)
        wd.record_failure()  # 1600
        self.assertEqual(wd.interval_ms(), 1600)
        wd.record_failure()  # still capped
        self.assertEqual(wd.interval_ms(), 1600)

    def test_success_resets_backoff(self) -> None:
        wd = Watchdog(max_failures=2, base_interval_ms=200, max_interval_ms=8000)
        wd.record_failure()
        wd.record_failure()
        self.assertTrue(wd.in_backoff)
        wd.record_success()
        self.assertFalse(wd.in_backoff)
        self.assertEqual(wd.interval_ms(), 200)
        self.assertTrue(wd.dx_allowed)


if __name__ == "__main__":
    unittest.main()
