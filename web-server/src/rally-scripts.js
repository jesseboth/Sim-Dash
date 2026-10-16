config = {};
config["seperateTime"] = true;
config["dash"] = "rally";

// Rally dash: an RPM swoosh from bottom left to top right with no scale, gear left, time top left,
// RPM and speed right, and stage progress along the bottom.
// The update functions replace the ones in dash-scripts.js.

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

// --- Drawing ---

const SVG_NS = "http://www.w3.org/2000/svg";
const SWOOSH = { x0: 100, x1: 1500 };
const RED = "#ff3b30";
const FUEL_SEGMENTS = 10;

const rally = { maxRpm: 0 };

function el(tag, attrs, parent, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
}

function smoothstep(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
}

// Top and bottom edges of the swoosh: flat at the bottom left, rising, flat at the top right
function swooshTop(x) {
    return 610 - 520 * smoothstep((x - 280) / 940);
}

function swooshBottom(x) {
    return 680 - 310 * smoothstep((x - 330) / 900);
}

// Radius of the round left end. Its leftmost point is at SWOOSH.x0.
function capRadius() {
    return (swooshBottom(SWOOSH.x0) - swooshTop(SWOOSH.x0)) / 2;
}

function swooshPath() {
    const r = capRadius();
    const start = SWOOSH.x0 + r;
    const top = [], bottom = [];
    for (let x = start; x <= SWOOSH.x1; x += 10) {
        top.push(`${x} ${swooshTop(x).toFixed(1)}`);
        bottom.unshift(`${x} ${swooshBottom(x).toFixed(1)}`);
    }
    // Round left end: a half circle from the bottom edge back up to the top edge
    return `M${top.join(" L")} L${bottom.join(" L")} A${r} ${r} 0 0 1 ${start} ${swooshTop(start).toFixed(1)} Z`;
}

// Position along the swoosh for an RPM, from the tip of the round left end
function rpmX(rpm) {
    const f = rally.maxRpm > 0 ? Math.max(0, Math.min(1, rpm / rally.maxRpm)) : 0;
    return SWOOSH.x0 + f * (SWOOSH.x1 - SWOOSH.x0);
}

