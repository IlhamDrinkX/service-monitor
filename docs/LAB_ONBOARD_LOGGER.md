# Lab onboard logger (complexos)

**Status:** planned. Branch: `feature/complexos-lab-logger`.  
**Detailed agent notes (local, gitignored):** `.agent-notes/SM_LAB_ONBOARD_AGENT.md`

## Intent

Run a lightweight **Python** collector on the **complexos** host (central NATS hub) so Service Monitor Lab charts can get dense telemetry without hammering the LAN from a laptop.

## Capabilities (target)

- Collect chart-relevant signals: valves, sensors, pump currents (R_IS/L_IS), heater PWM, pump power/on, temps, host-health-ish fields.
- Append-only **ring log**, default **24 h** retention (configurable).
- SM can **install/enable** or **uninstall** the agent; left-nav **view-only** page for live snapshot or downloaded offline log.
- Serve data **on request** (localhost HTTP via SSH tunnel, or direct file read) — minimize load.
- Warn when milk/coffee/water are not on expected IPs (even if data is present).
- Fail soft: local NATS only, rate limits, pause/backoff, do not compete with `cm-drv`.

## Stub

See `tools/complexos-lab-logger/` (`--retain-hours 24`, `--interval-ms 200`).

## Phases

1. Notes + branch (this doc)
2. MVP Python poller + ring + optional localhost HTTP
3. SM install/uninstall IPC over SSH
4. View-only UI page (live)
5. Offline viewer from downloaded ring

## Safety

Do not bind the HTTP API publicly. When SM uses onboard data, disable dense dual NATS polling from the laptop.
