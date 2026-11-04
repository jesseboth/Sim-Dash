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

[Cones]
show_cones = 0
heading_sign = 0
```

| Key              | Default     | Description                                      |
|------------------|-------------|--------------------------------------------------|
| `ip`             | `127.0.0.1` | IP address of the SimDash server                 |
| `port`           | `20778`     | UDP port                                         |
| `update_rate_hz` | `40`        | Number of packets the app sends each second. The app sends at this rate at all frame rates. |
| `show_cones`     | `0`         | 1 shows the cone count window in the game.       |
| `heading_sign`   | `0`         | Direction of the slip angle that the plugin learned. The plugin uses it only if the game does not give the tyre contact points. 0 means not known yet. |

Changes to `config.ini` take effect on the next AC launch. Use the in-game window to apply changes without restarting.

## Cone counter

The plugin counts the cones that the car hits. It sends the count in each packet (`Cones`). The recorder saves the count with the run.

### How it finds the cones

- The plugin reads the track models (`.kn5` files) of the layout. It does not use the object names.
- An object is a cone if it has the size and the shape of a cone: 18–60 cm wide at the base, 28–105 cm high, round, and narrow at the top.
- A pointer cone (a cone on its side) also counts.
- The first time you load a layout, the plugin scans the track in the background. The scan can take some seconds on a large track. The plugin then saves the cone list in `SimDashUDP/cones/`. Then the next sessions on that layout load the list immediately.
- If the track files change, the plugin scans the track again.
- The plugin cannot read encrypted `.kn5` files. On those tracks, the count stays at 0.

### How it counts a hit

A hit is a part of the car that goes 2 cm or more into a cone. Each cone counts one time in each run. The plugin does two tests:

- **Tyres:** each tyre at 3 cm above the ground (the top of a cone base) against the edge of the cone base. The plugin gets the ground contact point and the direction of each tyre from the game. The tyre width comes from `data/tyres.ini` of the car. If that file is not there, the plugin uses 24.5 cm.
- **Body:** the outline of the car from above (from `collider.kn5`) at the height of the lowest body point against the cone width at that height. Thus a bumper that only goes over the base does not hit the cone. The plugin gets the cone width at each height from the cone model.

The result is the same each time you drive the same line:

- All the positions and directions come from the game. The plugin does not estimate them.
- Between two frames, the plugin does a test at each 2 cm of car movement. Thus the frame rate does not change the result.

If the game does not give the tyre contact points, the plugin does only the body test. Then it uses a body height of 15 cm, and it gets the direction of the car from the direction of travel and the slip angle (`heading_sign` in `config.ini`).

- A run starts when the lap timer starts. The count starts at 0.
- The count stops at the finish. The finish is where the lap timer goes back to 0, a lap ends, or the lap timer stops. Hits after the finish do not count.
- The count stays for 20 seconds after the finish. Then it goes to 0 and it shows as "last run". If the next run starts before this, the count goes to 0 immediately.
- If you pause the game in a run, the count continues when the lap timer continues.
- After the first run starts, the plugin does not count hits between runs.
- Online, the plugin works the same. It counts only your car.

### Show the count in the game

Select **Show cone count** in the SimDash UDP window. A small window shows the count of the current run and of the run before. The count is red for 1 second after a hit. You can move the window. The setting is in `config.ini` (`show_cones`).

The SimDash UDP window also shows the scan result (for example "Cones: 48 cones found").

## Notes

- Use `127.0.0.1` if SimDash is running on the same machine as AC.
- Use the machine's LAN IP (e.g. `192.168.1.x`) if SimDash is running on a separate device.
- The plugin uses raw Winsock via `ctypes` — no extra Python dependencies are required.
