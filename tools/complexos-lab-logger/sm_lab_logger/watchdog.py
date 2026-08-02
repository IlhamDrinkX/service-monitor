"""NATS / poll Watchdog — backoff after N failures; gate DX when down."""

from __future__ import annotations


class Watchdog:
    """After ``max_failures`` consecutive poll failures, back off interval.

    While in backoff, ``dx_allowed`` is False so callers must not hammer DX HTML
    when the NATS hub is down.
    """

    def __init__(
        self,
        max_failures: int = 5,
        base_interval_ms: int = 200,
        max_interval_ms: int = 30_000,
    ) -> None:
        self.max_failures = int(max_failures)
        self.base_interval_ms = int(base_interval_ms)
        self.max_interval_ms = int(max_interval_ms)
        self.consecutive_failures = 0
        self._extra_failures_after_backoff = 0

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self._extra_failures_after_backoff = 0

    def record_failure(self) -> None:
        self.consecutive_failures += 1
        if self.consecutive_failures > self.max_failures:
            self._extra_failures_after_backoff += 1

    @property
    def in_backoff(self) -> bool:
        return self.consecutive_failures >= self.max_failures

    @property
    def dx_allowed(self) -> bool:
        """False when NATS/poll is down (backoff) — do not DX-hammer modules."""
        return not self.in_backoff

    def interval_ms(self) -> int:
        if not self.in_backoff:
            return self.base_interval_ms
        # failures at threshold → 2x base; each extra failure doubles again
        # When consecutive_failures == max_failures, exponent = 1 → 2 * base
        # When consecutive_failures == max_failures + k, exponent = 1 + k
        exponent = 1 + max(0, self.consecutive_failures - self.max_failures)
        interval = self.base_interval_ms * (2**exponent)
        return min(interval, self.max_interval_ms)
