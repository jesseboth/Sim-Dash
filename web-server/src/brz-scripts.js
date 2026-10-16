config = {};
config["seperateTime"] = true;
config["dash"] = "brz";

// Subaru BRZ track mode cluster: lap times left, bar tachometer centre, gauges right.
// The update functions replace the ones in dash-scripts.js.

const SVG_NS = "http://www.w3.org/2000/svg";
const PANEL = "#0c0d0e";
const FRAME = "#8e93a3";
const ORANGE = "#f2a10f";
const RED = "#e3261c";
const CIRCLE = { cx: 790, cy: 460, r: 262 };
const BAND = { x: 150, y: 300, width: 1300, height: 310 };
const TACH = { x0: 540, x1: 1010, base: 560, h0: 80, h1: 170, bars: 64 };
const GAUGE_SEGMENTS = 12;
const UNLIT = "rgba(255, 255, 255, 0.12)";

const brz = {
    tachMax: 0,
    maxRpm: 0,
    tyres: {},
    wear: {},
    lastLapNumber: null,
    bestLapNumber: null,
    bestLapTime: null
};

function el(tag, attrs, parent, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
}

function pad(n) {
    return String(n).padStart(2, "0");
}

// Lap time as mm'ss"cc
function lapFormat(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "--'--\"--";
    const cs = Math.floor(seconds * 100);
    return `${pad(Math.floor(cs / 6000))}'${pad(Math.floor(cs / 100) % 60)}"${pad(cs % 100)}`;
}

function buildDefs(svg) {
    const defs = el("defs", {}, svg);
    const odo = el("linearGradient", { id: "odoStrip", x1: "0", y1: "0", x2: "1", y2: "0" }, defs);
    el("stop", { offset: "0%", "stop-color": "#1a1b1d" }, odo);
    el("stop", { offset: "100%", "stop-color": "#0f1011" }, odo);
    const circle = el("radialGradient", { id: "circleFill", cx: "50%", cy: "50%", r: "50%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#1a1b1e" }, circle);
    el("stop", { offset: "100%", "stop-color": PANEL }, circle);
}

// Band across the cluster with a circle in the middle, and the ODO strip under it
function buildFrame(svg) {
    const c = CIRCLE, b = BAND;
    // ODO strip ends behind the circle
    el("rect", { x: 170, y: 642, width: c.cx - 170, height: 70, fill: "url(#odoStrip)" }, svg);
    el("circle", { cx: c.cx, cy: c.cy, r: c.r, fill: "url(#circleFill)", stroke: FRAME, "stroke-width": 5 }, svg);
    el("rect", { x: b.x, y: b.y, width: b.width, height: b.height, fill: PANEL }, svg);

    // Circle fill again over the band, so the circle shows through
    el("circle", { cx: c.cx, cy: c.cy, r: c.r - 3, fill: "url(#circleFill)" }, svg);

    // Silver edges of the band, broken by the circle
    [b.y, b.y + b.height].forEach(y => {
        const dx = Math.sqrt(c.r * c.r - (y - c.cy) * (y - c.cy));
        el("line", { x1: b.x, y1: y, x2: c.cx - dx, y2: y, stroke: FRAME, "stroke-width": 4 }, svg);
        el("line", { x1: c.cx + dx, y1: y, x2: b.x + b.width, y2: y, stroke: FRAME, "stroke-width": 4 }, svg);
    });

    // Right panel
    el("rect", { x: 1100, y: 318, width: 320, height: 274, fill: "#05060a", stroke: "#3c4256", "stroke-width": 2 }, svg);
}

// --- Tachometer ---

