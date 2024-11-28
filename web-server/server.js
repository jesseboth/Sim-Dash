const http = require('http');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { spawn } = require('child_process');
const port = 3000; // This is the port for the Express server

// Template for the return objects
const postReturn = {
    success: false,
    return: undefined,
    error: undefined,
}

const EventEmitter = require('events');
const { DefaultDeserializer } = require('v8');
const { error } = require('console');
class Emitter extends EventEmitter { };
const myEmitter = new Emitter();
const serveFile = async (filePath, contentType, response) => {
    try {
        const rawData = await fsPromises.readFile(
            filePath,
            !contentType.includes('image') ? 'utf8' : ''
        );
        const data = contentType === 'application/json'
            ? JSON.parse(rawData) : rawData;
        response.writeHead(
            filePath.includes('404.html') ? 404 : 200,
            { 'Content-Type': contentType }
        );
        response.end(
            contentType === 'application/json' ? JSON.stringify(data) : data
        );
    } catch (err) {
        console.error(err);
        myEmitter.emit('log', `${err.name}: ${err.message}`, 'errLog.txt');
        response.statusCode = 500;
        response.end();
    }
}

const server = http.createServer((req, res) => {
    myEmitter.emit('log', `${req.url}\t${req.method}`, 'reqLog.txt');

    const extension = path.extname(req.url);

    let contentType;

    // is this needed?
    if (req.url == "/telemetrytype" && req.method === 'GET') {
        retVal = { "type": null }
        if (telemetry != null) {
            retVal["type"] = telemetryType;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(retVal));
        return;
    }

    else if (req.url == "/Odometer" && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString(); // convert Buffer to string
        });

        req.on('end', () => {
            try {
                retJson = {}
                const data = JSON.parse(body);
                const carNumber = data.carNumber;
                const meters = data.meters;

                if (meters == null) {
                    retJson = readOdometer(carNumber)
                }
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(JSON.stringify(retJson));

            } catch (error) {
                console.error('Error parsing JSON:', error);
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid JSON');
            }
        });
        return;
    }
    else if (req.url === '/config' && req.method === 'POST') {
        retJson = JSON.parse(JSON.stringify(postReturn));

        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString(); // convert Buffer to string
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                retJson.success = true;

                if (data.hasOwnProperty("game")) { retJson["game"] = reqGame(data.game); }
                else if (data.hasOwnProperty("split")) { retJson["split"] = reqSplit(data.split); }
                else if (data.hasOwnProperty("scale")) { retJson["scale"] = reqScale(data.scale); }
                else {
                    retJson.success = false;
                    retJson.error = "Invalid config request: property unknown"
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(retJson));

            } catch (error) {
                console.error('Error parsing JSON:', error);
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid JSON');
            }
        });

        return;
    }

    switch (extension) {
        case '.css':
            contentType = 'text/css';
            break;
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.jpg':
            contentType = 'image/jpeg';
            break;
        case '.png':
            contentType = 'image/png';
            break;
        case '.txt':
            contentType = 'text/plain';
            break;
        case '.otf':
            contentType = 'application/x-font-opentype';
            break;
        default:
            contentType = 'text/html';
    }

    let filePath =
        contentType === 'text/html' && req.url === '/'
            ? path.join(__dirname, 'views', 'index.html')
            : contentType === 'text/html' && req.url.slice(-1) === '/'
                ? path.join(__dirname, 'views', req.url, 'index.html')
                : contentType === 'text/html'
                    ? path.join(__dirname, 'views', req.url)
                    : path.join(__dirname, req.url);

    // makes .html extension not required in the browser
    if (!extension && req.url.slice(-1) !== '/') filePath += '.html';

    const fileExists = fs.existsSync(filePath);

    if (req.url == "/dash") {
        serveFile(path.join(__dirname, 'views', dash + '.html'), 'text/html', res);
        return;
    }

    if (fileExists) {
        serveFile(filePath, contentType, res);
    } else {
        switch (path.parse(filePath).base) {
            case 'old-page.html':
                res.writeHead(301, { 'Location': '/new-page.html' });
                res.end();
                break;
            case 'www-page.html':
                res.writeHead(301, { 'Location': '/' });
                res.end();
                break;
            default:
                serveFile(path.join(__dirname, 'views', '404.html'), 'text/html', res);
        }
    }
});
const PORT = process.env.PORT || port;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Function to read and parse the JSON file
const getJsonData = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error reading or parsing file: ${err}`);
        return null;
    }
};

const config = getJsonData('data/config.json');

telemetry = null;
telemetryType = ""
const options = {
    cwd: '../telemetry/', // Set the working directory
};

dash = "forza-dash";

function reqGame(game) {
    retVal = JSON.parse(JSON.stringify(postReturn));
    game = game.toLowerCase();
    if (game == "stop") {
        if (telemetry != null) {
            telemetryType = "";
            telemetry.kill('SIGKILL');
            telemetry = null
            resetOdometer()
            dash = "forza-dash"
        } else {
            retVal.error = "Telemetry not running"
        }
        retVal.success = true;

    } else if (game == "get") {
        if(telemetryType == ""){
            retVal.error = "No game running"
        }
        else {
            retVal.return = telemetryType;

        }
        retVal.success = true;

    } else {
        if (telemetry == null) {
            telemetryType = game
            dash = "forza-dash"
            telemetry = spawn('../telemetry/fdt', ['-game', game, '-j', '-split', config.split], options);
            retVal.success = true;
        } else {
            retVal.error = "Telemetry already running, stop before starting a new game"
        }
    }

    return retVal;
}

scales = getJsonData('data/scale.json');
scale = { ...scales["default"] };

scaleSpeedUp = false;
scaleTime = 0;

function reqScale(data) {
    retVal = JSON.parse(JSON.stringify(postReturn));
    if (data.hasOwnProperty("scale")) {
        scale["zoom"] += data.scale;
        scaleTime = Date.now();
    }
    if (data.hasOwnProperty("move")) {
        scale["top"] += data.move;
        scaleTime = Date.now();
    }

    if (data.hasOwnProperty("set") && data.set != "custom") {
        if(data.set != config.scale){
            config.scale = data.set;
            fs.writeFileSync('data/config.json', JSON.stringify(config, null, 4));
        }

        scale = { ...scales[data.set] };
        retVal.success = true;
    }
    else if (data.hasOwnProperty("set") && data.set == "custom") {
        config.scale = data.set;
        scaleTime = Date.now();
        scaleSpeedUp = true;
        retVal.success = true;
    }
    else if (data.hasOwnProperty("get") && data.get == "keys") {
        retVal.success = true;
        retVal.return = Object.keys(scales);
    }
    else if (data.hasOwnProperty("get") && data.get == "current") {
        retVal.success = true;
        retVal.return = config.scale;
    }
    else if (data.hasOwnProperty("save")) {
        scales[data["save"]] = { ...scale };
        fs.writeFileSync('data/scale.json', JSON.stringify(scales, null, 4));
        retVal.success = true;
    }
    else {
        if (scaleTime != 0 && Date.now() - scaleTime > 10000) {
            scaleTime = 0;
            scaleSpeedUp = false;
        }

        const top = scale["top"];
        const zoom = scale["zoom"];
        const width = zoom;
        const left = (100 - width) / 2;

        retVal.return = {
            "top": top + "%",
            "left": left + "%",
            "width": width + "%",
            "zoom": zoom + "%",
            "speedUp": scaleSpeedUp
        }

        retVal.success = true;
    }

    return retVal;
}

function reqSplit(input) {
    retVal = JSON.parse(JSON.stringify(postReturn));

    input = input.toLowerCase();

    if (input == "car" || input == "class" || input == "session") {
        if(input != config.split){
            config.split = input;
            fs.writeFileSync('data/config.json', JSON.stringify(config, null, 4));
        }
        config.split = input;
        retVal.success = true;
    }
    else if (input == "get") {
        retVal.success = true;
        retVal.return = config.split;
    }
    else {
        retVal.error = "Invalid split type"
    }
    return retVal;
}











/////////////////////////////////////////////////////////////////
// Odometer Functions - TODO: These should be moved to telemetry
// Function to update car data in a JSON file
function updateCarData() {
    const filename = 'data/odometers.json';

    // Read existing data from JSON file
    let carData = {};
    try {
        const data = fs.readFileSync(filename, 'utf8');
        carData = JSON.parse(data);
    } catch (error) {
        // Handle file read error or empty file
    }

    if (OdometerInfo.carNumber > 0 && !carData.hasOwnProperty(OdometerInfo.carNumber)) {
        carData[OdometerInfo.carNumber] = OdometerInfo.stored;
    }
    else if (OdometerInfo.carNumber > 0 && OdometerInfo.stored > carData[OdometerInfo.carNumber]) {
        carData[OdometerInfo.carNumber] = OdometerInfo.stored;
    }
    else {
        return;
    }
    // Write updated data back to JSON file
    try {
        const jsonData = JSON.stringify(carData, null, 2);
        fs.writeFileSync(filename, jsonData);
    } catch (error) {
    }
}

OdometerInfo = {
    carNumber: 0,
    meters: 0,
    offset: 0,
    stored: 0,
}

function getCarData(carNumber) {
    try {
        const data = fs.readFileSync('data/odometers.json', 'utf8');
        carData = JSON.parse(data);
    } catch (err) {
        return;
    }

    carString = carNumber.toString();
    // Check if the car number exists in the data
    if (carData.hasOwnProperty(carNumber)) {
        OdometerInfo.stored = (carData[carNumber])
    } else {
        OdometerInfo.stored = 0;
    }
}

function getStoredDistance(carNumber) {
    try {
        const data = fs.readFileSync('data/odometers.json', 'utf8');
        carData = JSON.parse(data);
    } catch (err) {
        console.error(err)
        return;
    }

    carString = carNumber.toString();

    // Check if the car number exists in the data
    if (carData.hasOwnProperty(carNumber)) {
        return carData[carNumber];
    } else {
        return 0;
    }
}

dataSaved = false;
let interval = setInterval(updateOdometer, 25);
function updateOdometer() {
    if (telemetryType == "") {
        return;
    }

    const options = {
        hostname: "localhost",
        port: 8888,
        path: '/telemetry',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        let data = '';

        // A chunk of data has been received
        res.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received
        res.on('end', () => {
            if (res.statusCode !== 200) {
                return;
            }
            if (data == null) {
                return;
            }
            try {
                jsonData = JSON.parse(data);
                if (Object.keys(jsonData).length === 0) {
                    return;
                }
            }
            catch {
                return;
            }

            newCarNumber = jsonData["CarOrdinal"]
            newMeters = jsonData["DistanceTraveled"];
            velocity = jsonData["Speed"];
            if (newMeters == 0 && velocity > 5) {
                newMeters = OdometerInfo.meters + (velocity * .025)
            }

            if (newCarNumber != OdometerInfo.carNumber) {
                updateCarData()
                getCarData(newCarNumber);
            }

            if (newCarNumber != 0) {
                dataSaved = false;
            }

            OdometerInfo.carNumber = newCarNumber;
            if (newCarNumber != 0) {
                if (newMeters <= 0) {
                    OdometerInfo.offset = newMeters
                }
                else {
                    OdometerInfo.offset = OdometerInfo.meters;
                }
                OdometerInfo.meters = newMeters;
                OdometerInfo.stored += (OdometerInfo.meters - OdometerInfo.offset)
            }

        });
    });

    req.on('error', (error) => {
    });

    req.end();
}

function readOdometer(carNumber) {
    carString = carNumber.toString();
    if (OdometerInfo.carNumber == carNumber) {
        return { "carNumber": carString, "meters": OdometerInfo.stored };
    } else {
        return { "carNumber": carString, "meters": getStoredDistance(carNumber) };
    }
}

function resetOdometer() {
    updateCarData()

    OdometerInfo.carNumber = 0;
    OdometerInfo.meters = 0;
    OdometerInfo.offset = 0;
    OdometerInfo.store = 0;
}