function buildDefs(svg) {
    const defs = el("defs", {}, svg);
    const clip = el("clipPath", { id: "swooshClip" }, defs);
    el("path", { d: swooshPath() }, clip);
    const fillClip = el("clipPath", { id: "fillClip" }, defs);
    rally.fillRect = el("rect", { x: 0, y: 0, width: 0, height: 770 }, fillClip);

    const gloss = el("linearGradient", { id: "gloss", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#fff", "stop-opacity": 0.45 }, gloss);
    el("stop", { offset: "35%", "stop-color": "#fff", "stop-opacity": 0.08 }, gloss);
    el("stop", { offset: "100%", "stop-color": "#000", "stop-opacity": 0.35 }, gloss);

    const unlit = el("linearGradient", { id: "unlit", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#222327" }, unlit);
    el("stop", { offset: "100%", "stop-color": "#121215" }, unlit);
}

function buildSwoosh(svg) {
    el("path", { d: swooshPath(), fill: "url(#unlit)", stroke: "#2c2d32", "stroke-width": 2 }, svg);
    const lit = el("g", { "clip-path": "url(#fillClip)" }, svg);
    rally.fill = el("path", { d: swooshPath(), fill: interpolateColor(0) }, lit);
    el("path", { d: swooshPath(), fill: "url(#gloss)" }, lit);
}

function configureRPM(maxRPM) {
    if (maxRPM > 0) rally.maxRpm = maxRPM;
}

function buildText(svg) {
    rally.gear = el("text", { x: 330, y: 400, class: "value", "font-size": 230, "text-anchor": "middle" }, svg, "N");

    el("text", { x: 760, y: 150, class: "label", "font-size": 22, "text-anchor": "end" }, svg, "STAGE TIME");
    rally.time = el("text", { x: 760, y: 200, class: "value", "font-size": 66, "text-anchor": "end" }, svg, "-:--.--");
    rally.split = el("text", { x: 760, y: 252, class: "value", "font-size": 40, "text-anchor": "end" }, svg, "");

    // Shift light: a ring that fills red at the shift point
    rally.shiftRing = el("circle", { cx: 1130, cy: 455, r: 30, fill: "#111114", stroke: "#3a3b40", "stroke-width": 4 }, svg);

    el("text", { x: 1440, y: 418, class: "label", "font-size": 22, "text-anchor": "end" }, svg, "RPM");
    rally.rpm = el("text", { x: 1440, y: 465, class: "value", "font-size": 76, "text-anchor": "end" }, svg, "0");

    el("text", { x: 1440, y: 545, class: "label", "font-size": 22, "text-anchor": "end" }, svg, "MPH");
    rally.speed = el("text", { x: 1440, y: 615, class: "value", "font-size": 130, "text-anchor": "end" }, svg, "0");

    // Stage progress, or distance when the game gives no stage length
    rally.stageLabel = el("text", { x: 820, y: 615, class: "label", "font-size": 22 }, svg, "DISTANCE");
    rally.stageValue = el("text", { x: 820, y: 655, class: "value", "font-size": 44 }, svg, "- mi");
    el("rect", { x: SWOOSH.x0, y: 706, width: SWOOSH.x1 - SWOOSH.x0, height: 8, rx: 4, fill: "#1c1d21" }, svg);
    rally.stageBar = el("rect", { x: SWOOSH.x0, y: 706, width: 0, height: 8, rx: 4, fill: "#f2f2f2" }, svg);

    rally.clock = el("text", { x: SWOOSH.x0, y: 745, class: "value", "font-size": 42 }, svg, "");
    el("text", { x: 320, y: 745, class: "label", "font-size": 20 }, svg, "FUEL");
    rally.fuelSegs = [];
    for (let i = 0; i < FUEL_SEGMENTS; i++) {
        rally.fuelSegs.push(el("rect", { x: 392 + i * 16, y: 735, width: 12, height: 20, fill: "#2a2b30" }, svg));
    }
}

function buildCluster() {
    const svg = document.getElementById("cluster");
    if (!svg) return;
    buildDefs(svg);
    buildSwoosh(svg);
    buildText(svg);
    configureRPM(8000);
    updateScreen();
    setInterval(updateScreen, 250);
}

function updateScreen() {
    const now = new Date();
    rally.clock.textContent = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`;
    updateStage(typeof telemetry !== "undefined" ? telemetry : null);

    // The tyres label shows while any tyre shows
    const anyTyre = ["FL", "FR", "RL", "RR"].some(id => document.getElementById(id)?.style.display !== "none");
    document.querySelector(".tyre-label").style.visibility = anyTyre ? "" : "hidden";
}

// Stage progress from StageProgress (DiRT Rally) or Odometer / StageLength (EA WRC).
// Other games: the distance only.
function updateStage(data) {
    const length = data && data["StageLength"] > 0 ? data["StageLength"] : null;
    const driven = data && Number.isFinite(data["Odometer"]) ? Math.max(0, data["Odometer"]) : null;
    let progress = null;
    if (data && data["StageProgress"] > 0) progress = data["StageProgress"];
    else if (length && driven !== null) progress = driven / length;

    if (length && progress !== null) {
        const left = Math.max(0, length * (1 - Math.min(1, progress)));
        rally.stageLabel.textContent = "TO GO";
        rally.stageValue.textContent = `${metersToMiles(left, 1)} mi`;
        rally.stageBar.setAttribute("width", (SWOOSH.x1 - SWOOSH.x0) * Math.max(0, Math.min(1, progress)));
    } else {
        rally.stageLabel.textContent = "DISTANCE";
        rally.stageValue.textContent = driven ? `${metersToMiles(driven, 2)} mi` : "- mi";
        rally.stageBar.setAttribute("width", 0);
    }
}

// Time as m:ss.cc
function stageTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "-:--.--";
    const cs = Math.floor(seconds * 100);
    return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

// --- Telemetry updates ---

// Same steps as updateRpm in dash-scripts.js, which needs an rpm-container element
function updateRpm(rpm, maxRPM, gear = -99) {
    if (!rally.fill || rpm == null || maxRPM == null) return;
    initShiftLightRPM(maxRPM);
    configureShiftLight(rpm, maxRPM, gear);
    updateRPM(rpm, maxRPM, gear);
    updateShiftLight(rpm);
    if (gear == -99) resetShiftLightRPM();
}

function updateRPM(rpm, maxRPM, gear = -99) {
    if (!rally.fill) return;
    configureRPM(maxRPM);
    const percentage = Math.min(Math.max(rpm / maxRPM * 100, 0), 100);
    const color = interpolateColor(percentage);
    rally.fill.setAttribute("fill", color);
    rally.fillRect.setAttribute("width", rpmX(rpm));
    rally.rpm.textContent = Math.round(rpm);
    rally.rpm.style.fill = color;

    configureShiftDot(gear, rpm, maxRPM);
    updateShiftDot(rpm);
}

function updateSpeed(speed) {
    if (!rally.speed) return;
    rally.speed.textContent = Math.round(Number.isFinite(speed) ? Math.max(0, speed) : 0);
}

function updateGear(gear, gearMax = null, gearNeutral = null, gearReverse = null) {
    if (!rally.gear || gear == null) return;
    let text = String(gear);
    if (gearNeutral != null && gear == gearNeutral) text = "N";
    else if ((gearReverse != null && gear == gearReverse) || gear == 0) text = "R";
    else if (!(gear > 0 && gear < 11) && !(gearMax != null && gear <= gearMax)) text = "N";
    rally.gear.textContent = text;
    rally.gear.style.fill = text === "R" ? RED : "";
}

function updateTime(id, time, minutes = true) {
    if (!rally.time) return;
    if (id === "time") rally.time.textContent = stageTime(time);
}

// Gap to the best time in seconds, green when ahead
function updateSplit(split) {
    if (!rally.split) return;
    if (split == null || !Number.isFinite(split) || split >= invalidSplit) {
        rally.split.textContent = "";
        return;
    }
    const gap = Math.abs(split);
    rally.split.textContent = (split <= 0 ? "-" : "+") + (gap >= 60 ? stageTime(gap) : gap.toFixed(2));
    rally.split.style.fill = split <= 0 ? "#2ad460" : RED;
}

function updateFuel(percentage) {
    if (!rally.fuelSegs) return;
    const lit = Number.isFinite(percentage) ? Math.round(Math.max(0, Math.min(100, percentage)) / 100 * FUEL_SEGMENTS) : 0;
    rally.fuelSegs.forEach((seg, i) => {
        seg.setAttribute("fill", i < lit ? (percentage < 15 ? RED : "#f2f2f2") : "#2a2b30");
    });
}

function updateDistance(_distance) {
    // Distance shows in the stage area, from updateStage
}

// --- Shift light ---

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
    const on = rpmDotMax != -1 && rpm > rpmDotMax * 0.9625;
    rally.shiftRing.setAttribute("fill", on ? RED : "#111114");
    rally.shiftRing.setAttribute("stroke", on ? "#ff8a80" : "#3a3b40");
}

function updateTraction(traction){
    // do nothing
}

setMaxRPM = -1;
rpmDotMax = -1;
function initShiftLightRPM(maxRPM) {
    if (maxRPM != setMaxRPM) {
        setMaxRPM = maxRPM;
        rpmDotMax = maxRPM * 0.8; // set initial value
    }
}

function resetShiftLightRPM() {
    rpmDotMax = -1;
    setMaxRPM = -1;
}

buildCluster();
