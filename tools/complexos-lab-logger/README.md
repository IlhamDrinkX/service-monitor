# complexos-lab-logger

Python onboard Lab logger for **complexos** (not modules Pi).  
Phase **1.5** tools + Phase **2** SM install/control (left-nav «Бортовой лог»). Real NATS (Phase 1.6) — **done**, via stdlib `mini_nats.py`, no `nats-py`/pip.

See `docs/LAB_ONBOARD_LOGGER.md` and local `.agent-notes/SM_LAB_ONBOARD_AGENT.md`.

## Install layout (SM)

```
/home/pi/sm-lab-logger/     # package + config.json + data/
~/.config/systemd/user/sm-lab-logger.service
```

Unit template: `deploy/sm-lab-logger.service`. Metadata: `sm_lab_logger/install_meta.py`.

Default field unit uses **real NATS** (`nats://127.0.0.1:4222`) via a **stdlib-only** client
(`sm_lab_logger/mini_nats.py`) — no `nats-py`, no pip, no internet route needed on complexos.
`--fake-source` is **demo only** (badge «источник: FAKE» in SM) — not useful field data.

## Tests

From repo root:

```bash
python -m unittest discover -s tools/complexos-lab-logger/tests -v
```

## Fake mode (local, no NATS)

```bash
python tools/complexos-lab-logger/main.py --fake-source --ticks 5 --data-dir ./data
python tools/complexos-lab-logger/main.py --fake-source --ticks 20 --http-port 8765 --data-dir ./data --heartbeat-sec 2
```

## CLI

| Flag | Default | Meaning |
|------|---------|---------|
| `--retain-hours` | `24` | Ring retention window |
| `--interval-ms` | `200` | Base poll interval (≥50) |
| `--heartbeat-sec` | `2` | Full snapshot heartbeat |
| `--config` | — | `config.json` / simple `config.yaml` |
| `--http-port` | off | Serve on `127.0.0.1` |
| `--data-dir` | `./data` | Ring + lock directory |
| `--dry-run` | off | Write one heartbeat and exit |
| `--fake-source` | off | Local FakeSource loop (or `fake_source` in config) |
| `--ticks` | `0` | Stop after N ticks |

## Status

Phase 1.5 tools + Phase 2 SM UI/IPC. **Host LAN ping** is a sibling tool: `tools/complexos-host-ping` / SM «Доступность» — not part of this logger. Path A onboard web viewer and Path B local console — later.
