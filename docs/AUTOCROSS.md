# Autocross Analyzer - Reference

This document gives the design rules of the autocross analyzer. Read it before you change the recorder, the run format or the analyzer pages. Keep it up to date when you change a rule.

The analyzer is modelled on SoloStorm. The user operates it on an Android tablet in Chrome, often as an installed app.

## 1. Parts

| Part | Location | Function |
|---|---|---|
| AC plugin | `ac-plugin/SimDashUDP/SimDashUDP.py` | Sends one UDP packet per send interval from Assetto Corsa (default 40 Hz). |
| Recorder | `telemetry/src/game/assetto.go` | Finds the start and the finish of a run. Saves the run as JSON. |
| Recorder API | `telemetry/src/util/autocross-api.go` | Port 8888: `/autocross/recording/start`, `/stop`, `/status`, `/driver`. |
| Web server | `web-server/server.js`, `web-server/lib/autocross-*.js` | Port 3000. File storage and the `/api/autocross` actions. |
| Analyzer | `web-server/views/autocross.html`, `web-server/src/autocross-*.js` | Map, charts, scrubber, sectors, align mode, live splits. |

Data is in `telemetry/data/autocross/`:

- `courses.json` - the course list.
- `{courseId}/runs/{runId}.json` - one file for each run.
- `{courseId}/sectors.json` - the sector gates of the course.
- `{courseId}/top10.json` - written by the recorder. The analyzer does not show it.
- `car-names.json`, `track-names.json` - names for the game car and track IDs.
- `armed.json` - the recorder state: armed, course, driver and car.

## 2. Run format

### 2.1 Time

- Time 0 is the point where the game timer starts (the start line).
- The launch is in the run. Launch samples have negative times. Thus the user can compare a good launch with a bad launch.
- The last sample is the finish. The finish is where the game timer stops.
- `lapTime` is the scratch time from the game (`LastLap`). Cone penalties are not in `lapTime`.
- The adjusted time is `lapTime + cones × 2 s` (`CONE_PENALTY`).

### 2.2 Fields

The top level has `runId`, `courseId`, `timestamp`, `lapTime`, `carId`, `trackId`, `cones`, `isValid`, `telemetry` and `statistics`.

The user details are optional: `name`, `driver`, `car` and `notes`. The `updateRun` action sets them. An empty value removes the field.

`telemetry` has one array for each channel. All arrays have the same length as `timestamps`.

| Field | Unit | Note |
|---|---|---|
| `timestamps` | s | Negative during the launch. |
| `speed` | mph | The recorder reads `SpeedMph` from the packet. |
| `accel`, `brake`, `clutch` | 0-1 | |
| `steer` | | |
| `accelX`, `accelY` | g | Lateral and longitudinal. |
| `posX`, `posY`, `posZ` | m | `posX`/`posY` are the map plane. `posZ` is height. |
| `rpm`, `gear` | | |
| `yawRate` | °/s | |
| `bodySlip` | ° | |
| `wheelSpeed`, `slipAngle`, `slipRatio`, `load`, `suspTravel` | | Objects with `fl`, `fr`, `rl`, `rr` arrays. |

Optional channels can be missing in old runs. The analyzer must accept a run without them.

### 2.3 Sample rate

- The recorder keeps a maximum of one sample in each 20 ms slot (50 samples/s). The slot is `floor(t / 0.02)`. Do not use a minimum gap between samples, because game frames have uneven spacing and a gap drops too many samples.
- The longest run is 30 minutes (rally stages).
- The web server thins runs for display: 50 samples/s and a maximum of 15000 samples (`reduceSampleRate`, `MAX_DISPLAY_SAMPLES`). Run-card sector times use the same thinned data. Export sends the full data.

## 3. Recorder rules

1. The user arms the recorder in the analyzer. The page sends the course ID to `/autocross/recording/start`.
2. When the recorder is armed and the course changes, the page arms it again. New runs go to the new course.
3. While no run is active, the recorder keeps a launch buffer:
   - While the speed is less than 1 mph, it keeps only the last 0.5 s.
   - It keeps a maximum of 30 s.
4. The run starts when `CurrentLap` changes from 0 to more than 0. Time 0 is `now - CurrentLap`. The launch buffer goes into the run with negative times.
5. The run ends when `CurrentLap` goes back to 0. The recorder uses `LastLap` as the run time.
6. If the timer does not change for 2 s, the recorder ends the run and removes the frozen samples at the end.
7. If the user disarms the recorder during a run, the recorder discards the run.
8. The recorder encodes the run before it opens the file. A failed encode does not leave an empty file.
9. The recorder accepts packets from older plugins that do not send `YawRate` and `BodySlipAngle` (8 bytes shorter). These values are then 0.

