"""Tests for install_meta (file list, unit, config)."""

from __future__ import annotations

import unittest

import _pathsetup  # noqa: F401 — put package root on sys.path

from sm_lab_logger import __version__
from sm_lab_logger.install_meta import (
    HTTP_PORT,
    PACKAGE_FILES,
    REMOTE_ROOT,
    build_default_config,
    build_systemd_user_unit,
    missing_package_files,
)


class TestInstallMeta(unittest.TestCase):
    def test_package_files_exist(self) -> None:
        missing = missing_package_files()
        self.assertEqual(missing, [], f"missing: {missing}")

    def test_version_aligned(self) -> None:
        self.assertTrue(__version__)
        self.assertIn("main.py", PACKAGE_FILES)
        self.assertIn("sm_lab_logger/http_api.py", PACKAGE_FILES)

    def test_systemd_unit(self) -> None:
        unit = build_systemd_user_unit()
        self.assertIn("Nice=10", unit)
        self.assertIn(REMOTE_ROOT, unit)
        self.assertIn(f"--http-port {HTTP_PORT}", unit)
        self.assertIn("WantedBy=default.target", unit)

    def test_default_config(self) -> None:
        cfg = build_default_config(retain_hours=12)
        self.assertEqual(cfg["retain_hours"], 12)
        self.assertEqual(cfg["http_port"], HTTP_PORT)
        self.assertFalse(cfg["fake_source"])
        self.assertEqual(cfg["profile"], "4.x")
        self.assertIn("nats_url", cfg)


if __name__ == "__main__":
    unittest.main()
