#!/usr/bin/env python3
"""complexos Lab onboard logger — stub.

Collects Lab chart signals on the complexos NATS hub into a time-bounded ring file.
Real NATS/DX polling, HTTP serve, and systemd install land in later phases.
See docs/LAB_ONBOARD_LOGGER.md.
"""

from __future__ import annotations

import argparse
import sys
import time


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Service Monitor Lab onboard logger (complexos)")
    p.add_argument("--retain-hours", type=float, default=24.0, help="Ring retention window (hours)")
    p.add_argument("--interval-ms", type=int, default=200, help="Poll interval in milliseconds")
    p.add_argument("--http-port", type=int, default=0, help="If >0, serve snapshot on 127.0.0.1")
    p.add_argument("--data-dir", type=str, default="./data", help="Ring / snapshot directory")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print(
        "sm-lab-logger stub: "
        f"retain-hours={args.retain_hours} interval-ms={args.interval_ms} "
        f"http-port={args.http_port or 'off'} data-dir={args.data_dir}",
        flush=True,
    )
    print("Not implemented: NATS/DX poll loop, ring writer, localhost HTTP.", flush=True)
    try:
        while True:
            time.sleep(max(args.interval_ms, 1000) / 1000.0)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