10. The recorder gives its current driver and car (`/autocross/recording/driver`) to each new run. The page sends a car only when the game sends no car ID.

If the page cannot get the recorder status 10 times (2 s), it shows "Recorder offline" and closes the live overlay.

## 4. Assetto Corsa plugin

- The packet is 226 bytes. The Python format is `'<B i 3f B 3f 4i 5f i f 28f 2f 3f 2i i 2f'`. It must agree with `telemetry/packets/AC_packetformat.dat`.
- The speed fields are in this sequence: km/h (`SpeedKmh`), mph (`SpeedMph`), m/s (`Speed`). The dashboards use `Speed` (m/s). The recorder uses `SpeedMph`.
- Yaw rate is `LocalAngularVelocity[1]`, in degrees per second.
- `CarId` and `TrackId` are FNV-1a hashes (31 bits) of the car name and of `track name/layout`. They are the same in each session. Do not use the Python `hash()` function: its value changes each time the game starts.
- Body slip is `atan2(lv.x, lv.z)` in degrees. It is 0 when `lv.z <= 0` or the speed is 2 m/s or less.
- `update_rate_hz` in the plugin settings sets the send rate.
- After you change the plugin, run `ac-plugin/package.sh` to make `SimDashUDP.zip` again. Then copy the plugin to the gaming PC.

## 5. Analyzer features

### 5.1 Runs and sorting

- The user can select a maximum of 6 runs. Each selected run gets a color from the palette `#4a9eff #ff4a4a #4aff4a #ffaa4a #ff4aff #4affff`.
- The most recent run can be purple (`#7d5aff`) ("Keep latest run").
- Sort "Fastest" includes cone penalties. Sort "Scratch" uses `lapTime` only. Sort "Recent" uses the run date.
- A cone tap changes the count immediately. The page saves 500 ms after the last tap.
- A run tap changes the check box immediately and starts the download of the run. The map and charts update 150 ms after the last tap (`SELECTION_SETTLE_MS`), one time for a series of quick taps. Until then, the card of the run pulses.
- `cumulativeDistance` and `progressAlongPath` in `autocross-track.js` keep their results for each run. Thus a new selection calculates only the new runs. Do not change the arrays that they return.

- Run details (✏️ on the run card): name, driver, car and notes. The tap-outside area does not close this dialog, so that typed notes stay.
- The car of a run is its `car` field. If the run has no `car` field, the car is the name of its game car ID (`car-names.json`), else "Car <ID>".
- In the run details, "Use for all runs with game car ID" saves the car name for the ID and removes the `car` field from the run. If the user clears this box, the car name is only for this run.
- The "Driver / Car" button sets the driver and the car for new runs. With live telemetry, the car name is saved for the game car ID.
- The car filter shows when the course has more than one car. It uses car names, so two IDs with the same name are one car.
- The driver lists come from the runs of the course and from the drivers entered on this device (`localStorage`).

### 5.2 Sectors

- A sector is a gate on the course: a position, and a direction when it is known. Gates are a maximum of 15 m either side of the centre.
- Automatic sectors (`lib/autocross-auto-sectors.js`, `createSectors` in `lib/autocross-storage.js`):
  - The server makes the first sectors of a course when the course has runs and no `sectors.json` file. It saves the file, so this occurs only one time. The server never replaces sectors that the user changed. An empty file (the user removed all lines) stays empty.
  - First, the server looks for an earlier course with the same track ID that has sectors. If the fastest run passes all of its lines, the new course gets a copy of these lines.
  - If there is no such course, the server makes lines from the 3 fastest runs:
    - Autocross and track: a line just before each large braking zone (a decrease of 8 mph or more for autocross, 10 mph or more for track). Thus a sector is a braking zone and the corners, sweeper or slalom after it, up to the next large braking zone. Each line is at a straight part of the path. The zones that most runs have, and that have the largest decrease in speed, are used first.
    - Rally: lines at random distances along the stage, approximately equal sector lengths.
  - The type of course comes from the fastest run: a closed circuit longer than 45 s is track, an open path longer than 3 km is rally, all other runs are autocross.
  - Number of sectors: autocross, one sector for each 10 s (3 to 8); track, one sector for each 20 s (3 to 6); rally, 6.
