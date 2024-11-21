
# Forza-Dash

Telemetry dashboard gauge cluster for Forza games in the style of the Mk8 Golf R gauge cluster. Includes timing splits on a class/car/track basis along with an odometer for each car make/model.

<div align="center">
   <img src="images/dash.png" alt="Dash" width="75%">
</div>

---

## Supported Games

- **Forza Motorsport**
- **Forza Horizon 5**
- **Forza Motorsport 7** *(untested)*
- **Forza Horizon 4** *(untested)*

---

## Setup

### Overview

- **Server Setup**: Get the Docker container running.
- **Dash Setup**: Learn how to access and configure the dashboard.
- **Forza Setup**: Configure the game to stream telemetry data.

---

<details>
<summary>Server Setup</summary>

### Requirements

- **Docker** must be installed on your system.

### Usage

#### 1. Build and Start the Container
```bash
./docker.sh
```
- Builds the `sim-telemetry` Docker image (if it does not exist) and starts the container with the specified ports and volume mappings.

---

### Configuration

#### Docker Variables
- **`IMAGENAME`**: Name of the Docker image (`sim-telemetry`).
- **`CONTAINERNAME`**: Name of the Docker container (`sim-telemetry-container`).
- **`PORTS`**: Ports exposed by the container (`8888`, `3000`, `9999`).

### Script Details
- **`./docker.sh`**: Builds and starts the container.
- **`./docker.sh stop`**: Stops the container.
- **`./docker.sh restart`**: Stops, removes, rebuilds, and restarts the container.
- **`./docker.sh remove`**: Stops and removes the container.
- **`./docker.sh enter`**: Opens a shell inside the running container.

</details>

---

<details>
<summary>Dash Setup</summary>

### Accessing the Dashboard and Game Selection

1. **Game Selection**:
   - Open a web browser and go to `http://<IP>:3000` (replace `<IP>` with the actual IP address of the machine running the Docker container).
   - This page allows you to select the game you want to use with the telemetry system.
   - You can also scale/move the dash to adjust for setup.

2. **Dashboard Gauge Cluster**:
   - Access the telemetry dashboard at `http://<IP>:3000/dash`.
   - This page displays real-time telemetry data in a gauge cluster format.

#### Game Selection

- Buttons are provided for:
  - Forza Motorsport (`FM`)
  - Forza Horizon 5 (`FH5`)
  - Forza Motorsport 7 (`FM7`)
  - Forza Horizon 4 (`FH4`)
- Click the corresponding button to load the appropriate settings for the selected game.

#### Stop Button

- Clicking the **"Stop"** button halts the telemetry process and resets the dashboard.

#### Dashboard Scaling and Positioning

- Click **"Scale Dash"** to open the scaling and position adjustment interface.
- **Adjusting Settings**:
  - **Scale Up**: Increase dashboard size.
  - **Scale Down**: Decrease dashboard size.
  - **Move Up**: Shift dashboard upward.
  - **Move Down**: Shift dashboard downward.

#### Saving Dashboard Layouts

- After making adjustments:
  - Enter a name for your layout in the input field.
  - Click **Save** to store the layout.
- Layouts are saved server-side and can be loaded later.

#### Loading Saved Layouts

- When clicking **"Scale Dash"**, you'll see a list of available layouts.
- Select a layout to apply it, or choose "Custom" to define a new layout.


</details>

---

<details>
<summary>Forza Setup</summary>

### Setting Forza to Stream Data

To configure Forza Motorsport or Forza Horizon to stream data to your `sim-telemetry` dashboard:

1. **Open Forza on your gaming platform**.
2. Navigate to **Settings > HUD and Gameplay** or a similar section with telemetry options.
3. Locate the **Data Out** or **UDP Telemetry** settings.
4. Set the **IP address** to the IP of the machine running the Docker container.
5. Set the **Port** to `9999`.

This will enable Forza to stream real-time telemetry data to the `sim-telemetry` dashboard via port `9999`.

</details>
