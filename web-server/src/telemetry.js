const repeat = setInterval(set_display, 25);
const another = setInterval(get_telemetryType, 1000 * 10);
var position = setInterval(getConfig, 1000 * 10); getConfig();
const ipAddress = window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/) != null
    ? window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/)[1] : "localhost";

telemetry = null;
telemetryType = null;


defaultData = false;
set_default();

setTimeout(function () {
    load();
    get_telemetryType()
}, 250);

function get_data() {
    if (telemetryType == null) {
        telemetry = null;
        return;
    }
    fetch('http://' + ipAddress + ':8888/telemetry')
        .then(response => {
            // Check if the response is successful
            if (!response.ok) {
                telemetry = null;
                return;
            }
            // Parse the JSON response
            return response.json();
        })
        .then(data => {
            telemetry = data;
            return data
            // Handle the JSON data
        })
        .catch(error => {
            // Handle any errors that occur during the fetch operation
            telemetry = null;
            get_telemetryType()
        });
}

function set_default() {
    if (!defaultData) {
        defaultData = true;
        updateDistance(0)
        updateFuel(100)
        updateGear(11)
        configureRPM(7200)
        updateRPM(1200, 7200)
        updateSpeed(0)
        updateTime("time", null)
        updateDirtyLap(false);
        updateTime("best-time", null)
        updateTime("clock", null)
        updateTireTemp("FR", normalTemperature)
        updateTireTemp("FL", normalTemperature)
        updateTireTemp("RR", normalTemperature)
        updateTireTemp("RL", normalTemperature)
        updateTireWear("FR", 100)
        updateTireWear("FL", 100)
        updateTireWear("RR", 100)
        updateTireWear("RL", 100)
        updateTraction(0, 0);
        updatePosition(0)
        updateSplit(invalidSplit)
        get_favoriteOdometer()
        LapNumber = -1;
    }
}

function get_telemetryType() {
    fetch('/telemetrytype')
        .then(response => response.json())
        .then(data => {
            telemetryType = data["type"]
        })
        .catch(error => null);
}

function get_favoriteOdometer() {
    fetch('/odometer')
        .then(response => response.json())
        .then(data => {
            if(data.success == true) {
                updateDistance(data["return"])
                return data["return"]
            }
            else {
                console.error("Error: " + data["error"])
            }
            return 0;
        })
        .catch(error => null);
}


