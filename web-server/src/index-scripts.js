let config = {
    "game": undefined,
    "split": undefined,
    "scale": undefined,
    "dash": undefined
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

gameBtn("fm");
gameBtn("fh5");
gameBtn("fm7");
gameBtn("fh4");
gameBtn("stop");
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

document.getElementById("split-car").addEventListener("click", () =>     postToServer("split", "car") && refreshBtn("split", "car"));
document.getElementById("split-class").addEventListener("click", () =>   postToServer("split", "class") && refreshBtn("split", "class"));
document.getElementById("split-session").addEventListener("click", () => postToServer("split", "session") && refreshBtn("split", "session"));

document.getElementById("dash-golfr").addEventListener("click", () => postToServer("dash", "golfr") && refreshBtn("dash", "golfr"));
document.getElementById("dash-rally").addEventListener("click", () => postToServer("dash", "rally") && refreshBtn("dash", "rally"));

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
    await refreshBtn("split", config.split);
    await refreshBtn("dash", config.dash);
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