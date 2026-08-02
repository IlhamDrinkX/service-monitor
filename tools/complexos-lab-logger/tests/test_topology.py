"""Tests for sm_lab_logger.topology — write before implementation (TDD)."""

from __future__ import annotations

import unittest

import _pathsetup  # noqa: F401 — put package root on sys.path

from sm_lab_logger.topology import DEFAULT_EXPECTED, TopologyCheck, check_topology


class TestTopologyMatch(unittest.TestCase):
    def test_matching_ips_no_warnings(self) -> None:
        discovered = {
            "milk": "192.168.1.44",
            "coffee": "192.168.1.45",
            "water": "192.168.1.46",
        }
        # Defaults expect .44 milk, .45 coffee, .46 water — but user said
        # expected milk=.44 coffee=.45 water=.46
        result = check_topology(discovered)
        self.assertIsInstance(result, TopologyCheck)
        self.assertEqual(result.warnings, [])

    def test_default_expected_suffixes(self) -> None:
        self.assertEqual(DEFAULT_EXPECTED["milk"].endswith(".44") or DEFAULT_EXPECTED["milk"] == ".44" or "44" in DEFAULT_EXPECTED["milk"], True)
        self.assertIn("45", DEFAULT_EXPECTED["coffee"])
        self.assertIn("46", DEFAULT_EXPECTED["water"])


class TestTopologyMismatch(unittest.TestCase):
    def test_coffee_on_milk_ip_warns_role_mismatch(self) -> None:
        # coffee discovered on .44 (milk's expected) → warning mentions role mismatch
        discovered = {
            "milk": "192.168.1.99",
            "coffee": "192.168.1.44",
            "water": "192.168.1.46",
        }
        result = check_topology(
            discovered,
            expected={
                "milk": "192.168.1.44",
                "coffee": "192.168.1.45",
                "water": "192.168.1.46",
            },
        )
        self.assertTrue(result.warnings)
        joined = " ".join(result.warnings).lower()
        self.assertTrue(
            "mismatch" in joined or "role" in joined or "ожид" in joined or "expected" in joined,
            msg=f"warnings should mention role mismatch: {result.warnings}",
        )
        self.assertTrue(
            any("coffee" in w.lower() for w in result.warnings),
            msg=result.warnings,
        )


if __name__ == "__main__":
    unittest.main()