- Run files, exports and imports do not contain sector data. Import removes `sectorTimes` and `sectors` from imported runs.
- Sector times come from the run positions, not from the scrubber time. Sectors must not change when the user aligns runs.
- The START line is the launch point, where the data starts. It is not a timing line.
- Sector 1 (S1) starts at time 0, where the game timer starts. The last sector ends at the finish.
- Each sector line has the label of the sector that starts at it. The first sector line is S2, the second is S3, and so on. The map, the scrubber, the charts and the sector chips use these labels.
- Cones do not add time to a sector. The sector table shows "+1" for each cone.
- Sector marks are white, so that they are different from all run colors.
- The sector statistics table has one column for each run. For each sector it shows: time, entry time, exit time, entry speed, exit speed, average speed, distance, and the average of each shown chart channel that has a `stat`.

### 5.3 Map

- The map draws runs from the slowest to the fastest scratch time. The fastest run is on top. The followed run is on top of all other runs.
- Each car is a dart arrow in the run color. It points in the direction of travel. It is 6 m long in world size, limited to 13-36 px.
- Zoom is a slider, not pinch. The slider is logarithmic, from 0.5 to a zoom that shows approximately 40 m. Thus it is usable on a long rally stage.
- Zoom keeps the screen position of the cars fixed.
- One finger moves the map. The map uses `touch-action: none`, and the page uses `overscroll-behavior: none`. These stop the browser from reloading the page or going back to the game page.

### 5.4 Charts and scrubbing

- Each chart is 160 px high. The title is on the top-left, on a transparent background.
- Charts show a 5 s window. The cursor stays at the centre and the traces move. The window has empty space before the start and after the finish.
- A drag on a chart moves the time. A touch flick continues with a deceleration of 0.998 per ms. A drag stops playback.
- The page decides the drag direction (time or page scroll) once, after 8 px.
- The G channels use smoothing (`smooth: 0.15`).
- Each chart holds only the data from 10 s before to 10 s after its window (`sliceToWindow`). The full data stays in `chart.fullLabels` and in the `full` array of each dataset. Use the full arrays for values at the cursor index. Without this, Chart.js reads all points on each redraw, and long runs become slow.
- Sector lines show on the charts, with labels at the bottom.
- Charts draw runs in the same sequence as the map: the fastest scratch time on top, and the followed run on top of all runs. The values under the cursor stay in a fixed sequence.
- The channel dialog: drag a row to move it. Ctrl/⌘+click or long-press selects more than one row. Then drag the selection as a group. A row moves when the pointer goes into the next row.

### 5.5 Align mode

- The user taps a car on the map. The tap point is the anchor.
- The map shows a ghost arrow at the anchor: a see-through white arrow with a dashed outline.
- Each run gets an offset: `offset = run time at the anchor position - anchor time`. All runs are at the same position at the anchor and then they diverge.
- If a run does not get to the anchor position, its offset uses the furthest point that it got to.
- The time range covers all shifted runs. Playback continues until all arrows get to the finish.
- The gap panel and Time Delta show the gap from the anchor.

### 5.6 Scrolling

`autocross-kinetic.js` gives touch momentum scrolling to the chart list and the channel dialog. Mouse and trackpad scrolling stay native.

### 5.7 App install

All pages have a manifest and the `sw.js` service worker. On Android over plain HTTP, Chrome installs the app only when `chrome://flags/#unsafely-treat-insecure-origin-as-secure` contains the server address.

## 6. Test procedure

1. Use the scratch copy of the app on port 3123, not the deployed app on port 3000.
2. Use the CDP harness (`cdp.mjs <url> <steps.mjs> <shotDir>`) with headless Chrome. For touch tests, enable touch emulation.
3. Test on real runs, not only on synthetic runs. Real Assetto Corsa runs are on plex (`plex@172.22.0.4:~/Develop/Sim-Dash/telemetry/data/autocross`). Those runs stop at 60 s because of an old buffer limit.
4. Deploy with `./docker.sh restart`.

On the development PC, a different application uses port 8888. Then the recorder cannot start. Use a mock recorder for browser tests.

## 7. Known limits

- The pages contain the recorder port (8888) as a fixed value.
- There is no protection against path traversal or script injection. The tool is for a private network only.
- `localStorage` errors are not caught (private browsing).
- Only the Assetto Corsa recorder makes autocross runs.

## 8. Future work

- Re-arm: if the car drives back to the start without a session reset, record the next attempt. Do not save the drive back.
- Lapping mode for track games: each lap is one run.
- Rally: DiRT Rally 2 and EA WRC give stage distance. Use it to align runs by distance.
- Video sync to the timer start and stop.
- Keep new recorder work game-neutral. Each game must only need its own packet parser.
