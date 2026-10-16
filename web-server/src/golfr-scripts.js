config = {};
config["seperateTime"] = true;
config["dash"] = "golfr";

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

    // document.getElementById("rpm").style.width = (percentage) + "%";
    document.getElementById("rpm-indicator").style.left = (percentage - INDICATOR_HALF_WIDTH) + "%";
}

function configureRPM(maxRPM) {
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

    // yellow start
    rpm = (rpmboxes - 4) * 1000;
    totalRPM = (Math.ceil(maxRPM / 1000) + 3) * 1000;
    percentage = ((RPM_OFFSET + rpm) / (totalRPM)) * 100;
    yellowRPMPecentage = percentage
    document.getElementById("rpm-yellow").style.left = percentage + "%"

    updateRPMNumbers(gridContainer);
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
