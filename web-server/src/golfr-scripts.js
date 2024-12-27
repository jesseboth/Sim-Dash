config = {};
config["seperateTime"] = true;

yellowRPMPecentage = 0;
function updateRPM(rpm, maxRPM) {
    totalRPM = (Math.ceil(maxRPM / 1000) + 3) * 1000;
    percentage = ((1000 + rpm) / (totalRPM)) * 100;

    var greenWidth = Math.min(percentage, yellowRPMPecentage); // Limit to 15%
    document.getElementById("rpm").style.width = greenWidth + "%";

    if (percentage >= 15) {
        var fillWhite = document.getElementById("rpm-yellow");
        fillWhite.style.left = greenWidth + "%";
        fillWhite.style.width = (percentage - greenWidth) + "%";
    }

    // document.getElementById("rpm").style.width = (percentage) + "%";
    document.getElementById("rpm-indicator").style.left = (percentage - .5) + "%";
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
    percentage = ((1000 + rpm) / (totalRPM)) * 100;
    yellowRPMPecentage = percentage
    document.getElementById("rpm-yellow").style.left = percentage + "%"
}

function updateTraction(traction){
    // do nothing
}
