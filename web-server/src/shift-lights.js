rpmDotMax = -1;
currentGear = -99;
setMaxRPM = -1;

loadShiftLights();

function configureShiftLight(gear, rpm, maxRPM) {
    if (gear != -99) {
        if (rpm < maxRPM * 0.95 && rpm > rpmDotMax && gear >= currentGear) {
            rpmDotMax = rpm;
        }

        // row through gears one time exclude down shifts
        if (gear >= currentGear) {
            currentGear = gear;
        }
    }
    else {
        gear = currentGear;
    }
}

function enableLED(num, enable = true, blink = false) {
    // Ensure the selector targets classes like `.light1`, `.light2`, etc.
    const lights = document.querySelectorAll(`.light${num}`);

    lights.forEach(light => {
        // Set visibility
        enable ? light.classList.remove('light-off') : light.classList.add('light-off');
    });
}

function blinkLED(enable) {
    const lights = document.querySelectorAll(`.light`);

    lights.forEach(light => {
        // Set visibility
        enable ? light.classList.remove('light-off') : light.classList.add('light-off');
    });
}

shiftlightflash = 0;
shiftlightflashMax = 6;
shiftlightflashEnable = false;
function updateShiftLight(rpm) {
    if (rpmDotMax == -1) {
        for (let i = 1; i <= 6; i++) {
            enableLED(i, false);
        }
    }

    const start = 0.7;
    const inc = .0375;
    for (let i = 1; i <= 6; i++) {
        if (rpm > rpmDotMax * (start + (i - 1) * inc)) {
            enableLED(i);
        }
        else {
            enableLED(i, false);
        }
    }

    if (rpm > rpmDotMax * (start + 7 * inc)) {
        if (shiftlightflash > shiftlightflashMax) {
            shiftlightflash = 0;
        }
        if (shiftlightflash < shiftlightflashMax / 2) {
            shiftlightflashEnable = false;
            // document.getElementById("shift-lights").style.display = "flex";
        }
        else {
            shiftlightflashEnable = true;
            // document.getElementById("shift-lights").style.display = "none";
        }
        blinkLED(shiftlightflashEnable);
        shiftlightflash++;
    }
}

function initShiftLightRPM(maxRPM) {
    if (maxRPM != setMaxRPM) {
        setMaxRPM = maxRPM;
        rpmDotMax = maxRPM * 0.8; // set initial value
    }
}

function resetShiftLightRPM() {
    rpmDotMax = -1;
    setMaxRPM = -1;
}

function loadShiftLights() {
    document.getElementById('shift-light-container').innerHTML = `
<div class="centered content">
    <div class=" container shift-lights" id="shift-lights">
        <div class="light green light1"></div>
        <div class="light green light2"></div>
        <div class="light green light3"></div>
        <div class="light yellow light4"></div>
        <div class="light red light5"></div>
        <div class="light blue light6"></div>
        <div class="light blue light6"></div>
        <div class="light red light5"></div>
        <div class="light yellow light4"></div>
        <div class="light green light3"></div>
        <div class="light green light2"></div>
        <div class="light green light1"></div>
    </div>
</div>
<style>
    .light {
        background-color: aqua;
        width: 2%;
        border-radius: 100%;
        height: 30%;
        border: #9d9d9d 2px solid;
    }

    .shift-lights {
        position: absolute;
        width: 80%;
        height: 10%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        top: -1%;
        left: 10%;
        z-index: 10;
        /* left: auto; */
        /* right: auto; */
    }

    .green {
        background-color: #00ff00;
    }
    .yellow {
        background-color: #ffff00;
    }
    .red {
        background-color: #ff0000;
    }
    .blue {
        background-color: #0000ff;
    }

    .light-off {
        background-color: #303030;
    }
</style>
    `;
}
