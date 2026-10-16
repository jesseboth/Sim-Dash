config = {};
config["seperateTime"] = true;
config["dash"] = "tcr";

// TCR dash: an RPM swoosh that climbs at the left and runs flat across the top, gear top left,
// best and lap times, speed, tyres, fuel and clock.
// The update functions replace the ones in dash-scripts.js.

const colorStops = [
    { percentage: 0, color: [0xff, 0xff, 0xff] },
    { percentage: 70, color: [0xff, 0xff, 0xff] },
    { percentage: 80, color: [255, 145, 0] }, // Orange
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
const SWOOSH = { x0: 200, x1: 1380 };
const RED = "#ff3b30";
const NEUTRAL_BLUE = "#207dde";
const FUEL_SEGMENTS = 10;

const tcr = { tachMax: 0 };

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

// Edges of the swoosh: a steep climb at the left, then flat across the top
function swooshTop(x) {
    return 140 + 300 * (1 - smoothstep((x - 200) / 360));
}

function swooshBottom(x) {
    return 268 + 242 * (1 - smoothstep((x - 230) / 370));
}

function swooshPath() {
    const top = [], bottom = [];
    for (let x = SWOOSH.x0; x <= SWOOSH.x1; x += 10) {
        top.push(`${x} ${swooshTop(x).toFixed(1)}`);
        bottom.unshift(`${x} ${swooshBottom(x).toFixed(1)}`);
    }
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

// Position along the swoosh for an RPM; the dial ends at the next full 1000 above the maximum
function rpmX(rpm) {
    const f = tcr.tachMax > 0 ? Math.max(0, Math.min(1, rpm / tcr.tachMax)) : 0;
    return SWOOSH.x0 + f * (SWOOSH.x1 - SWOOSH.x0);
}

function buildDefs(svg) {
    const defs = el("defs", {}, svg);
    const fillClip = el("clipPath", { id: "fillClip" }, defs);
    tcr.fillRect = el("rect", { x: 0, y: 0, width: 0, height: 760 }, fillClip);
    const bandClip = el("clipPath", { id: "bandClip" }, defs);
    el("path", { d: swooshPath() }, bandClip);

    const gloss = el("linearGradient", { id: "gloss", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#fff", "stop-opacity": 0.5 }, gloss);
    el("stop", { offset: "40%", "stop-color": "#fff", "stop-opacity": 0.05 }, gloss);
    el("stop", { offset: "100%", "stop-color": "#000", "stop-opacity": 0.3 }, gloss);

    const unlit = el("linearGradient", { id: "unlit", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#2a2b2f" }, unlit);
    el("stop", { offset: "100%", "stop-color": "#17181b" }, unlit);

}

function buildSwoosh(svg) {
    el("path", { d: swooshPath(), fill: "url(#unlit)", stroke: "#34353a", "stroke-width": 2 }, svg);
    const lit = el("g", { "clip-path": "url(#fillClip)" }, svg);
    tcr.fill = el("path", { d: swooshPath(), fill: interpolateColor(0) }, lit);
    el("path", { d: swooshPath(), fill: "url(#gloss)" }, lit);
    tcr.grid = el("g", {}, svg);
    // Bright edge at the end of the fill
    const edgeGroup = el("g", { "clip-path": "url(#bandClip)" }, svg);
    tcr.edge = el("rect", { x: 0, y: 0, width: 5, height: 760, fill: "#e6e6e6" }, edgeGroup);
}

// A line across the band and a number under it for every 1000 RPM
function configureRPM(maxRPM) {
    const tachMax = Math.ceil(maxRPM / 1000) * 1000;
    if (!tcr.grid || !(tachMax > 0) || tachMax === tcr.tachMax) return;
    tcr.tachMax = tachMax;
    tcr.grid.innerHTML = "";
    const band = el("g", { "clip-path": "url(#bandClip)" }, tcr.grid);
    for (let r = 1000; r <= tachMax; r += 1000) {
        const x = rpmX(r);
        if (r < tachMax) el("line", { x1: x, y1: 0, x2: x, y2: 760, stroke: "rgba(0, 0, 0, 0.35)", "stroke-width": 3 }, band);
        el("text", { x, y: swooshBottom(x) + 28, class: "tick-number", "font-size": 30 }, tcr.grid, r / 1000);
    }
}

function buildText(svg) {
    tcr.gear = el("text", { x: 232, y: 215, class: "value", "font-size": 130, "text-anchor": "middle" }, svg, "N");

    el("text", { x: 650, y: 340, class: "label", "font-size": 20, "text-anchor": "middle" }, svg, "BEST");
    tcr.best = el("text", { x: 650, y: 378, class: "value", "font-size": 42, "text-anchor": "middle" }, svg, "-:--.--");

    // Dirty lap: updateDirtyLap in dash-scripts.js shows the caution image
    const caution = el("g", { id: "caution-container" }, svg);
    const cautionImage = el("image", { id: "caution", x: 772, y: 356, width: 40, height: 40, href: "img/caution.png" }, caution);
    cautionImage.style.display = "none";

    el("text", { x: 930, y: 340, class: "label", "font-size": 20, "text-anchor": "middle" }, svg, "LAP");
    tcr.time = el("text", { x: 930, y: 378, class: "value", "font-size": 42, "text-anchor": "middle" }, svg, "-:--.--");
    tcr.split = el("text", { x: 930, y: 420, class: "value", "font-size": 30, "text-anchor": "middle" }, svg, "");

    el("text", { x: 800, y: 470, class: "label", "font-size": 20, "text-anchor": "middle" }, svg, "MPH");
    tcr.speed = el("text", { x: 800, y: 555, class: "value", "font-size": 150, "text-anchor": "middle" }, svg, "0");

    el("text", { x: 210, y: 612, class: "label", "font-size": 20 }, svg, "FUEL");
    tcr.fuelSegs = [];
    for (let i = 0; i < FUEL_SEGMENTS; i++) {
        tcr.fuelSegs.push(el("rect", { x: 282 + i * 16, y: 602, width: 12, height: 20, fill: "#2a2b30" }, svg));
    }
    tcr.clock = el("text", { x: 210, y: 665, class: "value", "font-size": 44 }, svg, "");

    // Traction light; updateTraction in dash-scripts.js blinks it
    const traction = el("image", { id: "traction", x: 470, y: 590, width: 48, height: 46, href: "img/traction.png" }, svg);
    traction.style.display = "none";
}

function buildCluster() {
    const svg = document.getElementById("cluster");
    if (!svg) return;
    buildDefs(svg);
    buildSwoosh(svg);
    buildText(svg);
    configureRPM(7000);
    updateScreen();
    setInterval(updateScreen, 250);
}

function updateScreen() {
    const now = new Date();
    tcr.clock.textContent = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`;

    // The tyres label shows while any tyre shows
    const anyTyre = ["FL", "FR", "RL", "RR"].some(id => document.getElementById(id)?.style.display !== "none");
    document.querySelector(".tyre-label").style.visibility = anyTyre ? "" : "hidden";
}

// Time as m:ss.cc
function lapTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "-:--.--";
    const cs = Math.floor(seconds * 100);
    return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

// --- Telemetry updates ---

// Same steps as updateRpm in dash-scripts.js, which needs an rpm-container element
function updateRpm(rpm, maxRPM, gear = -99) {
    if (!tcr.fill || rpm == null || maxRPM == null) return;
    initShiftLightRPM(maxRPM);
    configureRPM(maxRPM);
    configureShiftLight(rpm, maxRPM, gear);
    updateRPM(rpm, maxRPM, gear);
    updateShiftLight(rpm);
    if (gear == -99) resetShiftLightRPM();
}

function updateRPM(rpm, maxRPM, gear = -99) {
    const percentage = Math.min(Math.max(rpm / tcr.tachMax * 100, 0), 100);
    const x = rpmX(rpm);
    tcr.fill.setAttribute("fill", interpolateColor(percentage));
    tcr.fillRect.setAttribute("width", x);
    tcr.edge.setAttribute("x", x - 2.5);
}

function updateSpeed(speed) {
    if (!tcr.speed) return;
    const text = Math.round(Number.isFinite(speed) ? Math.max(0, speed) : 0);
    tcr.speed.textContent = text;
}

function updateGear(gear, gearMax = null, gearNeutral = null, gearReverse = null) {
    if (!tcr.gear || gear == null) return;
    let text = String(gear);
    if (gearNeutral != null && gear == gearNeutral) text = "N";
    else if ((gearReverse != null && gear == gearReverse) || gear == 0) text = "R";
    else if (!(gear > 0 && gear < 11) && !(gearMax != null && gear <= gearMax)) text = "N";
    tcr.gear.textContent = text;
    tcr.gear.style.fill = text === "N" ? NEUTRAL_BLUE : text === "R" ? RED : "";
}

function updateTime(id, time, minutes = true) {
    if (!tcr.time) return;
    if (id === "time") tcr.time.textContent = lapTime(time);
    else if (id === "best-time") tcr.best.textContent = lapTime(time);
}

// Gap to the best lap in seconds, green when ahead
function updateSplit(split) {
    if (!tcr.split) return;
    if (split == null || !Number.isFinite(split) || split >= invalidSplit) {
        tcr.split.textContent = "";
        return;
    }
    const gap = Math.abs(split);
    tcr.split.textContent = (split <= 0 ? "-" : "+") + (gap >= 60 ? lapTime(gap) : gap.toFixed(2));
    tcr.split.style.fill = split <= 0 ? "#2ad460" : RED;
}

function updateFuel(percentage) {
    if (!tcr.fuelSegs) return;
    const lit = Number.isFinite(percentage) ? Math.round(Math.max(0, Math.min(100, percentage)) / 100 * FUEL_SEGMENTS) : 0;
    tcr.fuelSegs.forEach((seg, i) => {
        seg.setAttribute("fill", i < lit ? (percentage < 15 ? RED : "#f2f2f2") : "#2a2b30");
    });
}

buildCluster();
