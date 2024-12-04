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

const server = http.createServer((req, res) =>  {
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
    else if (req.url == "/odometer" && req.method === 'GET') {
        const retVal = reqFavoriteOdometer();
        // TODO: favoriteCar should be modifiable via webpage
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(retVal));
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
            telemetry = spawn('../telemetry/fdt', ['-game', game.toUpperCase(), '-split', config.split], options);

            telemetry.stdout.on('data', (data) => {
                process.stdout.write(`FDT: ${data}`);
            });

            telemetry.stderr.on('data', (data) => {
                process.stdout.write(`FDT: ${data}`);
            });

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

function reqFavoriteOdometer() {
    retVal = JSON.parse(JSON.stringify(postReturn));
    retVal.success = true;

    const filePath = "../telemetry/data/odometers/" + config.favoriteCar;

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        retVal.return = data;
    } catch (err) {
        retVal.success = false;
        retVal.error = err.message;
    }

    return retVal;
}