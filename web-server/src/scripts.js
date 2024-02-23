const repeat = setInterval(display_data, 100);
const another = setInterval(get_telemetryType, 1000*10);
get_telemetryType()
telemetry = null;
telemetryType = null;

function get_data() {
  if(telemetryType == null){
    telemetry = null;
    return;
  }
  fetch('http://192.168.4.199:8888/forza')
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

function get_telemetryType(){
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

  if(percentage > 15){
    var fillWhite = document.getElementById("status-bar-fill-white");
    fillWhite.style.left = redWidth + "%";
    fillWhite.style.width = (percentage - redWidth) + "%";
  }
}
