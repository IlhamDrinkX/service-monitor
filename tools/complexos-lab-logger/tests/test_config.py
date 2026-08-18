"""Tests for sm_lab_logger.config — write before implementation (TDD)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import _pathsetup  # noqa: F401 — put package root on sys.path

from sm_lab_logger.config import ConfigError, load_config, parse_args


class TestConfigDefaults(unittest.TestCase):
    def test_defaults_retain_24_interval_200(self) -> None:
        cfg = load_config(argv=[])
        self.assertEqual(cfg.retain_hours, 24.0)
        self.assertEqual(cfg.interval_ms, 200)


class TestConfigValidation(unittest.TestCase):
    def test_reject_interval_below_50(self) -> None:
        with self.assertRaises(ConfigError):
            load_config(argv=["--interval-ms", "49"])

    def test_reject_retain_hours_non_positive(self) -> None:
        with self.assertRaises(ConfigError):
            load_config(argv=["--retain-hours", "0"])
        with self.assertRaises(ConfigError):
            load_config(argv=["--retain-hours", "-1"])

class TestConfigCliOverrides(unittest.TestCase):
    def test_cli_overrides_defaults(self) -> None:
        cfg = load_config(argv=["--retain-hours", "12", "--interval-ms", "100"])
        self.assertEqual(cfg.retain_hours, 12.0)
        self.assertEqual(cfg.interval_ms, 100)

    def test_cli_overrides_config_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "retain_hours": 6,
                        "interval_ms": 250,
                        "expected": {
                            "milk": "192.168.1.44",
                            "coffee": "192.168.1.45",
                            "water": "192.168.1.46",
                        },
                    }
                ),
                encoding="utf-8",
            )
            cfg = load_config(
                argv=["--config", str(path), "--retain-hours", "18", "--interval-ms", "150"]
            )
            self.assertEqual(cfg.retain_hours, 18.0)
            self.assertEqual(cfg.interval_ms, 150)
            self.assertEqual(cfg.expected["coffee"], "192.168.1.45")

    def test_parse_args_exposes_namespace(self) -> None:
        ns = parse_args(["--data-dir", "./x", "--http-port", "8765"])
        self.assertEqual(ns.data_dir, "./x")
        self.assertEqual(ns.http_port, 8765)

    def test_fake_source_from_config_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps({"fake_source": True, "retain_hours": 8}),
                encoding="utf-8",
            )
            cfg = load_config(argv=["--config", str(path)])
            self.assertTrue(cfg.fake_source)
            self.assertEqual(cfg.retain_hours, 8.0)


if __name__ == "__main__":
    unittest.main()
