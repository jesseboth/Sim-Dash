allowRefresh = false;

async function getConfig() {
    const types = ["scale", "dash", "shift", "refresh"];
    const retdata = await fetchConfig(types);

    getDashStyle(retdata.dash);
    getDashPosition(retdata.scale);

    // check if function exists before calling
    if (typeof setShiftLight === "function"){
        setShiftLight(retdata.shift.return);
    }

    if(!allowRefresh){
        return new Promise((resolve) => {
            setTimeout(() => {
                allowRefresh = true;
            }, 3000);
    } );
    } 
    else {
        getRefresh(retdata.refresh)
    }
}

async function getDashPosition(scale) {
    if (scale != null) {
        data = scale.return
        document.getElementById("all").style.top = data.top;
        document.getElementById("all").style.left = data.left;
        document.getElementById("all").style.width = data.width;
        document.getElementById("all").style.zoom = data.zoom;
    }
}

dash = null;
async function getDashStyle(data) {
    if (data != null) {
        if(dash == null){
            dash = data.return;
        }
        else if(dash != data.return){
            dash = data.return;
            location.reload();
        }
    }
}

async function getRefresh(data) {
    if (data != null) {
        if (data.return.refresh) {
            location.reload();
        }
    }
}

async function fetchConfig(types) {
    try {
        dict = {}
        for (type of types) {
            dict[type] = "get";
        }

        const response = await fetch("/config", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dict)
        });

        if (!response.ok) {
            console.error("Error: Network response was not ok");
            return null;
        }

        const data = await response.json();
        if (data != null) {
            if (!data.success) {
                console.error("Error: " + data.error);
                return null;
            }

            for (type of types) {
                if (data[type] === undefined) {
                    console.error("Error: " + type + " is undefined");
                }
                else if (!data[type].success) {
                    console.error("Error: " + data[type].error);
                }
            }

            return data;
        }

        return null;
    } catch (error) {
        console.error('Error sending data to server:', error);
        return null;
    }
}