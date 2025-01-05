config = {};
config["seperateTime"] = true;

const colorStops = [
    { percentage: 0, color: [0xff, 0xff, 0xff] },
    { percentage: 70, color: [0xff, 0xff, 0xff] },
    { percentage: 80, color: [255, 145, 0] }, // Orange
    { percentage: 95, color: [255, 0, 0] },   // Red
    { percentage: 100, color: [255, 0, 0] }   // Red
];


// Function to interpolate colors
function interpolateColor(percentage) {
    let start, end;

    // Find the two color stops to interpolate between
    for (let i = 0; i < colorStops.length - 1; i++) {
        if (percentage >= colorStops[i].percentage && percentage <= colorStops[i + 1].percentage) {
            start = colorStops[i];
            end = colorStops[i + 1];
            break;
        }
    }

    if (!start || !end) return `rgb(${colorStops[0].color.join(',')})`;

    // Calculate interpolation ratio
    const ratio =
        (percentage - start.percentage) / (end.percentage - start.percentage);

    // Interpolate RGB values
    const r = Math.round(start.color[0] + ratio * (end.color[0] - start.color[0]));
    const g = Math.round(start.color[1] + ratio * (end.color[1] - start.color[1]));
    const b = Math.round(start.color[2] + ratio * (end.color[2] - start.color[2]));

    return `rgb(${r},${g},${b})`;
}

// Update the color and text of the div
function updateColor(percentage) {
    const colorBox = document.getElementById('color-box');
    const _percentage = Math.min(Math.max(percentage, 0), 100); // Clamp to 0-100
    const color = interpolateColor(_percentage);
    colorBox.style.backgroundColor = color;
    colorBox.style.width = `${_percentage}%`;

}


rpmDotMax = -1;
currentGear = -99;
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
function updateShiftLight(rpm){
    if(rpmDotMax == -1){
        for (let i = 1; i <= 6; i++) {
            enableLED(i, false);
        }
    }

    const start = 0.7;
    const inc = .0375;
    for (let i = 1; i <= 6; i++) {
        if(rpm > rpmDotMax * (start + (i - 1) * inc)){
            enableLED(i);
        }
        else {
            enableLED(i, false);
        }
    }

    if(rpm > rpmDotMax * (start + 7 * inc)){
        if(shiftlightflash > shiftlightflashMax){
            shiftlightflash = 0;
        }
        if(shiftlightflash < shiftlightflashMax/2){
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

function updateRPM(rpm, maxRPM, gear = -99) {
    updateColor(rpm / (Math.ceil(maxRPM / 1000) * 1000) * 100);

    configureShiftLight(gear, rpm, maxRPM);
    updateShiftLight(rpm);
}


setMaxRPM = -1;
function configureRPM(maxRPM) {
    if (maxRPM != setMaxRPM) {
        setMaxRPM = maxRPM;
        rpmDotMax = maxRPM * 0.8; // set initial value
    }

    maxRPM = Math.ceil(maxRPM / 1000) * 1000

    function calculateBottom(x) {
        // Coefficients of the polynomial
        const coefficients = [
            -16.0,       // Constant term
            2.5823,      // x^1
            -0.7343,     // x^2
            0.1295,      // x^3
            -0.01191,    // x^4
            0.0005933,   // x^5
            -0.00001519, // x^6
            0.0000001562 // x^7
        ];
    
        // Compute y using the polynomial
        let y = 0;
        for (let i = 0; i < coefficients.length; i++) {
            y += coefficients[i] * Math.pow(x, i);
        }
    
        return y;
    }

    const gridContainer = document.getElementById('grid');
    gridContainer.innerHTML = ''; // Clear existing grid lines and numbers

    const steps = Math.ceil(maxRPM / 1000); // Number of steps (excluding 0)
    const stepValue = maxRPM / steps;

    for (let i = 1; i <= steps; i++) {
        const value = stepValue * i;

        // Create a vertical line
        const line = document.createElement('div');
        if (i == steps) {
            line.className = 'end-line';
        }
        else {
            line.className = 'grid-line';
        }
        line.style.left = `${(i / steps) * 100}%`;

        // Create a number below the line
        const number = document.createElement('div');
        number.className = 'grid-number';
        number.textContent = Math.round(value / 1000);
        const numberLeft = (i / steps) * 100;
        number.style.left = `${numberLeft}%`;
        // starting pt = 0
        if (numberLeft < 25) {
            // console.log(i, i / steps * 100, calculateBottom(numberLeft))
            number.style.bottom = `${calculateBottom(numberLeft)}rem`;
        }   

        // Add elements to the container
        gridContainer.appendChild(line);
        gridContainer.appendChild(number);
    }
}