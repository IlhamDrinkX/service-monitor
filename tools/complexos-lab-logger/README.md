# complexos-lab-logger (stub)

Python onboard Lab logger intended to run on **complexos** (not modules Pi).

See `docs/LAB_ONBOARD_LOGGER.md` and local `.agent-notes/SM_LAB_ONBOARD_AGENT.md`.

## CLI (planned)

```bash
python main.py --retain-hours 24 --interval-ms 200
python main.py --retain-hours 12 --interval-ms 200 --http-port 8765 --data-dir ./data
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--retain-hours` | `24` | Ring retention window |
| `--interval-ms` | `200` | Poll interval (local NATS; back off under load) |
| `--http-port` | off | Optional localhost-only snapshot/events HTTP |
| `--data-dir` | `./data` | Ring + snapshot directory |

## Status

Stub only — poller / systemd unit / SM IPC come next. Do not deploy this stub to field complexes yet.
