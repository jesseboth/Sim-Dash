config = {};
config["seperateTime"] = true;
config["dash"] = "golfr";

// Times with no leading zero: 41:70 under a minute, 1:23:42 from a minute up.
// Replaces formatTime in dash-scripts.js on this dash only; showMinutes=false keeps the
// first number only (the clock).
window.formatTime = function (floatSeconds, showMinutes = true) {
    const cs = Math.floor(Math.max(0, floatSeconds) * 100);
    const minutes = Math.floor(cs / 6000);
    const seconds = Math.floor(cs / 100) % 60;
    const hundredths = String(cs % 100).padStart(2, "0");
    if (showMinutes && minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}:${hundredths}`;
    return `${showMinutes ? seconds : Math.floor(cs / 100)}:${hundredths}`;
};

yellowRPMPecentage = 0;
// Each number is centred on its RPM: the strip starts 1.5 cells before 0 RPM
const RPM_OFFSET = 1500;
const INDICATOR_HALF_WIDTH = 1.2;   // half of the #rpm-indicator width in golfr-style.css
function updateRPM(rpm, maxRPM) {
    totalRPM = (Math.ceil(maxRPM / 1000) + 3) * 1000;
    percentage = ((RPM_OFFSET + rpm) / (totalRPM)) * 100;

    var greenWidth = Math.min(percentage, yellowRPMPecentage); // Limit to 15%
    document.getElementById("rpm").style.width = greenWidth + "%";

    if (percentage >= 15) {
        var fillWhite = document.getElementById("rpm-yellow");
        fillWhite.style.left = greenWidth + "%";
        fillWhite.style.width = (percentage - greenWidth) + "%";
    }

    // Bright red over the red cells, from where they start up to the current RPM.
    // Measured again if the strip had no size when it was built (page still loading).
    if (!document.getElementById("rpm-red")) updateRedStart(document.getElementsByClassName("grid-container")[0]);
    const redFill = document.getElementById("rpm-red");
    if (redFill) {
        redFill.style.left = redStartPercentage + "%";
        redFill.style.width = Math.max(0, percentage - redStartPercentage) + "%";
    }

    document.getElementById("rpm-indicator").style.left = (percentage - INDICATOR_HALF_WIDTH) + "%";

    updateCurrentNumber(rpm, percentage);
}

// The number under the moving line grows. It shakes in the yellow zone, and harder in the red.
function updateCurrentNumber(rpm, percentage) {
    const numbers = document.getElementById("rpm-numbers");
    if (!numbers) return;
    const index = Math.max(0, Math.min(numbers.children.length - 1, Math.round(rpm / 1000)));
    const inRed = percentage >= redStartPercentage;
    const inYellow = !inRed && percentage >= yellowRPMPecentage;
    [...numbers.children].forEach((number, i) => {
        const current = i === index && number.textContent !== "";
        number.classList.toggle("current", current);
        number.classList.toggle("shake", current && inYellow);
        number.classList.toggle("shake-hard", current && inRed);
    });
}

// The cells and numbers are built again only when the maximum RPM changes,
// so the number animations keep running between updates
let configuredMaxRPM = null;
function configureRPM(maxRPM) {
    if (maxRPM === configuredMaxRPM) return;
    configuredMaxRPM = maxRPM;
    const gridContainer = document.getElementsByClassName("grid-container")[0];
    const gridElements = document.getElementsByClassName("grid-item");
    for (let i = gridElements.length - 1; i >= 0; i--) {
        gridElements[i].remove();
    }

    rpmboxes = Math.ceil((maxRPM) / 1000) + 1;
    for (let i = 0; i < rpmboxes; i++) {
        // Create a new grid item element
        const gridItem = document.createElement('div');
        gridItem.classList.add('grid-item');
        if (rpmboxes < 12) {
            gridItem.textContent = i;
        }
        else if (i != 0 && i != rpmboxes - 1) {
            gridItem.textContent = i;
        }

        // Append the grid item to the grid container
        gridContainer.appendChild(gridItem);
    }

    for (i = 0; i < rpmboxes; i++) {
        if (i >= rpmboxes - 2) {
            document.getElementsByClassName("grid-item")[i].classList.add("rpmRed");
        }
        else {
            document.getElementsByClassName("grid-item")[i].classList.remove("rpmYellow", "rpmRed");
        }
    }


    if (document.querySelectorAll('.grid-item').length > 10) {
        document.querySelector('.grid-container').classList.add('over-ten');
    }
    else {
        document.querySelector('.grid-container').classList.remove('over-ten');
    }

    // yellow starts at the left edge of its number's cell, one cell (1000) after the strip start
    rpm = (rpmboxes - 4) * 1000;
    totalRPM = (Math.ceil(maxRPM / 1000) + 3) * 1000;
    percentage = ((1000 + rpm) / (totalRPM)) * 100;
    yellowRPMPecentage = percentage
    document.getElementById("rpm-yellow").style.left = percentage + "%"

    updateRPMNumbers(gridContainer);
    updateRedStart(gridContainer);
}

// Where the red cells start, in percent of the strip. The bright red fill covers them from there.
let redStartPercentage = 100;
function updateRedStart(gridContainer) {
    const firstRed = gridContainer.querySelector(".rpmRed");
    const width = gridContainer.getBoundingClientRect().width;
    if (!firstRed || !width) return;
    redStartPercentage = (firstRed.getBoundingClientRect().left - gridContainer.getBoundingClientRect().left) / width * 100;

    const container = document.getElementById("rpm-container");
    const indicator = document.getElementById("rpm-indicator");
    if (!document.getElementById("rpm-red")) {
        const redFill = document.createElement("div");
        redFill.id = "rpm-red";
        container.insertBefore(redFill, indicator);
    }

    // Divider lines of the cells, again above the red fill so it does not hide them
    let dividers = document.getElementById("rpm-dividers");
    if (!dividers) {
        dividers = document.createElement("div");
        dividers.id = "rpm-dividers";
        dividers.className = "grid-container rpm-dividers";
        container.insertBefore(dividers, indicator);
    }
    dividers.replaceChildren(...[...gridContainer.children].map(() => {
        const divider = document.createElement("div");
        divider.className = "rpm-divider";
        return divider;
    }));
}

// The numbers are a second layer above the moving line, so the line passes under them.
// The cells below keep the colours and borders.
function updateRPMNumbers(gridContainer) {
    let numbers = document.getElementById("rpm-numbers");
    if (!numbers) {
        numbers = document.createElement("div");
        numbers.id = "rpm-numbers";
        numbers.className = "grid-container rpm-numbers";
        document.getElementById("rpm-container").appendChild(numbers);
    }
    numbers.replaceChildren(...[...gridContainer.children].map(cell => {
        const number = document.createElement("div");
        number.className = "rpm-number";
        number.textContent = cell.textContent;
        return number;
    }));
}
