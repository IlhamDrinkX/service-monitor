# Lab onboard logger (complexos)

**Status (2026-08-02):** Phase **2 — SM install/control** and Phase **1.6 — real NATS** are both **done**. Default unit uses real NATS via a **stdlib-only** client (`sm_lab_logger/mini_nats.py` — no `nats-py`, no pip, no internet route needed on complexos). `--fake-source` is demo-only, never used in the field install path.

Field-hardening changes this same day (full details + affected files in `.agent-notes/CHANGELOG_AGENT.md`, dated entries):

- **Facade sensor parity** — temp/water-pressure/water-pulses parsing filters by `type` and normalizes role-prefixed names to the same seriesKey SM charts use (was leaking wrong keys / missing water entirely).
- **Real NATS, not `nats-py`** — complexos hosts have no PyPI route; the old `pip install nats-py` silently failed and fell back to an idle no-op loop. Replaced with the stdlib `mini_nats.py` client.
- **Topology warnings** now reflect real per-tick reachability, not a static "all missing" placeholder.
- **Import "Импорт лога"** accepts the downloaded `.jsonl` ring (JSON Lines), not just the chart panel's own single-JSON export.
- **SSH noise** — the OpenSSH "store now, decrypt later" PQ advisory no longer leaks through as a fake `[err]` log line.
- **Chart window close** now stops the realtime SSH-curl poll loop instead of running it against a closed window.
- **Help tooltip** no longer clips inside the left-nav sidebar (was a `backdrop-filter`/`position:fixed` containing-block bug; fixed via a portal to `document.body`).
- **Chart curves disappearing over time** — root cause was `RingStore.events_since()` (backing `/lab/events`, which SM's realtime chart polls) silently dropping `Snapshot` heartbeat records, so a series that stopped changing never refreshed and dropped off the chart after ~8s. Fixed with a new `RingStore.records_since()` that includes heartbeats too. (An earlier, smaller contributing bug — an event-merge heuristic borrowed from the dense Modules sync that wrongly reset the local ring on small delta batches — was also fixed, in `mergeOnboardLabEvents`.)
- **Heater PWM (ШИМ)** no longer reads `heater1_pwm`/`heater2_pwm` from the DX UI pid-graph (`row[6]`/`row[11]`) — a field ring capture showed it swinging implausibly across 0–100 on nearly every poll. This graph buffer (`lastlog` in `cm-drv/drivers/drinkx.js`) resets to empty on every `heaters-stopped` event and only re-syncs on `heaters-started`, so "last row" is not a stable "current value" signal — **and this was already flagged as a known regression in `.agent-notes/VERIFIED.md`** ("PWM из DX graph lastlog → ложные %" / "Не брать PWM из DX graph"), which the onboard poller's original implementation didn't check against. Heater PWM now comes solely from the `heaters.status`-based estimate, matching what Modules itself falls back to in practice.
- **Valve/sensor chart order** now matches Modules exactly (`MODULE_VALVES` / `complexSensorCatalog` canonical order) instead of alphabetical/event-arrival order.
- **Uninstall** auto-retries once on a transient blank `ssh exit 255` (OpenSSH client-level failure, not a remote script error); **install** now always force-restarts the service after unpacking, so re-pushing a fix actually takes effect even if the old process was still running (`systemctl start` is a no-op on an already-active unit).

**A full redeploy (SM app restart + click "Установить" again) is required for all of the above to reach a field complex** — editing this repo alone does not change what's already running on a Pi.  
**Detailed agent notes (local, gitignored):** `.agent-notes/SM_LAB_ONBOARD_AGENT.md`. **Verified ERP/cm-drv facts (local, gitignored):** `.agent-notes/VERIFIED.md`, `.agent-notes/BACKEND_PROTOCOL.md`.

## Intent

Run a lightweight **Python** collector on the **complexos** host (central NATS hub) so Service Monitor Lab charts can get dense telemetry without hammering the LAN from a laptop.

## Roadmap A / B

| Path | Meaning | Timing |
|------|---------|--------|
| **A** | Python onboard collector + **read-only** web viewer / realtime on the complex LAN | Near-term after install path |
| **B** | Local Linux console **on complexos**, series-**4** only — no fleet/cloud | Later |

**Now:** Service Monitor left-nav **«Бортовой лог»** installs/controls the agent; **realtime** (SSH curl `/lab/events` → chart window, poll ≥1 s / default 1.5 s) and **full ring download** (chunked ~2 MiB SSH pulls with per-chunk retries — not a single `cat` of the whole file). Path A onboard viewer and Path B console are **not** shipped yet.

**XOR:** when onboard feed is active, disable dense laptop dual-poll (document now; prefs wiring follows).

## Capabilities (target)

- Collect chart-relevant signals: valves, sensors, pump currents (R_IS/L_IS), heater PWM, pump power/on, temps, host-health-ish fields.
- Append-only **ring log**, default **24 h** retention (configurable from SM).
- SM can **install / uninstall**, toggle **autostart**, set **retention**, check **status/health**, **view** recent data, **download** ring files.
- Serve data **on request** (localhost HTTP; SM pulls via SSH `curl` or file read) — minimize load.
- Warn when milk/coffee/water are not on expected IPs (even if data is present).
- Fail soft: local NATS only, rate limits, pause/backoff, do not compete with `cm-drv`. Soft-fail SSH — never brick complexos.

## Improvements (baked into plan)

1. **Delta + heartbeat** — ring stores state-change events + periodic full snapshot (1–5 s), not a full dump every 200 ms.
2. **`v: 1` schema** on every record; **seriesKey** parity with SM (`milk.drain`, …).
3. **Single-writer lock** (pidfile / flock) against double install.
4. **NATS watchdog** — after N consecutive failures, back off interval; **no DX hammer** while NATS down.
5. **Config file** (`config.yaml` / `json`) for expected IPs + retain/interval; CLI overrides.
6. **Soft CPU** — Nice=10; max NATS in-flight=1 (serialize reads); soft-fail ticks.
7. **SM XOR** — dense laptop poll must disable when onboard feed is active.
8. **3.x profile** — skip DX `:8000`; different subjects (later).
9. **Install via SM bundle** — copy package to `/home/pi/sm-lab-logger` + systemd **user** unit (no `git` on the complex).
10. **Offline viewer** reuses the same `seriesKey` names.
11. **Stdlib-only Python 3.9+** — done end-to-end: NATS behind `TelemetrySource` (FakeSource for tests/demo; real NATS via stdlib `mini_nats.py`, no `nats-py`/pip, for the field install).
12. **`GET /lab/health`** (and snapshot/events) on **127.0.0.1 only**.
13. **Topology IP warnings** when milk/coffee/water are not on expected addresses.

## Package

`tools/complexos-lab-logger/` — `sm_lab_logger` + unittest (stdlib).

```bash
python -m unittest discover -s tools/complexos-lab-logger/tests -v
python tools/complexos-lab-logger/main.py --dry-run --data-dir ./data
python tools/complexos-lab-logger/main.py --fake-source --ticks 5 --http-port 8765 --data-dir ./data
```

**Canonical install path on complexos (SSH user `pi`):**

| What | Path |
|------|------|
| Package + config + data | `/home/pi/sm-lab-logger` |
| Telemetry ring | `/home/pi/sm-lab-logger/data/lab-events.jsonl` |
| systemd --user unit | `/home/pi/.config/systemd/user/sm-lab-logger.service` (`~/.config/systemd/user/sm-lab-logger.service`) |
| HTTP (localhost only) | `http://127.0.0.1:8765/lab/health` |

**Host LAN reachability** is a **sibling** tool — see [`HOST_PING.md`](./HOST_PING.md) (`/home/pi/sm-host-ping`, SM «Доступность»). Not part of lab-logger.

SM install, status, and autostart all use these absolute paths (not a bare `$HOME` that could differ by SSH user). User units need `XDG_RUNTIME_DIR` over SSH; SM sets it and may call `loginctl enable-linger` so the service survives without a GUI session.

## Phases

1. Notes + branch — **done**
2. **Phase 1 core** — schema / ring / topology / config — **done**
3. **Phase 1.5** — FakeSource loop + delta/heartbeat + PidLock + Watchdog + localhost HTTP — **done**
4. Phase 1.6 — real NATS adapter — **done**: stdlib-only `mini_nats.py` client (no `nats-py`, no pip); facade status + pumps/valves/heaters.status
5. **Phase 2 — SM install/control** — left-nav install/uninstall/autostart/retention/status/view/download (series-4) — **done**, field-hardened (see changelog)
6. **Path A** — onboard read-only web viewer on complex LAN
7. **Path B** — series-4 local Linux console (later; no fleet/cloud)

## Safety

Do not bind the HTTP API publicly. When SM uses onboard data, disable dense dual NATS polling from the laptop (XOR). Prefer additive UI; soft-fail all remote ops.

## Manual field check (without breaking live monitor)

1. Keep Modules Lab / telemetry as-is; open **«Бортовой лог»** only.
2. With session connected to a **4.x** complex: open **«Бортовой лог»** → confirm path `/home/pi/sm-lab-logger` is shown → **Статус** → **Установить** → **Статус** again (expect `установлен`, `path=…`, `autostart=on|off`, not `не установлен`) → View → Download → Autostart off → Uninstall (missing unit = soft ok).
3. Confirm ERP / NATS / Modules page still work; uninstall leaves no residual `sm-lab-logger` process.