// Dial from 0 to one step above the maximum RPM. The low range is short, as on the car.
function configureTach(maxRpm) {
    let tachMax = Math.max(4, Math.ceil((maxRpm || 7500) / 1000) + 1);
    if (tachMax > 10 && tachMax % 2) tachMax++;
    const limit = maxRpm > 0 ? maxRpm : (tachMax - 1) * 1000;
    if (tachMax === brz.tachMax && limit === brz.maxRpm) return;
    brz.tachMax = tachMax;
    brz.maxRpm = limit;
    brz.knee = Math.max(1, Math.floor(tachMax * 0.45)) * 1000;   // end of the short range
    brz.orangeFrom = limit - 600;

    const t = TACH;
    const dial = brz.tachDial;
    dial.innerHTML = "";
    brz.bars = [];
    const step = (t.x1 - t.x0) / t.bars;
    for (let i = 0; i < t.bars; i++) {
        const x = t.x0 + i * step;
        const rpm = rpmAt((i + 0.5) / t.bars);
        const top = rampTop(x);
        brz.bars.push({ rpm, node: el("rect", { x, y: top + 6, width: step - 2.2, height: t.base - top - 6 }, dial) });
    }

    // Edge lines above and below the bars, coloured by zone. The top edge has a gap at each 1000 RPM.
    const zones = [[0, brz.orangeFrom, "#ffffff"], [brz.orangeFrom, limit, ORANGE], [limit, tachMax * 1000, RED]];
    const zoneColor = rpm => zones.find(([from, to]) => rpm >= from && rpm < to)?.[2] || RED;
    const gap = 3;
    const cuts = new Set([brz.orangeFrom, limit]);
    for (let k = 0; k <= tachMax; k++) cuts.add(k * 1000);
    const points = [...cuts].filter(r => r >= 0 && r <= tachMax * 1000).sort((a, b) => a - b);
    for (let i = 1; i < points.length; i++) {
        const from = points[i - 1], to = points[i];
        let xa = xAt(from), xb = xAt(to);
        if (from % 1000 === 0 && from > 0) xa += gap / 2;
        if (to % 1000 === 0 && to < tachMax * 1000) xb -= gap / 2;
        if (xb <= xa) continue;
        el("line", { x1: xa, y1: rampTop(xa), x2: xb, y2: rampTop(xb), stroke: zoneColor(from), "stroke-width": 5 }, dial);
    }
    zones.forEach(([from, to, color]) => {
        el("line", { x1: xAt(from), y1: t.base + 4, x2: xAt(to), y2: t.base + 4, stroke: color, "stroke-width": 4 }, dial);
    });

    // Numbers: every second one in the short range and above 10 numbers. A number too close
    // to the one before it is left out; the last number always shows.
    const labelStep = tachMax > 10 ? 2 : 1;
    const labels = [];
    const size = short => short ? 38 : 48;
    const width = l => String(l.k).length * size(l.short) * 0.56;
    const tooClose = (a, b) => b.x - a.x < (width(a) + width(b)) / 2 + 6;
    for (let k = 0; k <= tachMax; k++) {
        const short = k * 1000 < brz.knee;
        if (k !== tachMax && ((short && k % 2) || (!short && k % labelStep))) continue;
        const label = { k, x: xAt(k * 1000), short };
        if (k === tachMax) {
            while (labels.length && tooClose(labels[labels.length - 1], label)) labels.pop();
        } else if (labels.length && tooClose(labels[labels.length - 1], label)) {
            continue;
        }
        labels.push(label);
    }
    labels.forEach(l => {
        el("text", { x: l.x, y: rampTop(l.x) - 30, class: "tach-number", "font-size": size(l.short) }, dial, l.k);
    });
    el("text", { x: t.x0, y: t.base + 24, class: "small", "font-size": 17 }, dial, "x1000RPM");
    paintBars(brz.rpm || 0);
}

// Scale points as [rpm, position 0 to 1]. As on the car, the range up to the knee and the
// last 1000 RPM are short, and the range between them is linear.
function scalePoints() {
    const end = brz.tachMax * 1000;
    return [[0, 0], [brz.knee, 0.14], [end - 1000, 0.92], [end, 1]];
}

