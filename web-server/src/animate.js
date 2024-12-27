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

// Sleep function using Promises
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// Async function to loop with sleep
async function animateRPM() {
    const maxRPM = 8000;
    const minRPM = 800;

    let i = minRPM;
    let inc = 10;

    while (true) {
        configureRPM(maxRPM); 
        updateRPM(i, maxRPM, gear);

        i += inc;
        if (i > maxRPM || i < minRPM) {
            inc = -inc;
        }

        await sleep(10); // Pause for 10ms
    }
}

gear = 0;
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
    start = coldTemperature-50;
    end = hotTemperature;

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
        updateTraction(3,0)
        await sleep(25)
    }
}

async function animateTime() {
    let i = 0;
    let inc = 1;
    while (true) {
        updateTime("time", i);
        i += inc;
        if (i > 100 || i <= 0) {
            inc = -inc;
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