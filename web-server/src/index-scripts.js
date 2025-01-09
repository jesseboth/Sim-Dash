let config = {
    "game": undefined,
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
const configModal = document.getElementById("configModal");

// Close modals
document.querySelectorAll(".close").forEach((closeBtn) => {
  closeBtn.addEventListener("click", () => {
    document.querySelectorAll(".modal").forEach((element) => {
        element.style.display = "none";
    });
  });
});


// Loop through and create buttons
document.querySelectorAll('.configBtn').forEach(element => {
  newButton(element.id);
});

document.getElementById("config").addEventListener("click", async () => {
    await refreshConfigButtons();
    document.getElementById("configModal").style.display = "block";
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