gearChangeTicks = 0;
defaultTicks = 0;
async function set_display() {
    get_data(); // Wait for the data to be fetched and parsed

    data = telemetry
    if (data == null || data["IsRaceOn"] != 1) {
        // wait 2 minutes to set default
        if (!defaultData && defaultTicks >= 1200) {
            set_default();
        }
        else if (!defaultData) {
            defaultTicks++;
        }
        else if (defaultData) {
            if(config.seperateTime) {
                updateTime("clock", getCurrentTimeUnformatted(), false)
            }
            else {
                updateTime("time", null)
            }
        }
        return;
    }
    else if (defaultData) {
        defaultData = false;
    }

    defaultTicks = 0;
    gear = data["Gear"];
    if (gear == 11) {
        gearChangeTicks++;
    }
    else {
        gearChangeTicks = 0;
        updateGear(gear, data["Gear"])
    }

    if (gearChangeTicks >= 10) {
        gearChangeTicks = 0;
        updateGear(gear, data["Gear"])
    }

    updateDistance(data["Odometer"])

    updateFuel(data["Fuel"] * 100)
    configureRPM(data["EngineMaxRpm"])
    updateRPM(data["CurrentEngineRpm"], data["EngineMaxRpm"], data["Gear"])
    updateSpeed(mpstomph(data["Speed"]))

    checkDirtyLap(data["SurfaceRumbleFrontRight"],
        data["SurfaceRumbleFrontLeft"],
        data["SurfaceRumbleRearRight"],
        data["SurfaceRumbleRearLeft"],
        data["CurrentLap"])

    // figure out if delay is required
    if (data["CurrentLap"] == 0 || data["DistanceTraveled"] < 0) {
        countDelay++;
    }

    if (data["DistanceTraveled"] > 0) {
        updateTime("clock", getCurrentTimeUnformatted(), false)
        if (countDelay < 2 && data["CurrentLap"] < timeDelay) {
            updateTime("time", data["LastLap"])
            if (bestLap > 0) {
                updateSplit(data["LastLap"] - bestLap);
            }
        }
        else {
            updateTime("time", data["CurrentLap"])
            updateSplit(data["Split"]);
            updateDirtyLap(dirty);
        }
    }
    else if (data["DistanceTraveled"] < 0) {
        updateTime("clock", getCurrentTimeUnformatted(), false)
        updateTime("time", 0);
        updateSplit(invalidSplit);
        updateDirtyLap(false);
    }
    else if (data["DistanceTraveled"] == 0) {
        updateTime("time", null);
        updateTime("clock", null);
        updateSplit(invalidSplit);
        updateDirtyLap(false);
    }

    // reset delay
    if (data["DistanceTraveled"] > 0 && data["CurrentLap"] >= timeDelay) {
        countDelay = 0;
        bestLap = data["BestLap"];
    }

    if (data["SessionBestLap"] == 0 && data["Speed"] < .01 && data["CurrentEngineRpm"] > 2100 &&
        (data["Clutch"] == 255 || data["HandBrake"] == 255 || data["Accel"] > 128)) {
        launchControl = true;
    }
    else if (launchControl && data["CurrentEngineRpm"] - 10 < data["EngineIdleRpm"]) {
        launchControl = false;
    }

    if (launchControl) {
        updateLaunchControl(mpstomph(data["Speed"]))
    } else {
        if (data["CurrentTime"] != 0) {
            if (data["BestLap"] != 0) {
                updateTime("best-time", data["BestLap"])
            }
            else {
                updateTime("best-time", data["SessionBestLap"])
            }
        }
        else {
            updateTime("best-time", null)
        }
    }
    updateTireTemp("FR", data["TireTempFrontRight"])
    updateTireTemp("FL", data["TireTempFrontLeft"])
    updateTireTemp("RR", data["TireTempRearRight"])
    updateTireTemp("RL", data["TireTempRearLeft"])
    updatePosition(data["RacePosition"])
    updateTraction(data["TireCombinedSlipFrontRight"] + data["TireCombinedSlipFrontLeft"],
        data["TireCombinedSlipRearRight"] + data["TireCombinedSlipRearLeft"])
    if (data.hasOwnProperty("TireWearFrontRight")) {
        updateTireWear("FR", 100 * (1 - data["TireWearFrontRight"]))
        updateTireWear("FL", 100 * (1 - data["TireWearFrontLeft"]))
        updateTireWear("RR", 100 * (1 - data["TireWearRearRight"]))
        updateTireWear("RL", 100 * (1 - data["TireWearRearLeft"]))
    }
    else {
        updateTireWear("FR", null);
        updateTireWear("FL", null);
        updateTireWear("RR", null);
        updateTireWear("RL", null);
    }

}

async function getConfig() {
    const types = ["scale", "dash"];
    const retdata = await fetchConfig(types);

    getDashStyle(retdata.dash);
    getDashPosition(retdata.scale);

}

scaleSpeedUp = false;
async function getDashPosition(scale) {
    if (scale != null) {
        data = scale.return
        document.getElementById("all").style.top = data.top;
        document.getElementById("all").style.left = data.left;
        document.getElementById("all").style.width = data.width;
        document.getElementById("all").style.zoom = data.zoom;
        if (scaleSpeedUp != data["speedUp"]) {
            if(data["speedUp"]){
                scaleSpeedUp = data["speedUp"];
            }
            // clearInterval(position); // Clear any existing interval
            if (scaleSpeedUp) {
                position = setInterval(getDashPosition, 25);
            }
            else {
                position = setInterval(getDashPosition, 1000 * 10);
            }
        }

    }
}

dash = null;
async function getDashStyle(data) {
    if (data != null) {
        if(dash == null){
            dash = data.return;
        }
        else if(dash != data.return){
            dash = data.return;
            location.reload();
        }
    }
}

async function fetchConfig(types) {
    try {
        dict = {}
        for (type of types) {
            dict[type] = "get";
        }

        const response = await fetch("/config", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dict)
        });

        if (!response.ok) {
            console.error("Error: Network response was not ok");
            return null;
        }

        const data = await response.json();
        if (data != null) {
            if (!data.success) {
                console.error("Error: " + data.error);
                return null;
            }

            for (type of types) {
                if (data[type] === undefined) {
                    console.error("Error: " + type + " is undefined");
                }
                else if (!data[type].success) {
                    console.error("Error: " + data[type].error);
                }
            }

            return data;
        }

        return null;
    } catch (error) {
        console.error('Error sending data to server:', error);
        return null;
    }
}