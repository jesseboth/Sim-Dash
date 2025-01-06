
yellowRPMPecentage = 0;

bestLap = -1;
LapNumber = -1;

// Define temperature range (adjust as needed)
const coldTemperature = 180;
const normalTemperature = 220;
const hotTemperature = 280;
const timeDelay = 2;
var countDelay = 0;
const invalidSplit = 9999999999.0

function updateFuel(percentage) {
    var redWidth = Math.min(percentage, 15); // Limit to 15%
    document.getElementById("fuel-fill").style.width = redWidth + "%";
    var fillWhite = document.getElementById("fuel-fill-white");

    if (percentage >= 15) {
        fillWhite.style.left = redWidth + "%";
        fillWhite.style.width = (percentage - redWidth) + "%";
    }
    else {
        fillWhite.style.width = "0%"
    }
}

function updateGear(gear) {
    var gearElement = document.getElementById("gear");
    if (gear == 0) {
        gearElement.style.color = "red"
        gearElement.textContent = "R"
    }
    else if (gear > 0 && gear < 11) {
        gearElement.style.color = "#dedede"
        gearElement.textContent = gear
    }
    else {
        gearElement.style.color = "#207dde"
        gearElement.textContent = "N"
        return;
    }
}

function updateTime(id, time, minutes = true) {
    formattedTime = formatTime(time, minutes)
    if (time != null && time != 0) {
        document.getElementById("container-" + id).style.display = "inline-flex";
        document.getElementById(id).textContent = formattedTime;
    }
    else {
        if ((!config.seperateTime && id == "time" && time == null) 
            || (config.seperateTime && id == "clock" && time == null)) {
            document.getElementById("container-" + id).style.display = "inline-flex";
            document.getElementById(id).textContent = getCurrentTime();
        }
        else {
            document.getElementById("container-" + id).style.display = "none";
        }
    }
}

function updateSpeed(speed) {
    document.getElementById("speed").textContent = parseInt(speed)
}

function updateDistance(_distance) {
    distance = Math.max(0, parseInt(_distance));
    if (_distance == 0.0) {
        document.getElementById("distance").textContent = "- mi"
    }
    else {
        document.getElementById("distance").textContent = String(metersToMiles(distance)) + " mi"
    }
}

function updateTireWear(tire, percentage) {
    if (percentage == null) {
        document.getElementById(tire + "tire-bar").style.display = "none"
        return;
    }
    else {
        document.getElementById(tire + "tire-bar").style.display = "block"
    }

    var redWidth = Math.min(percentage, 15); // Limit to 15%
    document.getElementById(tire + "tire-bar-fill-red").style.height = redWidth + "%";
    var fillWhite = document.getElementById(tire + "tire-bar-fill-white");

    if (percentage >= 15) {
        fillWhite.style.bottom = redWidth + "%";
        fillWhite.style.height = (percentage - redWidth) + "%";
    }
    else {
        fillWhite.style.height = "0%";
    }
}

function updateTireTemp(tire, temp) {
    const temperature = parseInt(temp);
    const tireDiv = document.getElementById(tire);
    const r = 167;
    const g = 167;
    const b = 167;
    if (temperature <= coldTemperature) {
        const percentage = (temperature - 0) / (coldTemperature - 0);
        rcolor = 0 + (r - 0) * percentage;
        gcolor = 100 + (g - 100) * percentage;
        bcolor = 255 + (b - 255) * percentage;
        tireDiv.style.backgroundColor = "rgb(" + rcolor + "," + gcolor + "," + bcolor + ")";;

    } else if (temperature > normalTemperature) {
        const percentage = Math.min(1, (temperature - normalTemperature) / (hotTemperature - normalTemperature));
        // startValue + (endValue - startValue) * percentage
        rcolor = r + (255 - r) * percentage;
        gcolor = g + (0 - g) * percentage;
        bcolor = b + (0 - b) * percentage;
        tireDiv.style.backgroundColor = "rgb(" + rcolor + "," + gcolor + "," + bcolor + ")";;
    }
    else {
        tireDiv.style.backgroundColor = "rgb(" + r + "," + g + "," + b + ")";
    }
}

function updatePosition(pos) {
    if (pos == 0) {
        document.getElementById("position").style.display = "none"
        return;
    }
    document.getElementById("position").style.display = "block"
    document.getElementById("position").textContent = getPositionSuffix(pos)
}

dirty = false;
function updateDirtyLap(showdirty) {
    if (showdirty) {
        document.getElementById("caution").style.display = "inline-block"
    }
    else {
        document.getElementById("caution").style.display = "none"
    }
}

