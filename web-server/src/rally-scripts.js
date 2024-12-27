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


let rpmDotMax = -1;
let rpmDotCurrent = -1;
let activeGear = -1;
function configureShiftLight(gear, rpm){
    if (gear != -99) {
        // First time setting the active gear
        if (activeGear === -1) {
            activeGear = gear;
            lastGear = gear;
            lastRPM = rpm;
        }

        // Check for valid gear transitions
        if (gear === activeGear) {
            // Within the same gear, update RPM peak and redline
            if (rpm > rpmDotCurrent) {
                rpmDotCurrent = rpm;

                // Only update redline if the RPM increase is realistic
                if (rpm > rpmDotMax && rpm <= rpmDotMax * 1.2) { // Allow up to 20% margin
                    rpmDotMax = rpm;
                    console.log(`New redline detected: ${rpmDotMax}`);
                }
            }
        } else if (gear === activeGear + 1) {
            // Valid upshift: Check if the RPM spike is realistic
            if (rpm <= rpmDotCurrent * 1.2) { // Allow small RPM increase on upshift
                activeGear = gear;
                rpmDotCurrent = rpm;
            } else {
                console.log(`Ignoring unrealistic RPM spike on upshift: ${rpm}`);
            }
        } else if (gear < activeGear) {
            // Downshift detected: Ignore bad downshift spikes
            if (rpm > rpmDotMax * 1.2) {
                console.log(`Ignoring RPM spike due to bad downshift: ${rpm}`);
            } else {
                activeGear = gear;
                rpmDotCurrent = rpm;
            }
        }

        // Update lastGear and lastRPM
        lastGear = activeGear;
        lastRPM = rpm;
    }
}

function updateShiftLight(rpm){
    if(rpm > rpmDotMax * 0.95){
        document.getElementById('rpm-dot').style.backgroundColor = 'red';
    }
    else {
        document.getElementById('rpm-dot').style.backgroundColor = '#303030';
    }
}

function updateRPM(rpm, maxRPM, gear=-99) {
    updateColor(rpm / maxRPM * 100);
    document.getElementById('rpm-num').innerText = Math.round(rpm);

    configureShiftLight(gear, rpm);
    updateShiftLight(rpm)
}


setMaxRPM = -1;
function configureRPM(maxRPM){
    if(maxRPM != setMaxRPM) {
        rpmDotMax = maxRPM*0.8;
    }
}

function updateTraction(traction){
    // do nothing
}
