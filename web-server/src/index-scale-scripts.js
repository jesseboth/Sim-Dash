config["scale"] = undefined;

const scaleModal = document.getElementById("scaleModal");
const scaleModalAdjust = document.getElementById("scaleModalAdjust");

// Scale and Move Functions
document.getElementById("scaleUpBtn").addEventListener("click", () =>   postToServer("scale", {"scale": 1}));
document.getElementById("scaleDownBtn").addEventListener("click", () => postToServer("scale", {"scale": -1}));
document.getElementById("moveUpBtn").addEventListener("click", () =>    postToServer("scale", {"move": -1}));
document.getElementById("moveDownBtn").addEventListener("click", () =>  postToServer("scale", {"move": 1}));

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