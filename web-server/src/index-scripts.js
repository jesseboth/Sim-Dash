let config = {
    "game": undefined,
}

document.body.onload = async function() {
    await loadGamesFromJSON();
    await refreshBtn("game", config.game);
    if(config.game == undefined) {
        config.game = "";
    }
}

async function loadGamesFromJSON() {
    try {
        const response = await fetch('/games');
        const gamesData = await response.json();

        // Find the container where game buttons should be inserted
        const stopButton = document.getElementById('game-stop');
        const container = stopButton.parentElement;

        // Clear existing game buttons (except stop button)
        const existingButtons = container.querySelectorAll('li, ul');
        existingButtons.forEach(elem => elem.remove());

        // Generate game category buttons dynamically
        gamesData.categories.forEach(category => {
            // Generate ID from category name (remove spaces)
            const categoryId = category.name.replace(/\s+/g, '');

            // Create category button
            const categoryLi = document.createElement('li');
            const categoryBtn = document.createElement('button');
            categoryBtn.className = 'large-button';
            categoryBtn.textContent = category.name;
            categoryBtn.onclick = () => toggleVisibility(categoryId);
            categoryLi.appendChild(categoryBtn);
            container.insertBefore(categoryLi, stopButton);

            // Create games list for this category
            const gamesUl = document.createElement('ul');
            gamesUl.id = categoryId;
            gamesUl.className = 'telescope';
            gamesUl.style.display = 'none';

            category.games.forEach(game => {
                const gameLi = document.createElement('li');
                const gameBtn = document.createElement('button');
                gameBtn.id = `game-${game.id.toLowerCase()}`;
                gameBtn.className = 'large-button gameBtn';
                gameBtn.textContent = game.name;
                gameBtn.setAttribute('data-game-code', game.id);
                gameLi.appendChild(gameBtn);
                gamesUl.appendChild(gameLi);
            });

            container.insertBefore(gamesUl, stopButton);
        });

        // Re-attach event listeners for dynamically created game buttons
        document.querySelectorAll('.gameBtn').forEach(element => {
            gameBtn(element.id.split("-")[1]);
        });

    } catch (error) {
        console.error('Error loading games:', error);
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
    const btnElement = document.getElementById(`game-${name}`);
    btnElement.addEventListener('click', async function () {
        try {
            // Get the game code from data attribute, fallback to uppercase name
            const gameCode = btnElement.getAttribute('data-game-code') || name.toUpperCase();
            const data = await postToServer("game", gameCode);

            if(name == "stop") {
                refreshBtn("game", "");
                return;
            }

            if(config.game != "" || !data.success) {
                if(data.error != undefined) {
                    console.error(data.error);
                }
                config.game = gameCode;
                modal.style.display = "block";
            } else {
                refreshBtn("game", gameCode);
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

// Game buttons are now dynamically loaded from games.json in loadGamesFromJSON()

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

document.getElementById("portConfig").addEventListener("click", async () => {
    await loadPortConfig();
    document.getElementById("portModal").style.display = "block";
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
      document.getElementById(type+ "-" + config[type].toLowerCase()).style.border = "4px solid #67e088";
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

async function loadPortConfig() {
  try {
    const data = await postToServer("simHub", "get");
    if (data.success) {
      const portConfig = data.return;
      document.getElementById("portToggle").checked = portConfig.useCustom || false;
      document.getElementById("portInput").value = portConfig.customPort || "20778";
      document.getElementById("portInput").disabled = !portConfig.useCustom;

      document.getElementById("simHubInput").value = portConfig.simHubURL || "";
    }
  } catch (error) {
    console.error("Error loading port config:", error);
  }
}

document.getElementById("portToggle").addEventListener("change", function() {
  document.getElementById("portInput").disabled = !this.checked;
});

document.getElementById("portSaveBtn").addEventListener("click", async function() {
  const useCustom = document.getElementById("portToggle").checked;
  const customPort = parseInt(document.getElementById("portInput").value) || 20778;
  const simHubURL = document.getElementById("simHubInput").value || "";

  try {
    const data = await postToServer("simHub", { useCustom, customPort, simHubURL });
    if (data.success) {
      document.getElementById("portModal").style.display = "none";

      postToServer("refresh", { refresh: true });

      // wait half a second and reset
      setTimeout(() => {
        postToServer("refresh", { refresh: false });
      }, 2000);
      
      console.log("Port configuration saved successfully");
    } else {
      console.error("Failed to save port config:", data.error);
    }
  } catch (error) {
    console.error("Error saving port config:", error);
  }
});