// Position along the tachometer (0 to 1) for an RPM
function fractionAt(rpm) {
    const pts = scalePoints();
    const r = Math.max(0, Math.min(pts[pts.length - 1][0], rpm));
    for (let i = 1; i < pts.length; i++) {
        const [r0, f0] = pts[i - 1], [r1, f1] = pts[i];
        if (r <= r1) return f0 + (f1 - f0) * (r - r0) / (r1 - r0);
    }
    return 1;
}

function rpmAt(fraction) {
    const pts = scalePoints();
    for (let i = 1; i < pts.length; i++) {
        const [r0, f0] = pts[i - 1], [r1, f1] = pts[i];
        if (fraction <= f1) return r0 + (r1 - r0) * (fraction - f0) / (f1 - f0);
    }
    return pts[pts.length - 1][0];
}

function xAt(rpm) {
    return TACH.x0 + fractionAt(rpm) * (TACH.x1 - TACH.x0);
}

function rampTop(x) {
    const t = TACH;
    const f = (x - t.x0) / (t.x1 - t.x0);
    return t.base - (t.h0 + (t.h1 - t.h0) * f);
}

function paintBars(rpm) {
    brz.bars.forEach(bar => {
        const lit = bar.rpm <= rpm;
        let color;
        if (bar.rpm >= brz.maxRpm) color = lit ? "#ff3326" : "#8f2219";
        else if (bar.rpm >= brz.orangeFrom) color = lit ? "#ffb21f" : "#a8721c";
        else color = lit ? "#ffffff" : "#6e717a";
        bar.node.setAttribute("fill", color);
    });
}

function buildTach(svg) {
    brz.tachDial = el("g", {}, svg);
    configureTach(0);

    // STI logo above the start of the tachometer, when img/sti-logo.png exists
    const logo = el("image", { x: 556, y: 360, width: 110, height: 44, href: "img/sti-logo.png", preserveAspectRatio: "xMinYMid meet" }, svg);
    logo.addEventListener("error", () => logo.remove());

    brz.gear = el("text", { x: CIRCLE.cx, y: 296, class: "value", "font-size": 104, "text-anchor": "middle" }, svg, "N");

    brz.speed = el("text", { x: 838, y: 646, class: "value", "font-size": 92, "text-anchor": "end" }, svg, "0");
    el("text", { x: 856, y: 660, class: "label", "font-size": 30 }, svg, "MPH");
}

// --- Left panel ---

function underline(svg, x1, x2, y) {
    el("line", { x1, y1: y, x2, y2: y, stroke: "#ffffff", "stroke-width": 3 }, svg);
}

function buildLeft(svg) {
    brz.tyreValues = {};
    [["front", "TYRE F", 196], ["rear", "TYRE R", 352]].forEach(([key, label, x]) => {
        el("text", { x, y: 338, class: "small", "font-size": 18 }, svg, label);
        brz.tyreValues[key] = el("text", { x, y: 380, class: "value", "font-size": 50 }, svg, "---°F");
        underline(svg, x, x + 136, 412);
    });

    el("text", { x: 196, y: 446, class: "label", "font-size": 22 }, svg, "Best Lap");
    brz.bestLapNo = el("text", { x: 196, y: 478, class: "value", "font-size": 28 }, svg, "Lap--");
    brz.best = el("text", { x: 508, y: 478, class: "value", "font-size": 30, "text-anchor": "end" }, svg, lapFormat(0));
    underline(svg, 196, 508, 500);

    el("text", { x: 196, y: 532, class: "label", "font-size": 22 }, svg, "Current Lap");
    brz.delta = el("text", { x: 508, y: 532, class: "value", "font-size": 24, "text-anchor": "end" }, svg, "");
    brz.lapNo = el("text", { x: 196, y: 564, class: "value", "font-size": 28 }, svg, "Lap--");
    brz.lapTime = el("text", { x: 508, y: 564, class: "value", "font-size": 30, "text-anchor": "end" }, svg, lapFormat(0));
    underline(svg, 196, 508, 586);

    el("text", { x: 250, y: 677, class: "label", "font-size": 28 }, svg, "ODO");
    brz.odometer = el("text", { x: 430, y: 677, class: "value", "font-size": 40, "text-anchor": "end" }, svg, "- -");
    el("text", { x: 436, y: 684, class: "label", "font-size": 22 }, svg, "miles");
}

