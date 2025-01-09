rpmDotMax = -1;
currentGear = -99;
setMaxRPM = -1;
shiftSteps = -1;

const shiftLightConfigs = {
    "off": "",
    "outsideIn": `
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
`,
    "leftRight": `
<div class="centered content">
    <div class=" container shift-lights" id="shift-lights">
        <div class="light green light1"></div>
        <div class="light green light2"></div>
        <div class="light green light3"></div>
        <div class="light green light4"></div>
        <div class="light green light5"></div>
        <div class="light yellow light6"></div>
        <div class="light yellow light7"></div>
        <div class="light yellow light8"></div>
        <div class="light yellow light9"></div>
        <div class="light red light10"></div>
        <div class="light red light11"></div>
        <div class="light blue light12"></div>
</div>
`
}

const shiftLightCSS = `
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

loadShiftLights();

function configureShiftLight(rpm, maxRPM, gear = -99) {
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
        currentGear = -99;
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
    const end = 1-.0375;
    const steps = shiftSteps+1;
    const inc = (end-start)/steps;

    if(rpmDotMax == -1 || steps == 0){
        blinkLED(false);
        return;
    }

    for (let i = 1; i < steps; i++) {
        if (rpm > rpmDotMax * (start + (i - 1) * inc)) {
            enableLED(i);
        }
        else {
            enableLED(i, false);
        }
    }

    if (rpm > rpmDotMax * (start + steps * inc)) {
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
    if(shiftLightConfigs.hasOwnProperty(shiftLightType)){
        shiftSteps = getShiftLightSteps(shiftLightConfigs[shiftLightType]);
        document.getElementById('shift-light-container').innerHTML = shiftLightConfigs[shiftLightType] + shiftLightCSS;
    }
    else {
        console.error("Error: shiftLightType is invalid: ", shiftLightType);
    }

    updateShiftLight(0);
}

function getShiftLightSteps(htmlString) {
    let maxLightNumber = -1;

    if (htmlString) {
        // Extract all "lightX" matches from the HTML string
        const matches = htmlString.match(/light(\d+)/g);
        if (matches) {
            matches.forEach(match => {
                const number = parseInt(match.replace('light', ''), 10);
                maxLightNumber = Math.max(maxLightNumber, number);
            });
        }
    }

    return maxLightNumber;
}

