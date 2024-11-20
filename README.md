#  Forza-Dash

Telemetry dash board guage cluster for Forza games in the style of the Mk8 Golf r guage cluster. Includes timing splits on a class/car/track basis along with an odometer for each car make/model.

## How to Start

This docker.sh script performs the following actions:
- **Builds** a Docker image if it does not already exist.
- **Starts** a Docker container with specified volume mappings and ports.
- **Stops** and **removes** the container.
- **Creates** empty JSON files if they do not exist.
- **Provides** a help guide for usage.
- **Configures** Forza to stream data to the `dash` at port `9999`.

## Requirements

- **Docker** must be installed on your system.

## Usage

Run the script with the following commands:

### 1. Build and Start the Container
```bash
./docker.sh
```
- Builds the `sim-telemetry` Docker image (if it does not exist) and starts the container with the specified ports and volume mappings.

### 2. Stop the Container
```bash
./docker.sh stop
```
- Stops the running container and disables its automatic restart.

### 3. Restart the Container
```bash
./docker.sh restart
```
- Stops, removes, rebuilds, and starts the container.

### 4. Remove the Container
```bash
./docker.sh remove
```
- Stops and removes the container from your system.

### 5. Enter the Container Shell
```bash
./docker.sh enter
```
- Opens an interactive Bash shell inside the running container.

### 6. Display Help
```bash
./docker.sh help
```
- Displays help information and usage instructions.

## Configuration

### Environment Variables
- **`IMAGENAME`**: Name of the Docker image (`sim-telemetry`).
- **`CONTAINERNAME`**: Name of the Docker container (`sim-telemetry-container`).
- **`PORTS`**: Ports exposed by the container (`8888`, `3000`, `9999`).
- **`SCRIPT_DIR`**: Directory containing the script.
- **`VOLUMES`**: Volume mappings between the host and the container.

### Volume Structure
The script maps the following directories:
- `web-server/data` and `telemetry/data` directories from the host to corresponding directories inside the container (`/usr/src/app/web-server/data` and `/usr/src/app/telemetry/data`).

### Files Created
The script creates empty JSON files (`odometers.json` and `splits.json`) in `web-server/data` if they do not already exist.

## Accessing the Dashboard and Game Selection

1. **Game Selection**:
   - Open a web browser and go to `http://<IP>:3000` (replace `<IP>` with the actual IP address of the machine running the Docker container).
   - This page allows you to select the game you want to use with the telemetry system.

2. **Dashboard Gauge Cluster**:
   - Access the telemetry dashboard at `http://<IP>:3000/dash`.
   - This page displays real-time telemetry data in a gauge cluster format.

## Setting Forza to Stream Data

To configure Forza Motorsport or Forza Horizon to stream data to your `sim-telemetry` dashboard:

1. **Open Forza on your gaming platform**.
2. Navigate to **Settings > HUD and Gameplay** or a similar section with telemetry options.
3. Locate the **Data Out** or **UDP Telemetry** settings.
4. Set the **IP address** to the IP of the machine running the Docker container.
5. Set the **Port** to `9999`.

This will enable Forza to stream real-time telemetry data to the `sim-telemetry` dashboard via port `9999`.

## Script Details

### Functions
- **`build()`**: Builds the Docker image if it doesn't exist.
- **`stop()`**: Stops the container and disables automatic restart.
- **`newJsonFile()`**: Creates an empty JSON file with `{}` content if the file does not exist.
- **`start()`**: Starts the container, ensuring JSON files are present.

### Conditional Logic
- `./docker.sh`: Builds and starts the container.
- `./docker.sh stop`: Stops the container.
- `./docker.sh restart`: Stops, removes, rebuilds, and restarts the container.
- `./docker.sh remove`: Stops and removes the container.
- `./docker.sh enter`: Opens a shell inside the running container.
- `./docker.sh help`: Displays usage instructions.

## Example Command
```bash
./docker.sh restart
```
- This command will stop the container, remove it, rebuild the image, and start a new container.
