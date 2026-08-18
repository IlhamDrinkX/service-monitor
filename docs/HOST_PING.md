# Host ping (complexos LAN reachability)

Standalone agent — **sibling** of onboard lab-logger, not part of «Бортовой лог».

## Paths

| What | Path |
|------|------|
| Install root | `/home/pi/sm-host-ping/` |
| Config | `/home/pi/sm-host-ping/config.json` |
| Active log | `/home/pi/sm-host-ping/data/host-ping.jsonl` |
| Rotated | `/home/pi/sm-host-ping/data/host-ping-YYYYMMDD.jsonl` |
| systemd --user | `/home/pi/.config/systemd/user/sm-host-ping.service` (`sm-host-ping.service`) |

Package: `tools/complexos-host-ping/`. SM UI: left-nav **«Доступность»**.

## Behaviour

- Interval **30s** for all targets (LAN TCP/ICMP; WAN ICMP to `erp.fibbee.com`, `91.206.15.66`, `8.8.8.8`)
- Record **only** up↔down changes
- **Snapshot** of all hosts every **5 minutes**
- If `erp` / `fibbee` go offline: **traceroute** into the same jsonl (`kind=trace`); again on the 5‑min snapshot if still down
- On start, seed last state from the ring so restarts do not re-spam identical lines
- Retain **≥14 days**; rotate to dated file when over max bytes **and** free disk allows
- Soft-fail; Nice=10; series-4; never bricks complex

## Log line schema (jsonl)

```json
{"v":1,"ts":1786375055023.159,"at":"2026-08-11T10:17:35","kind":"host","module":"tablet","name":"reachable","value":"оффлайн"}
{"v":1,"ts":1786375055023.159,"at":"2026-08-11T10:17:35","kind":"trace","module":"erp","name":"traceroute","value":"1  192.168.1.1 ..."}
```

| Field | Meaning |
|-------|---------|
| `ts` | epoch ms (machine) |
| `at` | local wall time `YYYY-MM-DDTHH:MM:SS` |
| `value` | `онлайн` / `оффлайн` (legacy `0`/`1` still parsed) |

SM «Показать недавние смены» pretty-prints: `2026-08-11T10:17:35  tablet  оффлайн`.

## Default targets

| Role | IP | TCP |
|------|-----|-----|
| complexos | 192.168.1.43 | :22 |
| milk | 192.168.1.44 | :8000 |
| coffee | 192.168.1.45 | :8000 |
| water | 192.168.1.46 | :8000 |
| router | 192.168.1.1 | :80 |
| erp | erp.fibbee.com | ICMP |
| fibbee | 91.206.15.66 | ICMP |
| dns | 8.8.8.8 | ICMP |
| tablet | from config | ICMP then TCP :5555/:8080/:443 |

## Tablet IP / MAC

On **«Доступность»**, fill visible **IP** and/or **MAC** fields (not `window.prompt` — often broken in Electron). Both empty → clear RU error + focus fields (no silent install). MAC soft-accepts `aa:bb:…` / `aa-bb-…` / 12 hex and is stored as lowercase `aa:bb:…`.

`config.json` fragment:

```json
{
  "tablet": { "ip": "192.168.1.28", "mac": "aa:bb:cc:dd:ee:ff" },
  "ping_interval_sec": 30,
  "snapshot_minutes": 5,
  "retain_days": 14
}
```

- IP only → ping that IP (TCP :80, then ICMP)
- MAC only → soft-resolve via `ip neigh` / `arp` each tick; if tablet Wi‑Fi is off, **оффлайн is expected** (no neigh entry)
- Both → store both; probe uses IP; MAC re-resolve when tablet stays down (stale DHCP)

## SM usage

1. Session Local (`pi@192.168.1.43:22`) or Remote (`ssh -J tun@erp.fibbee.com -p 22409 pi@localhost` for 4.09; port `22000+major*100+minor`)
2. Open **«Доступность»**
3. Enter tablet IP and/or MAC in the page fields → **Задать цели…** (writes remote config if already installed) or **Установить**
4. Status / Autostart / Download log / View recent changes

**Redeploy:** after updating SM, **reinstall** host-ping from «Доступность» so complex picks up the new `main.py` / `sm_host_ping` (format + change-only seed). Restart Electron once if IPC/main changed; renderer HMR is enough for page-only tweaks.

Remote install/status uses a **separate** OpenSSH with ProxyJump (same as lab-logger) — not bare `127.0.0.1:sshPort` (session tunnel only forwards HTTP/NATS).

Do **not** mix into LabLoggerPage.

## Tests

```bash
python -m unittest discover -s tools/complexos-host-ping/tests -v
```

Core helpers: `packages/core/src/nats/host-ping.ts` (+ `host-ping.test.ts`).

After adding IPC: **restart Electron once**.