// --- Right panel ---

function gaugeFrame(svg, y, left, right, label) {
    el("text", { x: 1124, y: y + 30, class: "label", "font-size": 30, "text-anchor": "middle" }, svg, left);
    el("text", { x: 1396, y: y + 30, class: "label", "font-size": 30, "text-anchor": "middle" }, svg, right);
    el("path", { d: `M1144 ${y} V${y + 56} H1376 V${y}`, fill: "none", stroke: "#ffffff", "stroke-width": 4 }, svg);
    el("text", { x: 1260, y: y + 72, class: "small", "font-size": 15, "text-anchor": "middle" }, svg, label);
}

function segments(svg, y) {
    const segs = [];
    for (let i = 0; i < GAUGE_SEGMENTS; i++) {
        segs.push(el("rect", { x: 1152 + i * 18.6, y, width: 14, height: 44, fill: UNLIT }, svg));
    }
    return segs;
}

// Fills a segment gauge from the left. fraction null: no data.
function fillGauge(segs, fraction) {
    const lit = fraction == null ? 0 : Math.round(Math.max(0, Math.min(1, fraction)) * segs.length);
    const color = fraction != null && fraction < 0.15 ? RED : "#ffffff";
    segs.forEach((seg, i) => seg.setAttribute("fill", i < lit ? color : UNLIT));
}

function buildRight(svg) {
    el("text", { x: 1124, y: 340, class: "small", "font-size": 22 }, svg, "LAP");
    brz.lapCount = el("text", { x: 1124, y: 374, class: "value", "font-size": 38 }, svg, "--");
    brz.ampm = el("text", { x: 1400, y: 340, class: "small", "font-size": 22, "text-anchor": "end" }, svg, "");
    brz.clock = el("text", { x: 1400, y: 374, class: "value", "font-size": 38, "text-anchor": "end" }, svg, "");

    // Traction light under the panel; updateTraction in dash-scripts.js blinks it
    const traction = el("image", { id: "traction", x: 1240, y: 648, width: 42, height: 40, href: "img/traction.png" }, svg);
    traction.style.display = "none";

    gaugeFrame(svg, 410, "W", "N", "TYRE WEAR");
    brz.wearSegs = segments(svg, 416);

    gaugeFrame(svg, 500, "E", "F", "FUEL");
    brz.fuelSegs = segments(svg, 506);
}

function buildCluster() {
    const svg = document.getElementById("cluster");
    if (!svg) return;
    buildDefs(svg);
    buildFrame(svg);
    buildLeft(svg);
    buildRight(svg);
    buildTach(svg);
    updateScreen();
    setInterval(updateScreen, 250);
}

// Clock and lap numbers
function updateScreen() {
    const now = new Date();
    brz.ampm.textContent = now.getHours() < 12 ? "AM" : "PM";
    brz.clock.textContent = `${now.getHours() % 12 || 12}:${pad(now.getMinutes())}`;

    const data = typeof telemetry !== "undefined" ? telemetry : null;
    const lap = data && Number.isFinite(data["LapNumber"]) ? data["LapNumber"] : null;
    if (lap === null) return;

    // A finished lap faster than the best one so far is the best lap
    if (brz.lastLapNumber !== null && lap > brz.lastLapNumber) {
        const last = data["LastLap"];
        if (last > 0 && (brz.bestLapTime === null || last <= brz.bestLapTime)) {
            brz.bestLapTime = last;
            brz.bestLapNumber = brz.lastLapNumber + 1;
        }
    } else if (brz.lastLapNumber !== null && lap < brz.lastLapNumber) {
        brz.bestLapTime = null;
        brz.bestLapNumber = null;
    }
    brz.lastLapNumber = lap;

    brz.lapNo.textContent = `Lap${pad(lap + 1)}`;
    brz.lapCount.textContent = pad(lap + 1);
    brz.bestLapNo.textContent = brz.bestLapNumber ? `Lap${pad(brz.bestLapNumber)}` : "Lap--";
}

