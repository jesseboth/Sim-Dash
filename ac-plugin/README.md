# SimDash UDP — Assetto Corsa Plugin

Broadcasts real-time telemetry from Assetto Corsa to the SimDash server via UDP.

## Installation

1. Copy the `SimDashUDP` folder into your Assetto Corsa apps directory:
   ```
   <AC root>\apps\python\SimDashUDP\
   ```
2. Launch Assetto Corsa (or Content Manager), go to **Options → General → Apps** and enable **SimDash UDP**.

## Configuration

### In-game (recommended)

Enable the **SimDash UDP** app from the in-game apps sidebar. A small settings window will appear with:

- **IP Address** — the IP of the machine running the SimDash server
- **Port** — UDP port (default: `20778`)
- **Save** button — applies immediately and writes to `config.ini`

### Manual

Edit `config.ini` directly (found in the `SimDashUDP` folder):

```ini
[Network]
ip = 127.0.0.1
port = 20778
update_rate_hz = 40
```

| Key              | Default     | Description                                      |
|------------------|-------------|--------------------------------------------------|
| `ip`             | `127.0.0.1` | IP address of the SimDash server                 |
| `port`           | `20778`     | UDP port                                         |
| `update_rate_hz` | `40`        | Number of packets the app sends each second. The app sends at this rate at all frame rates. |

Changes to `config.ini` take effect on the next AC launch. Use the in-game window to apply changes without restarting.

## Notes

- Use `127.0.0.1` if SimDash is running on the same machine as AC.
- Use the machine's LAN IP (e.g. `192.168.1.x`) if SimDash is running on a separate device.
- The plugin uses raw Winsock via `ctypes` — no extra Python dependencies are required.
