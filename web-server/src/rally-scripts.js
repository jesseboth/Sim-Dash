config = {};
config["seperateTime"] = true;

// const colorStops = [
//     { percentage: 0, color: [0, 0, 255] },  // Blue
//     { percentage: 25, color: [0, 255, 0] }, // Green
//     { percentage: 50, color: [0, 255, 0] }, // Green (End of Green Range)
//     { percentage: 70, color: [255, 255, 0] }, // Yellow
//     { percentage: 85, color: [255, 165, 0] }, // Orange
//     { percentage: 90, color: [0, 0, 255] },  // Blue
//     { percentage: 95, color: [255, 0, 0] },   // Red
//     { percentage: 100, color: [255, 0, 0] }   // Red
// ];

const colorStops = [
    { percentage: 0, color: [0x20, 0x7d, 0xde] },  // Blue
    { percentage: 50, color: [0x20, 0x7d, 0xde] },  // Blue
    { percentage: 70, color: [0, 255, 0] }, // Green 
    { percentage: 80, color: [255, 255, 0] }, // Yellow
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

    document.getElementById('rpm-num').style.color = color;
}


rpmDotMax = -1;
currentGear = -99;
function configureShiftDot(gear, rpm, maxRPM){
    if (gear != -99) {
        if(rpm < maxRPM * 0.95 && rpm > rpmDotMax && gear >= currentGear){
            rpmDotMax = rpm;
        }

        // row through gears one time exclude down shifts
        if(gear >= currentGear){
            currentGear = gear;
        }
    }
    else {
        gear = currentGear;
    }
}

function updateShiftDot(rpm){
    if(rpmDotMax != -1 && rpm > rpmDotMax * 0.9625){
        document.getElementById('rpm-dot').style.backgroundColor = 'red';
    }
    else {
        document.getElementById('rpm-dot').style.backgroundColor = '#303030';
    }
}

function updateRPM(rpm, maxRPM, gear=-99) {
    updateColor(rpm / maxRPM * 100);
    document.getElementById('rpm-num').innerText = Math.round(rpm);

    configureShiftDot(gear, rpm, maxRPM);
    configureShiftLight(gear, rpm, maxRPM);

    updateShiftDot(rpm);
    updateShiftLight(rpm);
}


setMaxRPM = -1;
function configureRPM(maxRPM){
    if(maxRPM != setMaxRPM) {
        setMaxRPM = maxRPM;
        rpmDotMax = maxRPM*0.8; // set initial value
    }
}

function updateTraction(traction){
    // do nothing
}

function configureShiftLight(){
    // do nothing
}

function updateShiftLight(rpm){
    // do nothing
}
