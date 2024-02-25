const repeat = setInterval(display_data, 25);
const another = setInterval(get_telemetryType, 1000 * 10);
const ipAddress = window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/) != null
  ? window.location.href.match(/(?:https?|ftp):\/\/([^:/]+).*/)[1] : "localhost";
  telemetry = null;
  telemetryType = null;
  yellowRPMPecentage = 0;
  
  // Define temperature range (adjust as needed)
  const coldTemperature = 100;
  const normalTemperature = 150;
  const hotTemperature = 250
  
setTimeout(function() {
    load();
    get_telemetryType()
  }, 250);
  
  // TESTING:
setInterval(testing, 25);
test_curtime = 0;
test_loops = 0;
test_gear = 0;
test_speed = 0;
test_fuel = 100;
test_distance = 0;
test_maxRPM = 7200;
test_rpm = 800;
test_rpminc = true;
test_wear = 100;
test_temp = coldTemperature-20;
test_tempinc = true;
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
  fetch('http://' + ipAddress + ':8888/forza')
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

function get_telemetryType() {
  fetch('/telemetry')
    .then(response => response.json())
    .then(data => {
      telemetryType = data["type"]
    })
    .catch(error => null);
}

async function display_data() {
  get_data(); // Wait for the data to be fetched and parsed

  data = telemetry
  if (data == null) {
    return;
  }

  console.log(data[2]["CurrentEngineRpm"], data[4]["Gear"])
}

function updateFuel(percentage) {
  var redWidth = Math.min(percentage, 15); // Limit to 15%
  document.getElementById("status-bar-fill").style.width = redWidth + "%";

  if (percentage >= 15) {
    var fillWhite = document.getElementById("status-bar-fill-white");
    fillWhite.style.left = redWidth + "%";
    fillWhite.style.width = (percentage - redWidth) + "%";
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
  if (time != null) {
    document.getElementById(id).style.display = "contents";
    document.getElementById(id).textContent = formattedTime;
  }
  else {
    document.getElementById(id).style.display = "none";
  }
}

function updateSpeed(speed) {
  document.getElementById("speed").textContent = speed
}

function updateDistance(distance) {
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
  var redWidth = Math.min(percentage, 15); // Limit to 15%
  document.getElementById(tire+"tire-bar-fill-red").style.height = redWidth + "%";

  if (percentage >= 15) {
    var fillWhite = document.getElementById(tire+"tire-bar-fill-white");
    fillWhite.style.bottom = redWidth + "%";
    fillWhite.style.height = (percentage - redWidth) + "%";
  }
}

function updateTireTemp(tire, temp){
  const temperature = parseInt(temp);
  const tireDiv = document.getElementById(tire);

  if (temperature <= coldTemperature) {
    tireDiv.style.backgroundColor = '#4d89b8';

  } else if (temperature > normalTemperature) {
    const percentage = (temperature - normalTemperature) / (hotTemperature - normalTemperature);
    tireDiv.style.backgroundColor = "rgb(255," + String(128*(1-percentage)) + ",0)";

  } else {
    tireDiv.style.backgroundColor = "#a7a7a7"
  }
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