tractionBlink = 0;
function updateTraction(tireSlipFront, tireSlipRear) {
    const Blinkon = 20;
    const Blinkoff = 40;
    if (tireSlipFront > 2 || tireSlipRear > 2) {
        tractionBlink++;
        if (tractionBlink <= Blinkon) {
            document.getElementById("traction").style.display = "inline-block";
        }
        else if (tractionBlink <= Blinkoff) {
            document.getElementById("traction").style.display = "none";
        }
        else {
            tractionBlink = 0;
        }
    }
    else {
        if (tractionBlink > 0 && tractionBlink <= Blinkon) {
            tractionBlink++;
            document.getElementById("traction").style.display = "inline-block";
        }
        else if (tractionBlink > Blinkon && tractionBlink <= Blinkoff) {
            tractionBlink++;
            document.getElementById("traction").style.display = "none";
        }
        else {
            document.getElementById("traction").style.display = "none";
            tractionBlink = 0;
        }
    }
}


launchControl = false;
launchControlTime = 0.0;
launchControlBlink = 0;
launchControlComplete = false;
launchControlSpeed = 0;
function updateLaunchControl(speed) {
    if (!launchControlComplete && speed > .1 && speed < 60) {
        launchControlTime += .025;
        updateTime("best-time", launchControlTime);
    }
    else if (!launchControlComplete && speed >= 60) {
        launchControlComplete = true;
    }
    else if (launchControlComplete && launchControlBlink < 300) {
        launchControlBlink++;
        if (launchControlBlink % 30 == 0) {
            updateTime("best-time", null)
        }
        else if (launchControlBlink % 15 == 0) {
            updateTime("best-time", launchControlTime)
        }

    }
    else if ((speed < .1 && launchControlTime > 0) || (launchControlComplete && launchControlBlink == 300)) {
        updateTime("best-time", null)
        launchControl = false;
        launchControlBlink = 0;
        launchControlTime = 0.0;
        launchControlComplete = false;
        launchControlSpeed = 0.0;
    }
}

function updateSplit(split) {
    if (split >= invalidSplit) {
        document.getElementById("split").style.display = "none"
        return;
    }

    ShowMinutes = (split > 60 || split < -60) ? true : false;

    if (split <= 0) {
        document.getElementById("split").style.color = "#00c721"
        document.getElementById("split").textContent = "-" + formatTime(-1 * split, ShowMinutes)
    }
    else {
        document.getElementById("split").style.color = "#c90000"
        document.getElementById("split").textContent = "+" + formatTime(split, ShowMinutes)
    }

    if(ShowMinutes){
        document.getElementById("container-split").classList.remove("container-split")
        document.getElementById("container-split").classList.add("container-split-showMinutes")
    }
    else {
        document.getElementById("container-split").classList.remove("container-split-showMinutes")
        document.getElementById("container-split").classList.add("container-split")
    }
    document.getElementById("split").style.display = "contents"
}

function checkDirtyLap(FR, FL, RR, RL, time) {
    if (dirty && time < 1.0) {
        dirty = false;
    }

    if (!dirty && FR > 1 && FL > 1 && RR > 1 && RL > 1) {
        dirty = true
    }
}

// HELPERS
function formatTime(floatSeconds, showMinutes = true) {
    // Convert float seconds to integer milliseconds
    var formatTime = "";
    var totalMilliseconds = Math.floor(floatSeconds * 1000);

    // Calculate minutes, seconds, and milliseconds
    if (showMinutes) {
        var minutes = Math.floor(totalMilliseconds / (60 * 1000));
        formatTime = padWithZero(minutes) + ":";
    }
    var seconds = Math.floor((totalMilliseconds % (60 * 1000)) / 1000);
    var milliseconds = Math.floor((totalMilliseconds % 1000) / 10); // Truncate milliseconds to two digits

    // Format the time
    var formattedTime = formatTime + padWithZero(seconds) + ":" + padWithZero(milliseconds);

    return formattedTime;
}

// Function to pad single-digit numbers with leading zero
function padWithZero(num) {
    return (num < 10 ? '0' : '') + String(num);
}

function load() {
    document.getElementById("load").style.display = "none"
}

function mpstomph(mps) {
    return mps * 2.23694;
}

function metersToMiles(meters) {
    return (meters * 0.000621371).toFixed(0);
}

function getPositionSuffix(position) {
    if (position % 100 >= 11 && position % 100 <= 13) {
        return position + "th";
    }
    switch (position % 10) {
        case 1:
            return position + "st";
        case 2:
            return position + "nd";
        case 3:
            return position + "rd";
        default:
            return position + "th";
    }
}

function getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()) % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function getCurrentTimeUnformatted() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const minutes = now.getMinutes();
    return hours + (minutes / 100);
}


// Override functions for the dash
function initShiftLightRPM(maxRPM){
    // do nothing
}

function configureShiftLight(){
    // do nothing
}

function updateShiftLight(rpm){
    // do nothing
}

function resetShiftLightRPM() {
    // do nothing
}
