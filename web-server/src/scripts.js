const repeat = setInterval(set_display, 25);
const another = setInterval(get_telemetryType, 1000 * 10);
const ipAddress = window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/) != null
  ? window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/)[1] : "localhost";
  telemetry = null;
  telemetryType = null;
  yellowRPMPecentage = 0;
  dirty = false;
  tractionBlink = 0;
  launchControl = false;
  launchControlTime = 0.0;
  launchControlBlink = 0;
  launchControlComplete = false;
  launchControlSpeed = 0;
  bestLap = -1;
  
  OdometerInfo = {
    carNumber: 0,
    meters: 0
  };

  LapNumber = -1;

  // Define temperature range (adjust as needed)
  const coldTemperature = 180;
  const normalTemperature = 220;
  const hotTemperature = 280;
  const splitDistance = 12;
  const timeDelay = 2;
  var countDelay = 0;
  const invalidSplit =  9999999999.0
  defaultData = false;
  set_default();

  
setTimeout(function() {
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
  if(!defaultData){
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
    GOLF_R = 3533;
    getOdometer(GOLF_R);
    setTimeout(() => {
      updateDistance(OdometerInfo.meters)
    }, 250);
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

gearChangeTicks = 0;
defaultTicks = 0;
async function set_display() {
  get_data(); // Wait for the data to be fetched and parsed

  data = telemetry
  if (data == null || data["IsRaceOn"] != 1) {
    // wait 2 minutes to set default
    if(!defaultData && defaultTicks >= 1200){
      set_default();
    }
    else if(!defaultData){
      defaultTicks++;
    }
    else if(defaultData){
      updateTime("time", null)
    }
    return;
  }
  else if(defaultData){
    defaultData = false;
  }

  defaultTicks = 0;
  gear = data["Gear"];
  if(gear == 11){
    gearChangeTicks++;
  }
  else{
    gearChangeTicks = 0;
    updateGear(gear)
  }

  if(gearChangeTicks >= 10){
    gearChangeTicks = 0;
    updateGear(gear)
  }

  getOdometer(data["CarOrdinal"])
  updateDistance(OdometerInfo.meters)

  updateFuel(data["Fuel"]*100)
  configureRPM(data["EngineMaxRpm"])
  updateRPM(data["CurrentEngineRpm"], data["EngineMaxRpm"])
  updateSpeed(mpstomph(data["Speed"]))

  checkDirtyLap(data["SurfaceRumbleFrontRight"],
                  data["SurfaceRumbleFrontLeft"],
                  data["SurfaceRumbleRearRight"],
                  data["SurfaceRumbleRearLeft"],
                  data["CurrentLap"])

  // figure out if delay is required
  if(data["CurrentLap"] == 0 || data["DistanceTraveled"] < 0) {
    countDelay++;
  }

  if(data["DistanceTraveled"] > 0){
    if(countDelay < 2 && data["CurrentLap"] < timeDelay){ 
      updateTime("time", data["LastLap"])
      if(bestLap > 0){
        updateSplit(data["LastLap"] - bestLap);
      }
    }
    else {
      updateTime("time", data["CurrentLap"])
      updateSplit(data["Split"]);
      updateDirtyLap(dirty);
    }
  }
  else if(data["DistanceTraveled"] < 0){
    updateTime("time", 0);
    updateSplit(invalidSplit);
    updateDirtyLap(false);
  }
  else if(data["DistanceTraveled"] == 0){
    updateTime("time", null);
    updateSplit(invalidSplit);
    updateDirtyLap(false);
  }

  updateTime("clock", getCurrentTimeUnformatted(), false)

  // reset delay
  if(data["DistanceTraveled"] > 0 && data["CurrentLap"] >= timeDelay){
    countDelay = 0;
    bestLap = data["BestLap"];
  }

  if(data["SessionBestLap"] == 0 && data["Speed"] < .01 && data["CurrentEngineRpm"] > 2100 && 
      (data["Clutch"] == 255 || data["HandBrake"] == 255 || data["Accel"] > 128)){
    launchControl = true;
  }
  else if(launchControl && data["CurrentEngineRpm"] - 10 < data["EngineIdleRpm"]){
    launchControl = false;
  }

  if(launchControl){
    updateLaunchControl(mpstomph(data["Speed"]))
  } else {
    if(data["CurrentTime"] != 0){
      if(data["BestLap"] != 0){
        updateTime("best-time", data["BestLap"])
      }
      else {
        updateTime("best-time", data["SessionBestLap"])
      }
    }
    else{
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
  if(data.hasOwnProperty("TireWearFrontRight")){
    updateTireWear("FR", 100*(1-data["TireWearFrontRight"]))
    updateTireWear("FL", 100*(1-data["TireWearFrontLeft"]))
    updateTireWear("RR", 100*(1-data["TireWearRearRight"]))
    updateTireWear("RL", 100*(1-data["TireWearRearLeft"]))
  }
  else{
    updateTireWear("FR", null);
    updateTireWear("FL", null);
    updateTireWear("RR", null);
    updateTireWear("RL", null);
  }

}

function updateFuel(percentage) {
  var redWidth = Math.min(percentage, 15); // Limit to 15%
  document.getElementById("status-bar-fill").style.width = redWidth + "%";
  var fillWhite = document.getElementById("status-bar-fill-white");

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

function updateTime(id, time, minutes=true) {
  formattedTime = formatTime(time, minutes)
  if (time != null && time != 0) {
    document.getElementById("container-"+id).style.display = "inline-flex";
    document.getElementById(id).textContent = formattedTime;
  }
  else {
    if(id == "time" && time == null){
      document.getElementById("container-"+id).style.display = "inline-flex";
      document.getElementById(id).textContent = getCurrentTime();
    }
    else {
      document.getElementById("container-"+id).style.display = "none";
    }
  }
}

function updateSpeed(speed) {
  document.getElementById("speed").textContent = parseInt(speed)
}

function updateDistance(_distance) {
  distance = Math.max(0, parseInt(_distance));
  if(_distance == 0.0){
    document.getElementById("distance").textContent = "- mi"
  }
  else {
    document.getElementById("distance").textContent = String(metersToMiles(distance)) + " mi"
  }
}

function updateRPM(rpm, _maxRPM) {
  maxRPM = fixMaxRpm(_maxRPM)
  totalRPM = (Math.ceil(maxRPM / 1000) + 3) * 1000;
  percentage = ((1000 + rpm) / (totalRPM)) * 100;

  var greenWidth = Math.min(percentage, yellowRPMPecentage); // Limit to 15%
  document.getElementById("rpm").style.width = greenWidth + "%";

  if(percentage >= 15){
    var fillWhite = document.getElementById("rpm-yellow");
    fillWhite.style.left = greenWidth + "%";
    fillWhite.style.width = (percentage - greenWidth) + "%";
  }

  // document.getElementById("rpm").style.width = (percentage) + "%";
  document.getElementById("rpm-indicator").style.left = (percentage - .5) + "%";
}

function updateTireWear(tire, percentage) {
  if(percentage == null){
    document.getElementById(tire+"tire-bar").style.display = "none"
    return;
  }
  else{
    document.getElementById(tire+"tire-bar").style.display = "block"
  }

  var redWidth = Math.min(percentage, 15); // Limit to 15%
  document.getElementById(tire+"tire-bar-fill-red").style.height = redWidth + "%";
  var fillWhite = document.getElementById(tire+"tire-bar-fill-white");

  if (percentage >= 15) {
    fillWhite.style.bottom = redWidth + "%";
    fillWhite.style.height = (percentage - redWidth) + "%";
  }
  else{
    fillWhite.style.height = "0%";
  }
}

function updateTireTemp(tire, temp){
  const temperature = parseInt(temp);
  const tireDiv = document.getElementById(tire);
  const r = 167;
  const g = 167;
  const b = 167;
  if (temperature <= coldTemperature) {
    const percentage = (temperature - 0) / (coldTemperature - 0);
    rcolor = 0 + (r - 0) * percentage;
    gcolor = 100 + (g-100) * percentage;
    bcolor = 255 + (b-255) * percentage;
    tireDiv.style.backgroundColor = "rgb("+ rcolor + "," + gcolor  + "," + bcolor + ")";;

  } else if (temperature > normalTemperature) {
    const percentage = Math.min(1, (temperature - normalTemperature) / (hotTemperature - normalTemperature));
    // startValue + (endValue - startValue) * percentage
    rcolor = r + (255 - r) * percentage;
    gcolor = g + (0 - g) * percentage;
    bcolor = b + (0 - b) * percentage;
    tireDiv.style.backgroundColor = "rgb("+ rcolor + "," + gcolor  + "," + bcolor + ")";;
  } 
  else {
    tireDiv.style.backgroundColor = "rgb("+ r + "," + g + "," + b + ")";
  }
}

function updatePosition(pos){
  if(pos == 0){
    document.getElementById("position").style.display = "none"
    return;
  }
  document.getElementById("position").style.display = "block"
  document.getElementById("position").textContent = getPositionSuffix(pos)
}

function updateDirtyLap(showdirty){
  if(showdirty){
    document.getElementById("caution").style.display = "inline-block"
  }
  else{
    document.getElementById("caution").style.display = "none"
  }
}

function updateTraction(tireSlipFront, tireSlipRear){
  const Blinkon = 20;
  const Blinkoff = 40;
  if(tireSlipFront > 2 || tireSlipRear > 2){
    tractionBlink++;
    if(tractionBlink <= Blinkon){
      document.getElementById("traction").style.display = "inline-block";
    }
    else if(tractionBlink <= Blinkoff){
      document.getElementById("traction").style.display = "none";
    }
    else{
      tractionBlink = 0;
    }
  }
  else{
    if(tractionBlink > 0 && tractionBlink <= Blinkon){
      tractionBlink++;
      document.getElementById("traction").style.display = "inline-block";
    }
    else if (tractionBlink > Blinkon && tractionBlink <= Blinkoff){
      tractionBlink++;
      document.getElementById("traction").style.display = "none";
    }
    else{
      document.getElementById("traction").style.display = "none";
      tractionBlink = 0;
    }
  }
}


function updateLaunchControl(speed){
  if(!launchControlComplete && speed > .1 && speed < 60){
    launchControlTime += .025;
    updateTime("best-time", launchControlTime);
  }
  else if(!launchControlComplete && speed >= 60){
    launchControlComplete = true;
  }
  else if(launchControlComplete && launchControlBlink < 300){
    launchControlBlink++;
    if(launchControlBlink % 30 == 0){
      updateTime("best-time", null)
    }
    else if(launchControlBlink % 15 == 0){
      updateTime("best-time", launchControlTime)
    }

  }
  else if ((speed < .1 && launchControlTime > 0) || (launchControlComplete && launchControlBlink == 300)){
    updateTime("best-time", null)
    launchControl = false;
    launchControlBlink = 0;
    launchControlTime = 0.0;
    launchControlComplete = false;
    launchControlSpeed = 0.0;
  }
}

function updateSplit(split){
  if(split >= invalidSplit){
    document.getElementById("split").style.display = "none"
    return;
  }

  ShowMinutes = (split > 60 || split < -60) ? true :  false;

  if(split <= 0){
    document.getElementById("split").style.color = "#00c721"
    document.getElementById("split").textContent = "-" + formatTime(-1*split, ShowMinutes)
  }
  else {
    document.getElementById("split").style.color = "#c90000"
    document.getElementById("split").textContent = "+" + formatTime(split, ShowMinutes)
  }
  document.getElementById("container-split").style.left = ShowMinutes ? "80%" : "81%"
  document.getElementById("split").style.display = "contents"
}

function configureRPM(_maxRPM) {
  maxRPM = fixMaxRpm(_maxRPM)
  const gridContainer = document.getElementsByClassName("grid-container")[0];
  const gridElements = document.getElementsByClassName("grid-item");
  for (let i = gridElements.length - 1; i >= 0; i--) {
    gridElements[i].remove();
  }

  rpmboxes = Math.ceil((maxRPM) / 1000) + 1;
  for (let i = 0; i < rpmboxes; i++) {
    // Create a new grid item element
    const gridItem = document.createElement('div');
    gridItem.classList.add('grid-item');
    if(rpmboxes < 12){
      gridItem.textContent = i;
    }
    else if(i != 0 && i != rpmboxes-1){
      gridItem.textContent = i;
    }

    // Append the grid item to the grid container
    gridContainer.appendChild(gridItem);
  }

  for (i = 0; i < rpmboxes; i++) {
    if (i >= rpmboxes - 2) {
      document.getElementsByClassName("grid-item")[i].classList.add("rpmRed");
    }
    else {
      document.getElementsByClassName("grid-item")[i].classList.remove("rpmYellow", "rpmRed");
    }
  }


  if (document.querySelectorAll('.grid-item').length > 10) {
    document.querySelector('.grid-container').classList.add('over-ten');
  }
  else {
    document.querySelector('.grid-container').classList.remove('over-ten');
  }

  // yellow start
  rpm = (rpmboxes - 4) * 1000;
  totalRPM = (Math.ceil(maxRPM / 1000) + 3) * 1000;
  percentage = ((1000 + rpm) / (totalRPM)) * 100;
  yellowRPMPecentage = percentage
  document.getElementById("rpm-yellow").style.left = percentage + "%"
}

// HELPERS
function formatTime(floatSeconds, showMinutes = true) {
  // Convert float seconds to integer milliseconds
  var formatTime = "";
  var totalMilliseconds = Math.floor(floatSeconds * 1000);

  // Calculate minutes, seconds, and milliseconds
  if(showMinutes) {
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

function fixMaxRpm(maxRPM){
  if(maxRPM % 1000 == 0){
    return maxRPM+1000
  }
  
  return maxRPM;
}

function load(){
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
  return hours + (minutes/100);
}

function getOdometer(carNumber, offset=0){
  if(carNumber == 0){
    OdometerInfo.meters = 0;
    OdometerInfo.carNumber = carNumber;
    return 0;
  }

  fetch("/Odometer", {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({carNumber: carNumber, meters: null})
  })
  .then(response => {
      if (response.ok) {
          return response.json();
      }
  })
  .then(data => {
    if(data != null){
      OdometerInfo.carNumber = carNumber
      OdometerInfo.meters = data.meters;
    }
  })
  .catch(error => {
      console.error('Error sending data to server:', error);
  });
}

function checkDirtyLap(FR, FL, RR, RL, time){
  if(dirty && time < 1.0){
    dirty = false;
  }

  if(!dirty && FR > 1 && FL > 1 && RR > 1 && RL > 1){
    dirty = true
  }
}