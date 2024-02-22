const repeat = setInterval(display_data, 100);
telemetry = null;

function get_data() {
  try{
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
      // console.error('Fetch error:', error);
      telemetry = null;
    });
  }
  catch{
    console.log("here")
  }
}

async function display_data() {
  get_data(); // Wait for the data to be fetched and parsed

  data = telemetry
  if (!data) {
    return;
  }

  console.log(data[2]["CurrentEngineRpm"], data[4]["Gear"])
}