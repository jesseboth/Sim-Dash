config = {};
config["seperateTime"] = true;
config["dash"] = "gt4";

// Porsche GT4 cluster: speedometer left, tachometer centre, screen right.
// The update functions replace the ones in dash-scripts.js.

const SVG_NS = "http://www.w3.org/2000/svg";
const TICK_COLOR = "#f5c518";
const RED = "#e0261b";
const UNLIT = "rgba(255, 255, 255, 0.18)";
const SPEEDO = { cx: 430, cy: 420, r: 215, max: 200, from: -140, to: 45 };
const TACH = { cx: 800, cy: 380, r: 262, from: -135, to: 135 };
const BAND_OVERHANG = 11;   // degrees the blue band runs past the first and last number
const SCREEN = { cx: 1170, cy: 420, r: 215 };
const FUEL_SEGMENTS = 12;
const BAR_SEGMENTS = 8;
const TYRE_BAR_MIN = 100;   // °F at an empty bar
const TYRE_BAR_MAX = 300;   // °F at a full bar

const gt4 = {
    tachMax: 0,
    redline: 0,
    tyres: {},
    odometerStart: null
};

function el(tag, attrs, parent, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
}

// Point at a clock angle (0 = up, clockwise) and radius from a centre
function polar(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function arcPath(cx, cy, r1, r2, from, to) {
    const large = to - from > 180 ? 1 : 0;
    const [x1, y1] = polar(cx, cy, r2, from);
    const [x2, y2] = polar(cx, cy, r2, to);
    const [x3, y3] = polar(cx, cy, r1, to);
    const [x4, y4] = polar(cx, cy, r1, from);
    return `M${x1} ${y1} A${r2} ${r2} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 ${large} 0 ${x4} ${y4} Z`;
}

// Thin arc line, for the rings in the tachometer band
function arcLine(cx, cy, r, from, to) {
    const large = to - from > 180 ? 1 : 0;
    const [x1, y1] = polar(cx, cy, r, from);
    const [x2, y2] = polar(cx, cy, r, to);
    return `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function tick(parent, g, angle, outer, length, width, color = TICK_COLOR) {
    const [x1, y1] = polar(g.cx, g.cy, outer, angle);
    const [x2, y2] = polar(g.cx, g.cy, outer - length, angle);
    el("line", { x1, y1, x2, y2, stroke: color, "stroke-width": width }, parent);
}

// Needle with a ridge down the middle: a lit half and a shaded half. The shadow is on an
// outer group that does not turn, so the light comes from the same side at every angle.
function needle(parent, g, length, tail, width) {
    const { cx, cy } = g;
    const shadow = el("g", { filter: "url(#needleShadow)" }, parent);
    const group = el("g", { class: "needle" }, shadow);
    group.style.transformOrigin = `${cx}px ${cy}px`;
    el("path", {
        d: `M${cx - width} ${cy + tail} L${cx - 1.2} ${cy - length} L${cx} ${cy - length - 1} L${cx} ${cy + tail} Z`,
        fill: "url(#needleLit)"
    }, group);
    el("path", {
        d: `M${cx} ${cy + tail} L${cx} ${cy - length - 1} L${cx + 1.2} ${cy - length} L${cx + width} ${cy + tail} Z`,
        fill: "url(#needleShade)"
    }, group);
    return group;
}

// Metal cap over the needle centre, with a highlight at the top left
function hubCap(parent, g, r) {
    el("circle", { cx: g.cx, cy: g.cy, r, fill: "url(#hubCap)", stroke: "#050506", "stroke-width": 1.5, filter: "url(#needleShadow)" }, parent);
    el("ellipse", { cx: g.cx - r * 0.3, cy: g.cy - r * 0.35, rx: r * 0.45, ry: r * 0.28, fill: "rgba(255, 255, 255, 0.28)" }, parent);
}

const LOGO_FILES = ["img/gt4-logo.png"];
const SILHOUETTE_FILE = "img/gt4-silhouette.png";

// GT4 logo from a logo file in img/. Without one, italic text.
function logo(parent, x, y, height) {
    const text = el("text", { x, y, class: "logo", "font-size": height }, parent, "GT4");
    const width = height * 4.35;
    const image = el("image", { x: x - width / 2, y: y - height / 2, width, height, preserveAspectRatio: "xMidYMid meet" }, parent);
    image.style.display = "none";
    let next = 0;
    const tryNext = () => {
        if (next >= LOGO_FILES.length) return image.remove();
        image.setAttribute("href", LOGO_FILES[next++]);
    };
    image.addEventListener("load", () => {
        image.style.display = "";
        text.remove();
    });
    image.addEventListener("error", tryNext);
    tryNext();
}

function setNeedle(group, angle) {
    group.style.transform = `rotate(${angle}deg)`;
}

function bezel(svg, g, width) {
    el("circle", { cx: g.cx, cy: g.cy, r: g.r + width, fill: "url(#bezel)" }, svg);
    el("circle", { cx: g.cx, cy: g.cy, r: g.r + 2, fill: "#000" }, svg);
}

// Dark strip at the bottom of a gauge, for LCD readouts
function lcdStrip(svg, x, y, width, height) {
    el("rect", { x, y, width, height, rx: height / 2, fill: "url(#lcdStrip)" }, svg);
}

// LCD value with a small unit after it, a fixed gap apart. Gives the value element.
function readout(parent, x, y, size, unit, unitSize, anchor = "middle") {
    const text = el("text", { x, y, class: "lcd", "font-size": size, "text-anchor": anchor }, parent);
    const value = el("tspan", {}, text, "- -");
    if (unit) el("tspan", { class: "unit-span", "font-size": unitSize, dx: unitSize * 0.35, dy: (size - unitSize) * 0.28 }, text, unit);
    return value;
}

function buildDefs(svg) {
    const defs = el("defs", {}, svg);

    const bz = el("radialGradient", { id: "bezel", cx: "50%", cy: "30%", r: "70%" }, defs);
    el("stop", { offset: "85%", "stop-color": "#151618" }, bz);
    el("stop", { offset: "95%", "stop-color": "#34363a" }, bz);
    el("stop", { offset: "100%", "stop-color": "#0a0a0b" }, bz);

    const face = el("radialGradient", { id: "face", cx: "50%", cy: "45%", r: "60%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#121214" }, face);
    el("stop", { offset: "100%", "stop-color": "#030304" }, face);

    const band = el("radialGradient", { id: "band", cx: "50%", cy: "50%", r: "50%" }, defs);
    el("stop", { offset: "62%", "stop-color": "#0b4fb8" }, band);
    el("stop", { offset: "78%", "stop-color": "#1a8cf0" }, band);
    el("stop", { offset: "90%", "stop-color": "#1576dc" }, band);
    el("stop", { offset: "100%", "stop-color": "#0a3f9c" }, band);

    const screen = el("radialGradient", { id: "screenBg", cx: "62%", cy: "45%", r: "65%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#1b1c20" }, screen);
    el("stop", { offset: "60%", "stop-color": "#0b0b0d" }, screen);
    el("stop", { offset: "100%", "stop-color": "#030304" }, screen);

    const lcd = el("linearGradient", { id: "lcdStrip", x1: "0", y1: "0", x2: "1", y2: "0" }, defs);
    el("stop", { offset: "0%", "stop-color": "#000" }, lcd);
    el("stop", { offset: "50%", "stop-color": "#2a1d17" }, lcd);
    el("stop", { offset: "100%", "stop-color": "#000" }, lcd);

    const housing = el("linearGradient", { id: "housing", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#141416" }, housing);
    el("stop", { offset: "100%", "stop-color": "#060607" }, housing);

    // Needles: lit and shaded halves, brighter towards the tip
    const lit = el("linearGradient", { id: "needleLit", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#ffe08a" }, lit);
    el("stop", { offset: "45%", "stop-color": "#ffbb3a" }, lit);
    el("stop", { offset: "100%", "stop-color": "#e08d12" }, lit);
    const shade = el("linearGradient", { id: "needleShade", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#e89a20" }, shade);
    el("stop", { offset: "45%", "stop-color": "#c97a0c" }, shade);
    el("stop", { offset: "100%", "stop-color": "#8f5205" }, shade);

    const cap = el("radialGradient", { id: "hubCap", cx: "35%", cy: "30%", r: "75%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#6a6c72" }, cap);
    el("stop", { offset: "55%", "stop-color": "#25262a" }, cap);
    el("stop", { offset: "100%", "stop-color": "#08080a" }, cap);

    const shadowFilter = el("filter", { id: "needleShadow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
    el("feDropShadow", { dx: 3, dy: 4, stdDeviation: 2.5, "flood-color": "#000", "flood-opacity": 0.75 }, shadowFilter);

    const clip = el("clipPath", { id: "screenClip" }, defs);
    el("circle", { cx: SCREEN.cx, cy: SCREEN.cy, r: SCREEN.r - 2 }, clip);
}

function buildHousing(svg) {
    el("path", {
        d: "M120 700 L120 360 Q120 130 400 90 Q800 30 1200 90 Q1480 130 1480 360 L1480 700 Z",
        fill: "url(#housing)", stroke: "#1c1c1f", "stroke-width": 3
    }, svg);
}

// --- Speedometer ---

function speedAngle(mph) {
    const v = Math.max(0, Math.min(SPEEDO.max, mph));
    return SPEEDO.from + v / SPEEDO.max * (SPEEDO.to - SPEEDO.from);
}

function buildSpeedo(svg) {
    const g = SPEEDO;
    bezel(svg, g, 18);
    el("circle", { cx: g.cx, cy: g.cy, r: g.r, fill: "url(#face)" }, svg);

    const dial = el("g", {}, svg);
    for (let v = 0; v <= g.max; v += 5) {
        const major = v % 25 === 0;
        tick(dial, g, speedAngle(v), 202, major ? 20 : 10, major ? 4.5 : 2.5);
        if (major) {
            const [x, y] = polar(g.cx, g.cy, 158, speedAngle(v));
            el("text", { x, y, class: "dial-number", "font-size": 30 }, dial, v);
        }
    }
    const [mx, my] = polar(g.cx, g.cy, 128, speedAngle(150) + 8);
    el("text", { x: mx, y: my, class: "unit", "font-size": 16 }, dial, "mph");

    // Odometer and trip
    lcdStrip(svg, 368, 512, 168, 72);
    gt4.odometer = readout(svg, 452, 531, 30, "mi", 15);
    gt4.trip = readout(svg, 452, 564, 30);
    gt4.trip.textContent = "0.0";

    gt4.speedNeedle = needle(svg, g, 190, 0, 4);
    hubCap(svg, g, 12);
}

// --- Tachometer ---

function rpmAngle(rpm) {
    const k = Math.max(0, Math.min(gt4.tachMax, rpm / 1000));
    return TACH.from + k / gt4.tachMax * (TACH.to - TACH.from);
}

// Dial from 0 to one step above the maximum RPM of the car
function configureTach(maxRpm) {
    let tachMax = Math.max(4, Math.ceil((maxRpm || 9000) / 1000) + 1);
    if (tachMax > 12 && tachMax % 2) tachMax++;
    const redline = maxRpm > 0 ? maxRpm / 1000 : tachMax - 1;
    if (tachMax === gt4.tachMax && redline === gt4.redline) return;
    gt4.tachMax = tachMax;
    gt4.redline = redline;

    const g = TACH;
    const dial = gt4.tachDial;
    dial.innerHTML = "";
    // Above 12 the dial shows every second number, with fewer small ticks
    const labelStep = tachMax > 12 ? 2 : 1;
    const tickStep = tachMax > 12 ? 0.5 : 0.25;

    // Blue band with fine rings
    el("path", { d: arcPath(g.cx, g.cy, 166, 230, g.from - BAND_OVERHANG, g.to + BAND_OVERHANG), fill: "url(#band)" }, dial);
    for (let r = 171; r < 230; r += 6) {
        el("path", { d: arcLine(g.cx, g.cy, r, g.from - BAND_OVERHANG, g.to + BAND_OVERHANG), fill: "none", stroke: "rgba(170, 215, 255, 0.35)", "stroke-width": 1.2 }, dial);
    }

    // Red line zone, then the yellow ticks
    el("path", { d: arcPath(g.cx, g.cy, 236, 246, rpmAngle(redline * 1000), g.to), fill: RED }, dial);
    for (let k = 0; k <= tachMax + 0.001; k += tickStep) {
        const major = Math.abs(k - Math.round(k)) < 0.001;
        const half = !major && Math.abs(k * 2 - Math.round(k * 2)) < 0.001;
        const color = k > redline + 0.001 ? RED : TICK_COLOR;
        tick(dial, g, rpmAngle(k * 1000), 256, major ? 20 : half ? 13 : 8, major ? 5 : 2.5, color);
        if (major && Math.round(k) % labelStep === 0) {
            const [x, y] = polar(g.cx, g.cy, 198, rpmAngle(k * 1000));
            const label = Math.round(k);
            el("text", { x, y, class: "dial-number band-number", "font-size": label >= 10 ? 38 : 46 }, dial, label);
        }
    }
}

function buildTach(svg) {
    const g = TACH;
    bezel(svg, g, 22);
    el("circle", { cx: g.cx, cy: g.cy, r: g.r, fill: "url(#face)" }, svg);
    gt4.tachDial = el("g", {}, svg);
    configureTach(0);

    logo(svg, g.cx, g.cy - 72, 34);

    // Gear
    el("rect", { x: g.cx - 26, y: g.cy + 50, width: 52, height: 72, rx: 7, fill: "#141416", stroke: "#2c2c30", "stroke-width": 2 }, svg);
    gt4.gear = el("text", { x: g.cx, y: g.cy + 87, class: "lcd", "font-size": 58, "text-anchor": "middle" }, svg, "N");

    gt4.selector = {};
    ["P", "R", "N", "D", "M"].forEach((letter, i) => {
        gt4.selector[letter] = el("text", { x: g.cx + 44, y: g.cy + 60 + i * 13, class: "selector", "font-size": 16 }, svg, letter);
    });
    gt4.selectorDot = el("circle", { cx: g.cx + 58, cy: g.cy + 60, r: 4, fill: RED }, svg);

    // Digital speed
    lcdStrip(svg, g.cx - 110, g.cy + 180, 220, 56);
    gt4.digitalSpeed = readout(svg, g.cx, g.cy + 208, 48, "mph", 16);
    gt4.digitalSpeed.textContent = "0";

    gt4.rpmNeedle = needle(svg, g, 240, 0, 5.5);
    hubCap(svg, g, 16);
}

// --- Screen ---

function segmentBar(parent, x, y, count, segWidth, height) {
    const segs = [];
    for (let i = 0; i < count; i++) {
        segs.push(el("rect", { x: x + i * (segWidth + 3), y, width: segWidth, height, fill: UNLIT }, parent));
    }
    return segs;
}

function fillSegments(segs, fraction, color) {
    const lit = Math.round(Math.max(0, Math.min(1, fraction)) * segs.length);
    segs.forEach((seg, i) => seg.setAttribute("fill", i < lit ? color : UNLIT));
}

// Data page while the game sends data
function buildDataPage(screen, g) {
    const page = el("g", {}, screen);

    gt4.fuelSegs = [];
    const span = 84, step = span / FUEL_SEGMENTS;
    for (let i = 0; i < FUEL_SEGMENTS; i++) {
        const a = -span / 2 + i * step;
        gt4.fuelSegs.push(el("path", { d: arcPath(g.cx, g.cy, 172, 190, a + 0.6, a + step - 0.6), fill: UNLIT }, page));
    }
    el("path", { d: arcPath(g.cx, g.cy, 166, 196, -span / 2 - 2.2, -span / 2 - 0.6), fill: RED }, page);
    el("path", {
        d: `M${g.cx - 44} 262 h14 v22 h-14 Z M${g.cx - 30} 268 l6 4 v10`,
        fill: "none", stroke: "#f2f2f2", "stroke-width": 2.5
    }, page);
    gt4.fuel = el("text", { x: g.cx - 14, y: 274, class: "lcd", "font-size": 30 }, page, "- -");

    el("rect", { x: 1010, y: 300, width: 330, height: 36, fill: "rgba(255, 255, 255, 0.92)" }, page);
    el("text", { x: 1100, y: 319, class: "screen-header", "font-size": 25 }, page, "Lap");
    gt4.lapTime = el("text", { x: 1330, y: 319, class: "screen-header", "font-size": 24, "text-anchor": "end" }, page, "");

    const row = (y, label) => el("text", { x: 1100, y, class: "screen-label", "font-size": 19 }, page, label);
    gt4.tyreRows = {};
    [["front", "Tyre F", 368], ["rear", "Tyre R", 408]].forEach(([key, label, y]) => {
        row(y, label);
        gt4.tyreRows[key] = {
            segs: segmentBar(page, 1160, y - 8, BAR_SEGMENTS, 9, 16),
            value: el("text", { x: 1352, y, class: "lcd", "font-size": 28, "text-anchor": "end" }, page, "- -")
        };
    });
    row(448, "Best");
    gt4.best = el("text", { x: 1352, y: 448, class: "lcd", "font-size": 28, "text-anchor": "end" }, page, "- -");

    el("line", { x1: 1095, y1: 480, x2: 1345, y2: 480, stroke: "rgba(255, 255, 255, 0.5)", "stroke-width": 1.5 }, page);
    gt4.clock = el("text", { x: 1240, y: 510, class: "lcd", "font-size": 32, "text-anchor": "middle" }, page, "");
    gt4.split = el("text", { x: 1240, y: 546, class: "lcd", "font-size": 28, "text-anchor": "middle" }, page, "");
    return page;
}

// Start page while the game sends no data: car silhouette, logo and clock
function buildIdlePage(screen) {
    const page = el("g", {}, screen);
    const car = el("image", { x: 1102, y: 318, width: 262, height: 56, href: SILHOUETTE_FILE, preserveAspectRatio: "xMidYMid meet" }, page);
    car.addEventListener("error", () => car.remove());
    logo(page, 1236, 418, 30);
    el("line", { x1: 1100, y1: 466, x2: 1345, y2: 466, stroke: "rgba(255, 255, 255, 0.35)", "stroke-width": 1.5 }, page);
    gt4.idleClock = el("text", { x: 1236, y: 510, class: "lcd", "font-size": 36, "text-anchor": "middle" }, page, "");
    return page;
}

function buildScreen(svg) {
    const g = SCREEN;
    bezel(svg, g, 18);
    el("circle", { cx: g.cx, cy: g.cy, r: g.r, fill: "url(#screenBg)" }, svg);
    const screen = el("g", { "clip-path": "url(#screenClip)" }, svg);
    gt4.dataPage = buildDataPage(screen, g);
    gt4.idlePage = buildIdlePage(screen);
}

function buildCluster() {
    const svg = document.getElementById("cluster");
    if (!svg) return;
    buildDefs(svg);
    buildHousing(svg);
    buildSpeedo(svg);
    buildScreen(svg);
    buildTach(svg);
    setNeedle(gt4.speedNeedle, speedAngle(0));
    setNeedle(gt4.rpmNeedle, rpmAngle(0));
    updateScreen();
    setInterval(updateScreen, 500);
}

// Clock, and the start page while the game sends no data, is paused or is in a menu
const IDLE_AFTER_MS = 1000;
let lastRacingAt = 0;
function updateScreen() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const text = `${hours}:${minutes} ${now.getHours() < 12 ? "AM" : "PM"}`;
    gt4.clock.textContent = text;
    gt4.idleClock.textContent = text;

    // animate.js defines animateRPM only when the server runs with ANIMATE
    const animating = typeof animateRPM === "function";
    const racing = animating || (typeof telemetry !== "undefined" && telemetry != null && telemetry["IsRaceOn"] == 1);
    if (racing) lastRacingAt = Date.now();
    const idle = Date.now() - lastRacingAt > IDLE_AFTER_MS;
    gt4.dataPage.style.display = idle ? "none" : "";
    gt4.idlePage.style.display = idle ? "" : "none";
}

// --- Telemetry updates ---

function updateSpeed(speed) {
    if (!gt4.speedNeedle) return;
    const mph = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    setNeedle(gt4.speedNeedle, speedAngle(mph));
    gt4.digitalSpeed.textContent = Math.round(mph);
}

function updateRpm(rpm, maxRPM, gear = -99) {
    if (!gt4.rpmNeedle || rpm == null || maxRPM == null) return;
    configureTach(maxRPM);
    setNeedle(gt4.rpmNeedle, rpmAngle(rpm));

    initShiftLightRPM(maxRPM);
    configureShiftLight(rpm, maxRPM, gear);
    updateShiftLight(rpm);
    if (gear == -99) resetShiftLightRPM();
}

function updateGear(gear, gearMax = null, gearNeutral = null, gearReverse = null) {
    if (!gt4.gear || gear == null) return;
    let letter = "M";
    if (gearNeutral != null && gear == gearNeutral) {
        letter = "N";
    } else if ((gearReverse != null && gear == gearReverse) || gear == 0) {
        letter = "R";
    } else if (!(gear > 0 && gear < 11) && !(gearMax != null && gear <= gearMax)) {
        letter = "N";
    }

    gt4.gear.textContent = letter === "M" ? String(gear) : letter;
    Object.entries(gt4.selector).forEach(([key, node]) => node.classList.toggle("active", key === letter));
    gt4.selectorDot.setAttribute("cy", gt4.selector[letter].getAttribute("y"));
}

function updateFuel(percentage) {
    if (!gt4.fuelSegs) return;
    if (!Number.isFinite(percentage)) {
        fillSegments(gt4.fuelSegs, 0, "#f2f2f2");
        gt4.fuel.textContent = "- -";
        return;
    }
    fillSegments(gt4.fuelSegs, percentage / 100, percentage < 15 ? RED : "#f2f2f2");
    gt4.fuel.textContent = `${Math.round(percentage)} %`;
}

function updateDistance(meters) {
    if (!gt4.odometer) return;
    if (!Number.isFinite(meters) || meters <= 0) {
        gt4.odometer.textContent = "- -";
        gt4.trip.textContent = "0.0";
        return;
    }
    if (gt4.odometerStart === null || meters < gt4.odometerStart) gt4.odometerStart = meters;
    gt4.odometer.textContent = metersToMiles(meters);
    gt4.trip.textContent = metersToMiles(meters - gt4.odometerStart, 1);
}

function updateTime(id, time, minutes = true) {
    if (!gt4.lapTime) return;
    if (id === "time") {
        gt4.lapTime.textContent = time ? formatTime(time) : "";
    } else if (id === "best-time") {
        gt4.best.textContent = time ? formatTime(time) : "- -";
    }
}

// Gap to the best lap in seconds, green when ahead
function updateSplit(split) {
    if (!gt4.split) return;
    if (split == null || !Number.isFinite(split) || split >= invalidSplit) {
        gt4.split.textContent = "";
        return;
    }
    const gap = Math.abs(split);
    const text = gap >= 60 ? formatTime(gap) : gap.toFixed(2);
    gt4.split.textContent = (split <= 0 ? "-" : "+") + text;
    gt4.split.style.fill = split <= 0 ? "#2ad460" : "#ff4436";
}

// Tyre rows show the average of the left and right tyre
function updateTireTemp(tire, temp) {
    if (!gt4.tyreRows) return;
    gt4.tyres[tire] = temp != null && Number.isFinite(Number(temp)) ? Number(temp) : null;
    [["front", "FL", "FR"], ["rear", "RL", "RR"]].forEach(([key, left, right]) => {
        const values = [gt4.tyres[left], gt4.tyres[right]].filter(v => v != null);
        const row = gt4.tyreRows[key];
        if (values.length === 0) {
            fillSegments(row.segs, 0, "#f2f2f2");
            row.value.textContent = "- -";
            return;
        }
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const color = avg > hotTemperature ? RED : avg < coldTemperature ? "#3d8bff" : "#f2f2f2";
        fillSegments(row.segs, (avg - TYRE_BAR_MIN) / (TYRE_BAR_MAX - TYRE_BAR_MIN), color);
        row.value.textContent = `${Math.round(avg)}°F`;
    });
}

buildCluster();
