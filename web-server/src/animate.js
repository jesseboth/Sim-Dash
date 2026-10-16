gear = 0;

animateRPM();
animateGears();
animateSpeed();
animateTireTemp();
animateTireWear();
animateFuel();
animateTraction();
animateTime();
animageBestTime();
animateSplit();
animateDistance();
animatePosition();

// Sleep function using Promises
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// RPM sweeps up and down. Each sweep the maximum RPM goes up 1000, from 5000 to 16000, then starts again.
async function animateRPM() {
    const lowestMaxRPM = 5000;
    const highestMaxRPM = 16000;
    const minRPM = 800;
    const sweepTicks = 60; // ticks from minimum to maximum

    let maxRPM = lowestMaxRPM;
    let i = minRPM;
    let up = true;

    while (true) {
        updateRpm(i, maxRPM, gear);

        const step = (maxRPM - minRPM) / sweepTicks;
        i += up ? step : -step;
        if (up && i >= maxRPM) {
            i = maxRPM;
            up = false;
        } else if (!up && i <= minRPM) {
            i = minRPM;
            up = true;
            maxRPM = maxRPM >= highestMaxRPM ? lowestMaxRPM : maxRPM + 1000;
        }

        await sleep(25);
    }
}

async function animateGears() {
    let i = 0;
    let inc = 1;
    while (true) {
        updateGear(i);
        gear = i;
        i += inc;
        if (i > 11 || i < 0) {
            inc = -inc;
        }
        await sleep(1000); // Wait 100ms before updating the next color
    }
}

async function animateSpeed() {
    let i = 0;
    let inc = 1;
    while (true) {
        updateSpeed(i);
        i += inc;
        if (i > 200 || i <= 0) {
            inc = -inc;
        }
        await sleep(100); // Wait 100ms before updating the next color
    }
}

async function animateTireTemp() {
    let start = coldTemperature-50;
    let end = hotTemperature;

    let i = start;
    let inc = 1;

    while (true) {
        updateTireTemp("FR", i);
        updateTireTemp("FL", i);
        updateTireTemp("RR", i);
        updateTireTemp("RL", i);
        i += inc;
        if (i > end || i < start) {
            inc = -inc;
        }
        await sleep(50); // Wait 100ms before updating the next color
    }
}

async function animateTireWear() {
    let i = 100;
    let inc = -1;

    while(true){
        updateTireWear("FR", i);
        updateTireWear("FL", i);
        updateTireWear("RR", i);
        updateTireWear("RL", i);

        i += inc;
        if (i > 100 || i < 0) {
            inc = -inc;
        }
        await sleep(100)
    }
}

async function animateFuel() {
    let i = 100;
    let inc = -1;

    while(true){
        updateFuel(i);

        i += inc;
        if (i > 100 || i < 0) {
            inc = -inc;
        }
        await sleep(500)
    }
}

async function animateTraction(){
    while(true){
        updateTraction(3,0);
        await sleep(25)
    }
}

async function animateTime() {
    let i = 0;
    let inc = 1;
    dirtyLap = false;
    while (true) {
        updateTime("time", i);
        updateDirtyLap(dirtyLap);
        i += inc;
        if (i > 100 || i <= 0) {
            inc = -inc;
            dirtyLap = !dirtyLap;
        }
        await sleep(100); // Wait 100ms before updating the next color
    }
}

async function animageBestTime() { 
    start = 80;
    end = 50;

    let i = start;
    let inc = -1;
    while (true) {
        updateTime("best-time", i);
        i += inc;
        if (i > start || i <= end) {
            inc = -inc;
        }
        await sleep(1000); // Wait 100ms before updating the next color
    }
}

async function animateSplit() {
    const start = -70;
    const end = 30;

    let i = start;
    let inc = .01;
    while (true) {
        updateSplit(i);
        i += inc;
        if (i > end || i < start) {
            inc = -inc;
        }
        await sleep(10); // Wait 100ms before updating the next color
    }
}

async function animateDistance(){
    let i = 0;
    let inc = 1000;
    while (true) {
        updateDistance(i);
        i += inc;
        await sleep(10); // Wait 100ms before updating the next color
    }
}

async function animatePosition(){
    let i = 0;
    let inc = 1;
    const max = 20;
    while (true) {
        updatePosition(i);
        i += inc;
        if(i > max || i < 0){
            inc = -inc;
        }
        await sleep(1000);
    }
}