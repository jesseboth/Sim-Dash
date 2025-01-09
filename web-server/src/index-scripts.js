let config = {
    "game": undefined,
    "scale": undefined,
}

document.body.onload = async function() {
    await refreshBtn("game", config.game);
    if(config.game == undefined) {
        config.game = "";
    }
}

async function postToServer(action, value) {
  const body = {};
  body[action] = value;

  try {
    const response = await fetch(`/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if(data.success == false) {
        console.error("Error: " + data.error);
    }
    return data[action]; // Returns the parsed JSON response
  } catch (error) {
    console.error('Error:', error);
    throw error; // Rethrow the error for the caller to handle
  }
}

async function createButtonListener(action, name) {
    document.getElementById(`${action}-${name}`).addEventListener('click', async function () {
    try {
        const data = await postToServer(action, name);
        if(!data.success) {
            if(data.error != undefined) {
                console.error(data.error);
            }
        }
        return data;
    } catch (error) {
        console.error("Error while posting to server:", error);
    }
    });
}

async function gameBtn(name) {
    document.getElementById(`game-${name}`).addEventListener('click', async function () {
        try {
            const data = await postToServer("game", name);

            if(name == "stop") {
                refreshBtn("game", "");
                return;
            }

            if(config.game != "" || !data.success) {
                if(data.error != undefined) {
                    console.error(data.error);
                }
                config.game = name;
                modal.style.display = "block";
            } else {
                refreshBtn("game", name);
            }
        } catch (error) {
            console.error("Error while posting to server:", error);
        }
    });
}

function createRedirect(name) {
  document.getElementById(name).addEventListener("click", function () {
    window.location.href = window.location.href + name;
  });
}

document.querySelectorAll('.gameBtn').forEach(element => {
  gameBtn(element.id.split("-")[1]);
});

createRedirect("dash");

const modal = document.getElementById("fdtModal");
const scaleModal = document.getElementById("scaleModal");
const scaleModalAdjust = document.getElementById("scaleModalAdjust");
const configModal = document.getElementById("configModal");

// Close modals
document.querySelectorAll(".close").forEach((closeBtn) => {
  closeBtn.addEventListener("click", () => {
    document.querySelectorAll(".modal").forEach((element) => {
        element.style.display = "none";
    });
  });
});

// Scale and Move Functions
document.getElementById("scaleUpBtn").addEventListener("click", () =>   postToServer("scale", {"scale": 1}));
document.getElementById("scaleDownBtn").addEventListener("click", () => postToServer("scale", {"scale": -1}));
document.getElementById("moveUpBtn").addEventListener("click", () =>    postToServer("scale", {"move": -1}));
document.getElementById("moveDownBtn").addEventListener("click", () =>  postToServer("scale", {"move": 1}));

// Loop through and create buttons
document.querySelectorAll('.configBtn').forEach(element => {
  newButton(element.id);
});

document.getElementById("saveBtn").addEventListener("click", () => {
    newName = document.getElementById("scaleNameInput").value;
  
    // Check if the input is empty
    if (!newName.trim()) {
        console.error("No name entered.");
        return;
    }
    newName = newName.toLowerCase();
    newName.split(" ").join("-");
    postToServer("scale", {"save": newName});
    scaleModalAdjust.style.display = "none";
});

document.getElementById("config").addEventListener("click", async () => {
    await refreshConfigButtons();
    document.getElementById("configModal").style.display = "block";
});

document.getElementById("scale").addEventListener("click", async () => {
  try {
    const data = await postToServer("scale", {"get": "keys"});
    elems = data.return
    
    if(config.scale == "" || config.scale == undefined) {
      config.scale = (await postToServer("scale", {"get": "current"})).return;
    }

    document.getElementById("selectModal").innerHTML = `
    <span class="close" id="scaleClose" onclick="document.getElementById('scaleModal').style.display = 'none'">&times;</span>
  `;

    document.getElementById("selectModal").innerHTML += `<div class="text">Select Dash Postion: </div>`;
    for (let i = 0; i < elems.length; i++) {
      document.getElementById("selectModal").innerHTML += `<button id='scale-${elems[i]}'class="modalButton scaleBtn" onclick="postToServer('scale', {'set': '${elems[i]}'}); refreshBtn('scale', '${elems[i]}')">${elems[i]}</button>`;
    }
    document.getElementById("selectModal").innerHTML += `<button id='scale-custom' class="modalButton scaleBtn" onclick="postToServer('scale', {'set': 'custom'}); refreshBtn('scale', 'custom'); scaleModal.style.display = 'none'; scaleModalAdjust.style.display = 'block';">custom</button>`;

    refreshBtn("scale", config.scale);

    scaleModal.style.display = "block";
  } catch (error) {
    console.error("Error:", error);
  }
});

// Add event listeners to Yes and No buttons
yesBtn.addEventListener("click", function () {
  if (config.game == "") {
    modal.style.display = "none";
    return;
  }
  postToServer("game", "stop");
  refreshBtn("game", config.game)
  setTimeout(function () {
    postToServer("game", config.game)
  }, 1000);
  modal.style.display = "none";
});

noBtn.addEventListener("click", function () {
  modal.style.display = "none";
});

async function refreshBtn(type, value=undefined) {
    if(value == undefined) {
        data = await postToServer(type, "get");
        if(data == undefined || data.success == false) {
            console.error("Error getting " + type);
        return;
        }
        config[type] = data.return;
    } else {
        config[type] = value
    }
        
    
    document.querySelectorAll('.'+type+'Btn').forEach((element) => {
        element.style.border = "none";
    });

    if(config[type] != undefined && config[type] != "") {
        document.getElementById(type+ "-" + config[type]).style.border = "4px solid #67e088";
        document.getElementById(type+ "-" + config[type]).style.border = "3px solid #0e0e0e";
    }
}

function toggleVisibility(id) {
  show = false;
  const element = document.getElementById(id);
  if (element.style.display === "none") {
      show = true;
  }

  Array.from(document.getElementsByClassName("telescope")).forEach((element) => {
    element.style.display = "none";
  });

    if(show) {
        element.style.display = "block";
    }
}

function newButton(name) {
  const split = name.split("-");
  document.getElementById(name).addEventListener("click", () => postToServer(split[0], split[1]) && refreshBtn(split[0], split[1]));
  document.getElementById(name).classList.add(split[0]+"Btn");
  if(!config.hasOwnProperty(split[0])){
    config[split[0]] = undefined;
  }
}

async function refreshConfigButtons() {
  let buttons = [];
  const elements = document.querySelectorAll('.configBtn');
  
  for (const element of elements) {
    const key = element.id.split("-")[0];
    if (!buttons.includes(key)) {
      buttons.push(key);
      await refreshBtn(key, config[key]); // Await works correctly here
    }
  }
}