// --- Telemetry updates ---

function updateSpeed(speed) {
    if (!brz.speed) return;
    brz.speed.textContent = Math.round(Number.isFinite(speed) ? Math.max(0, speed) : 0);
}

function updateRpm(rpm, maxRPM, gear = -99) {
    if (!brz.bars || rpm == null || maxRPM == null) return;
    configureTach(maxRPM);
    brz.rpm = rpm;
    paintBars(rpm);

    initShiftLightRPM(maxRPM);
    configureShiftLight(rpm, maxRPM, gear);
    updateShiftLight(rpm);
    if (gear == -99) resetShiftLightRPM();
}

function updateGear(gear, gearMax = null, gearNeutral = null, gearReverse = null) {
    if (!brz.gear || gear == null) return;
    let text = String(gear);
    if (gearNeutral != null && gear == gearNeutral) text = "N";
    else if ((gearReverse != null && gear == gearReverse) || gear == 0) text = "R";
    else if (!(gear > 0 && gear < 11) && !(gearMax != null && gear <= gearMax)) text = "N";
    brz.gear.textContent = text;
}

function updateFuel(percentage) {
    if (!brz.fuelSegs) return;
    fillGauge(brz.fuelSegs, Number.isFinite(percentage) ? percentage / 100 : null);
}

// Tyre life left in percent, for one tyre. The gauge shows the average of the four.
function updateTireWear(tire, percentage) {
    if (!brz.wearSegs) return;
    brz.wear[tire] = percentage != null && Number.isFinite(Number(percentage)) ? Number(percentage) : null;
    const values = ["FL", "FR", "RL", "RR"].map(n => brz.wear[n]).filter(v => v != null);
    fillGauge(brz.wearSegs, values.length ? values.reduce((a, b) => a + b, 0) / values.length / 100 : null);
}

function updateDistance(meters) {
    if (!brz.odometer) return;
    brz.odometer.textContent = Number.isFinite(meters) && meters > 0 ? metersToMiles(meters) : "- -";
}

function updateTime(id, time, minutes = true) {
    if (!brz.lapTime) return;
    if (id === "time") brz.lapTime.textContent = lapFormat(time);
    else if (id === "best-time") brz.best.textContent = lapFormat(time);
}

// Gap to the best lap in seconds, green when ahead
function updateSplit(split) {
    if (!brz.delta) return;
    if (split == null || !Number.isFinite(split) || split >= invalidSplit) {
        brz.delta.textContent = "";
        return;
    }
    const gap = Math.abs(split);
    brz.delta.textContent = (split <= 0 ? "-" : "+") + (gap >= 60 ? lapFormat(gap) : gap.toFixed(2));
    brz.delta.style.fill = split <= 0 ? "#2ad460" : "#ff4436";
}

// Average tyre temperature of each axle
function updateTireTemp(tire, temp) {
    if (!brz.tyreValues) return;
    brz.tyres[tire] = temp != null && Number.isFinite(Number(temp)) ? Number(temp) : null;
    const average = names => {
        const values = names.map(n => brz.tyres[n]).filter(v => v != null);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    const front = average(["FL", "FR"]);
    const rear = average(["RL", "RR"]);
    brz.tyreValues.front.textContent = front === null ? "---°F" : `${Math.round(front)}°F`;
    brz.tyreValues.rear.textContent = rear === null ? "---°F" : `${Math.round(rear)}°F`;

}

buildCluster();
