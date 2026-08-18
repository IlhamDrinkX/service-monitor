# complexos host ping

Standalone LAN reachability agent (sibling of lab-logger — **not** part of onboard telemetry).

- Install root: `/home/pi/sm-host-ping/`
- Unit: `sm-host-ping.service` (`~/.config/systemd/user/`)
- Ring: `data/host-ping.jsonl` (change-only up↔down, ≥14 days)
- Interval: 30s LAN + WAN (`erp.fibbee.com`, `91.206.15.66`, `8.8.8.8`)
- Snapshot: every 5 min; traceroute into the log when WAN is down
- Log value: `онлайн` / `оффлайн` + human `at` time
- Tablet: set IP and/or MAC in `config.json` (MAC soft-resolved via `ip neigh` / `arp`; Wi‑Fi off → оффлайн expected)

See `docs/HOST_PING.md`.
