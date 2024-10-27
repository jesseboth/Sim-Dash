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
  
  OdometerInfo = {
    carNumber: 0,
    meters: 0
  };

  SplitInfoReset = {
    bestSplits: [],
    sessionSplits: [],
    splits: [],
    startMeters: Infinity,
    splitTry: 25
  }
  SplitInfo = structuredClone(SplitInfoReset);

  LapNumber = -1;


  // Define temperature range (adjust as needed)
  const coldTemperature = 180;
  const normalTemperature = 220;
  const hotTemperature = 280
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
    updateSplit(0)
    GOLF_R = 3533;
    getOdometer(GOLF_R);
    setTimeout(() => {
      updateDistance(OdometerInfo.meters)
    }, 250);
    SplitInfo = structuredClone(SplitInfoReset);
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
  if (data == null || data[0]["IsRaceOn"] != 1) {
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
  gear = data[4]["Gear"];
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

  getOdometer(data[0]["CarOrdinal"])
  updateDistance(OdometerInfo.meters)
  getSplit(data[0]["CarOrdinal"], data[0]["TrackOrdinal"])

  if(data[3]["LapNumber"] == LapNumber+1){
    LapNumber = data[3]["LapNumber"];
    if((LapNumber == 0 && data[2]["DistanceTraveled"] < 100) || LapNumber > 0){
      SplitInfo.startMeters = data[2]["DistanceTraveled"];
    }
 
    configureLapTime(data[0]["CarOrdinal"], data[0]["TrackOrdinal"], data[2]["CurrentLap"], data[2]["LastLap"], data[2]["BestLap"]);
  }
  else if(data[2]["DistanceTraveled"] < 0){
    LapNumber = data[3]["LapNumber"];
    SplitInfo.startMeters = 0;
  }
  else {
    LapNumber = data[3]["LapNumber"];
  }

  updateSplit(data[2]["DistanceTraveled"], data[2]["CurrentLap"]);

  updateFuel(data[2]["Fuel"]*100)
  configureRPM(data[2]["EngineMaxRpm"])
  updateRPM(data[2]["CurrentEngineRpm"], data[2]["EngineMaxRpm"])
  updateSpeed(mpstomph(data[2]["Speed"]))
  if(data[2]["DistanceTraveled"] > 0){
    updateTime("time", data[2]["CurrentLap"])
  }
  else if(data[2]["DistanceTraveled"] < 0){
    updateTime("time", 0);
  }
  else if(data[2]["DistanceTraveled"] == 0){
    updateTime("time", null);
  }
  checkDirtyLap(data[2]["SurfaceRumbleFrontRight"],
                  data[2]["SurfaceRumbleFrontLeft"],
                  data[2]["SurfaceRumbleRearRight"],
                  data[2]["SurfaceRumbleRearLeft"],
                  data[2]["CurrentLap"])

  updateDirtyLap(dirty);

  if(data[2]["BestLap"] == 0 && data[2]["Speed"] < .01 && data[2]["CurrentEngineRpm"] > 2100 && 
      (data[4]["Clutch"] == 255 || data[4]["HandBrake"] == 255 || data[4]["Accel"] > 128)){
    launchControl = true;
  }
  else if(launchControl && data[2]["CurrentEngineRpm"] - 10 < data[2]["EngineIdleRpm"]){
    launchControl = false;
  }

  if(launchControl){
    updateLaunchControl(mpstomph(data[2]["Speed"]))
  } else {
    updateTime("best-time", data[2]["BestLap"])
  }
  updateTireTemp("FR", data[2]["TireTempFrontRight"])
  updateTireTemp("FL", data[2]["TireTempFrontLeft"])
  updateTireTemp("RR", data[2]["TireTempRearRight"])
  updateTireTemp("RL", data[2]["TireTempRearLeft"])
  updatePosition(data[4]["RacePosition"])
  updateTraction(data[2]["TireCombinedSlipFrontRight"] + data[2]["TireCombinedSlipFrontLeft"], 
                  data[2]["TireCombinedSlipRearRight"] + data[2]["TireCombinedSlipRearLeft"])
  if(data[2].hasOwnProperty("TireWearFrontRight")){
    updateTireWear("FR", 100*(1-data[2]["TireWearFrontRight"]))
    updateTireWear("FL", 100*(1-data[2]["TireWearFrontLeft"]))
    updateTireWear("RR", 100*(1-data[2]["TireWearRearRight"]))
    updateTireWear("RL", 100*(1-data[2]["TireWearRearLeft"]))
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

function updateTime(id, time) {
  formattedTime = formatTime(time)
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

const splitDistance = 50;
function updateSplit(distance, time){
  traveled = distance - SplitInfo.startMeters;
  if(distance == 0){
    document.getElementById("split").style.display = "none"
    return;
  }
  let index = Math.floor(traveled / splitDistance) - 1;
  if(index < 0){
    if(index < -1){
      document.getElementById("split").style.display = "none"
    }
    
    SplitInfo.splits = [];
    return;
  }
  else if(index+1 < SplitInfo.splits.length){
    SplitInfo.splits.splice(index)
    SplitInfo.splits[index] = time;
    SplitInfo.splits[0] = null; // invalidate the lap due to rewind
    return;
  }
  else if(index < SplitInfo.splits.length){
    return;
  } 
  else if(index == SplitInfo.splits.length){
    SplitInfo.splits[index] = time;
  }
  else {
    console.error("Error: Split index out of range")
    return;
  }

  bestIndex = -1;
  if(SplitInfo.bestSplits.length == 0){
    return;
  }
  else if(SplitInfo.bestSplits.length > index){
    bestIndex = index;
  }
  else {
    bestIndex = SplitInfo.bestSplits.length - 1;
  }

  if(SplitInfo.bestSplits[bestIndex] == null){
    return;
  }

  timeSplit = SplitInfo.splits[index] - SplitInfo.bestSplits[bestIndex];
  let ShowMinutes = (timeSplit > 60 || timeSplit < -60) ? true :  false;

  if(timeSplit < 0){
    document.getElementById("split").style.color = "#00c721"
    document.getElementById("split").textContent = "-" + formatTime(-1*timeSplit, ShowMinutes)
  }
  else {
    document.getElementById("split").style.color = "#c90000"
    document.getElementById("split").textContent = "+" + formatTime(timeSplit, ShowMinutes)
  }
  document.getElementById("container-split").style.left = ShowMinutes ? "80%" : "81%"
  document.getElementById("split").style.display = "contents"

}

function configureLapTime(car, track, current, last, best){
  if(SplitInfo.splits.length > 1 && SplitInfo.splits[0] != null){
      if(last == best) {
        SplitInfo.splits.push(last)
        SplitInfo.sessionSplits = SplitInfo.splits;

        if(SplitInfo.bestSplits.length == 0 || best < SplitInfo.bestSplits[SplitInfo.bestSplits.length-1]){
          SplitInfo.bestSplits = SplitInfo.splits;
          setSplit(car, track);
        }
        if(SplitInfo.sessionSplits.length == 0 || best < SplitInfo.sessionSplits[SplitInfo.sessionSplits.length-1]){
          SplitInfo.sessionSplits = SplitInfo.splits;
        }
      }
    }
    SplitInfo.splits = [];
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

function newTrack(trackID){
  if(SplitInfo.coords.length == 0){
    return;
  }

  fetch("/Split", {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({type: "new", trackID: trackID, splits: SplitInfo.coords})
  })
  .then(response => {
      if (response.ok) {
          return response.json();
      }
  })
  .then(data => {
  })
  .catch(error => {
      console.error('Error sending data to server:', error);
  });
}

function setSplit(carID, trackID){
  if(SplitInfo.splits.length < 3){
    return;
  }

  fetch("/Split", {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({type: "set", carID: carID, trackID: trackID, splits: SplitInfo.bestSplits})
  })
  .then(response => {
      if (response.ok) {
          return response.json();
      }
  })
  .then(data => {
  })
  .catch(error => {
      console.error('Error sending data to server:', error);
  });
}

function getSplit(carID, trackID){
  SplitInfo.splitTry++;
  if(SplitInfo.bestSplits.length != 0 || SplitInfo.splitTry < 25){
    return;
  }
  else {
    SplitInfo.splitTry = 0;
  }

  fetch("/Split", {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({type: "get", carID: carID, trackID: trackID})
  })
  .then(response => {
      if (response.ok) {
          return response.json();
      }
  })
  .then(data => {
    if(data != null){
      if(data.splits == null){
        SplitInfo.bestSplits = [];
      }
      else{
        SplitInfo.bestSplits = data.splits;
      }
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