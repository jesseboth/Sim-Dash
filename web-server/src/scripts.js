const repeat = setInterval(set_display, 25);
const another = setInterval(get_telemetryType, 1000 * 10);
const ipAddress = window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/) != null
  ? window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/)[1] : "localhost";
  telemetry = null;
  telemetryType = null;
  yellowRPMPecentage = 0;
  
  OdometerInfo = {
    carNumber: 0,
    meters: 0
  };

  // Define temperature range (adjust as needed)
  const coldTemperature = 180;
  const normalTemperature = 220;
  const hotTemperature = 280
  set_default()
  
setTimeout(function() {
    load();
    get_telemetryType()
}, 250);
  
  // TESTING:
// setInterval(testing, 25);
test_curtime = 0;
test_loops = 0;
test_gear = 0;
test_speed = 0;
test_fuel = 100;
test_distance = 0;
test_maxRPM = 7200;
test_rpm = 1200;
test_rpminc = true;
test_wear = 100;
test_temp = coldTemperature-50;
test_tempinc = true;
test_position = 1;
test_positoninc = true;
configureRPM(test_maxRPM)
function testing() {
  test_curtime += .025;
  test_loops++;
  updateTime("time", test_curtime)
  updateTime("best-time", 145.345)
  if (test_loops % 40 == 0) {
    if (test_gear === 12) {
      test_gear = 0;
    }

    updateGear(test_gear++)
    updatePosition(test_position)
    test_position = test_positoninc ? test_position+1 : test_position-1;
    if(test_position == 24){
      test_positoninc = false;
    }
    else if(test_position == 0){
      test_positoninc = true;
    }
  }

  if (test_loops % 10 == 0) {
    if (test_speed == 250) {
      test_speed = 0
    }
    if (test_fuel == 0) {
      test_fuel = 100;
      test_wear = 100;
    }
    updateSpeed(test_speed++)
    updateTireWear("FR", test_wear)
    updateTireWear("FL", test_wear)
    updateTireWear("RR", test_wear)
    updateTireWear("RL", test_wear--)
    updateFuel(test_fuel--)
    
  }
  if (test_loops % 5 == 0) {
    updateDistance(test_distance++)
    updateRPM(test_rpm, test_maxRPM)
    if (test_rpminc) {
      test_rpm += 50;
    }
    else {
      test_rpm -= 50;
    }
    if (test_rpm >= test_maxRPM) {
      test_rpminc = false;
    }
    else if (test_rpm <= 800) {
      test_rpminc = true;
    }

    updateTireTemp("FR", test_temp)
    updateTireTemp("FL", test_temp)
    updateTireTemp("RR", test_temp)
    updateTireTemp("RL", test_temp)
    if(test_temp > hotTemperature){
      test_tempinc = false;
    }
    else if(test_temp < coldTemperature-20){
      test_tempinc = true;
    }
    if(test_tempinc){
      test_temp++;
    }
    else{
      test_temp--;
    }

  }
}
// TESTING:

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
  updateDistance(0)
  updateFuel(100)
  updateGear(11)
  configureRPM(7200)
  updateRPM(1200, 7200)
  updateSpeed(0)
  updateTime("time", null)
  updateTime("best-time", null)
  updateTireTemp("FR", normalTemperature)
  updateTireTemp("FL", normalTemperature)
  updateTireTemp("RR", normalTemperature)
  updateTireTemp("RL", normalTemperature)
  updateTireWear("FR", 100)
  updateTireWear("FL", 100)
  updateTireWear("FR", 100)
  updateTireWear("RL", 100)
  updatePosition(0)
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
async function set_display() {
  get_data(); // Wait for the data to be fetched and parsed

  data = telemetry
  if (data == null || data[0]["IsRaceOn"] != 1) {
    set_default();
    return;
  }

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


  updateDistance(metersToMiles(data[2]["DistanceTraveled"]))
  updateFuel(data[2]["Fuel"]*100)
  configureRPM(data[2]["EngineMaxRpm"])
  updateRPM(data[2]["CurrentEngineRpm"], data[2]["EngineMaxRpm"])
  updateSpeed(mpstomph(data[2]["Speed"]))
  updateTime("time", data[2]["CurrentLap"])
  updateTime("best-time", data[2]["BestLap"])
  updateTireTemp("FR", data[2]["TireTempFrontRight"])
  updateTireTemp("FL", data[2]["TireTempFrontLeft"])
  updateTireTemp("RR", data[2]["TireTempRearRight"])
  updateTireTemp("RL", data[2]["TireTempRearLeft"])
  updatePosition(data[4]["RacePosition"])
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
    document.getElementById(id).style.display = "contents";
    document.getElementById(id).textContent = formattedTime;
  }
  else {
    document.getElementById(id).style.display = "none";
  }
}

function updateSpeed(speed) {
  document.getElementById("speed").textContent = parseInt(speed)
}

function updateDistance(_distance) {
  distance = Math.max(0, parseInt(_distance))
  document.getElementById("distance").textContent = String(distance) + " mi"
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

    // tireDiv.style.backgroundColor = "rgb(255," + String(128*(1-percentage)) + ",0)";
    
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
function formatTime(floatSeconds) {
  // Convert float seconds to integer milliseconds
  var totalMilliseconds = Math.floor(floatSeconds * 1000);

  // Calculate minutes, seconds, and milliseconds
  var minutes = Math.floor(totalMilliseconds / (60 * 1000));
  var seconds = Math.floor((totalMilliseconds % (60 * 1000)) / 1000);
  var milliseconds = Math.floor((totalMilliseconds % 1000) / 10); // Truncate milliseconds to two digits

  // Format the time
  var formattedTime = padWithZero(minutes) + ":" + padWithZero(seconds) + ":" + padWithZero(milliseconds);

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
  return meters * 0.000621371;
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

function storeOdometer(OdometerInfo){
  if(OdometerInfo == null || OdometerInfo["carNumber"] == 0){
    return;
  }
  fetch("/Odometer", {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify(OdometerInfo)
  })
  .then(response => {
      if (!response.ok) {
          throw new Error('Network response was not ok');
      }
      return response.json();
  })
  .then(data => {
      console.log('Server response:', data);
  })
  .catch(error => {
      console.error('Error sending data to server:', error);
  });
}

function getOdometer(carNumber){
  fetch('/Odometer-' + carNumber, {
      method: 'GET',
      headers: {
          'Content-Type': 'application/json',
      },
      // Optionally send data in the body if your command needs it
  })
  .then(response => response.json())
  .then(data => {
    setTimeout(function() {
      OdometerInfo["carNumber"] = data.carNumber
      OdometerInfo["meters"] = data.meters;
    }, 250);
  })
  .catch(error => console.error('Error:', error));
}
