config = {};
config["seperateTime"] = true;
config["dash"] = "sti";

// 2005 Subaru Impreza WRX STI (GD) cluster: fuel, temperature and DCCD left, tachometer
// centre, speedometer right, all lit red. The scales are in the #cluster SVG; needles and
// LCDs are in the #live SVG above it, so the scales do not repaint when a needle moves.
// The update functions replace the ones in dash-scripts.js.

const SVG_NS = "http://www.w3.org/2000/svg";
const TICK = "#ff2a1a";
const NUMBER = "#ff5a2c";
const LCD_ON = "#ff3b22";
const LCD_OFF = "rgba(255, 50, 30, 0.08)";
const LAMP_OFF = "rgba(255, 255, 255, 0.03)";

const TACH = { cx: 800, cy: 330, r: 240, start: -129, sweep: 258 };
const LEFT = { cx: 345, cy: 440, r: 205 };
const SPEEDO = { cx: 1255, cy: 440, r: 205, start: -120, sweep: 240 };
const FUEL = { cx: LEFT.cx - 62, cy: LEFT.cy + 5, r: 100, from: -150, to: -30 };
const TEMP = { cx: LEFT.cx + 62, cy: LEFT.cy + 5, r: 100, from: 150, to: 30 };
const TEMP_COLD = 100;   // Tyre temperature in °F at C
const TEMP_HOT = 300;    // Tyre temperature in °F at H
const DCCD_CELLS = 5;
const SPEED_MAX = 160;   // MPH

const sti = {
    tachMax: 0,
    maxRpm: 0,
    tyres: {}
};

function el(tag, attrs, parent, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Point at a distance from a centre, at an angle in degrees clockwise from 12 o'clock
function polar(cx, cy, r, angle) {
    const a = angle * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function arcPath(cx, cy, r, a0, a1) {
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function tick(parent, cx, cy, r, length, angle, width, color = TICK) {
    const [x0, y0] = polar(cx, cy, r, angle);
    const [x1, y1] = polar(cx, cy, r - length, angle);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: color, "stroke-width": width }, parent);
}

// --- Seven-segment LCD ---

const SEGMENTS = {
    "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg",
    "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", "N": "abcef", "r": "eg", " ": ""
};

// Digit cell of height h with its top left corner at x, y
function digitCell(parent, x, y, h) {
    const w = h * 0.52, t = h * 0.13, g = t * 0.18;
    const x0 = t / 2, x1 = w - t / 2, y0 = t / 2, ym = h / 2, y1 = h - t / 2;
    const hseg = (a, b, yy) => `${a},${yy} ${a + t / 2},${yy - t / 2} ${b - t / 2},${yy - t / 2} ${b},${yy} ${b - t / 2},${yy + t / 2} ${a + t / 2},${yy + t / 2}`;
    const vseg = (xx, a, b) => `${xx},${a} ${xx + t / 2},${a + t / 2} ${xx + t / 2},${b - t / 2} ${xx},${b} ${xx - t / 2},${b - t / 2} ${xx - t / 2},${a + t / 2}`;
    const shapes = {
        a: hseg(x0 + g, x1 - g, y0), b: vseg(x1, y0 + g, ym - g), c: vseg(x1, ym + g, y1 - g),
        d: hseg(x0 + g, x1 - g, y1), e: vseg(x0, ym + g, y1 - g), f: vseg(x0, y0 + g, ym - g),
        g: hseg(x0 + g, x1 - g, ym)
    };
    const group = el("g", { transform: `translate(${x} ${y}) skewX(-6)` }, parent);
    const segs = {};
    for (const name in shapes) segs[name] = el("polygon", { points: shapes[name], fill: LCD_OFF }, group);
    return { type: "8", width: w, segs };
}

function separatorCell(parent, x, y, h, type) {
    const s = h * 0.13;
    const dots = type === ":" ? [h * 0.3, h * 0.7] : [h - s / 2];
    const parts = dots.map(cy => el("rect", { x: x + s * 0.3, y: y + cy - s / 2, width: s, height: s, fill: LCD_OFF }, parent));
    return { type, width: s * 1.6, parts };
}

// Width of an LCD row of height h
function lcdWidth(h, template) {
    let width = 0;
    for (const ch of template) width += (ch === "8" ? h * 0.52 : h * 0.13 * 1.6) + h * 0.1;
    return width - h * 0.1;
}

// LCD row from a template such as "88:88.88". Text is right aligned to the template.
function lcd(parent, x, y, h, template, color = LCD_ON) {
    const cells = [];
    let cx = x;
    for (const ch of template) {
        const cell = ch === "8" ? digitCell(parent, cx, y, h) : separatorCell(parent, cx, y, h, ch);
        cells.push(cell);
        cx += cell.width + h * 0.1;
    }
    const display = { cells, color, text: null };
    display.set = text => setLcd(display, text);
    display.width = cx - x - h * 0.1;
    return display;
}

function setLcd(display, text) {
    text = String(text);
    if (text === display.text) return;
    display.text = text;
    let i = text.length - 1;
    for (let c = display.cells.length - 1; c >= 0; c--) {
        const cell = display.cells[c];
        if (cell.type === "8") {
            const ch = i >= 0 ? text[i--] : " ";
            const lit = SEGMENTS[ch] ?? "";
            for (const name in cell.segs) cell.segs[name].setAttribute("fill", lit.includes(name) ? display.color : LCD_OFF);
        } else {
            const lit = i >= 0 && text[i] === cell.type;
            if (lit) i--;
            cell.parts.forEach(p => p.setAttribute("fill", lit ? display.color : LCD_OFF));
        }
    }
}

function setLcdColor(display, color) {
    if (display.color === color) return;
    display.color = color;
    const text = display.text;
    display.text = null;
    setLcd(display, text ?? "");
}

function lcdWindow(parent, x, y, width, height) {
    el("rect", { x, y, width, height, rx: 6, fill: "url(#lcdFill)", stroke: "#2c2c2e", "stroke-width": 2 }, parent);
}

// --- Static parts ---

function buildDefs(svg) {
    const defs = el("defs", {}, svg);

    const body = el("linearGradient", { id: "body", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#1b1c1f" }, body);
    el("stop", { offset: "45%", "stop-color": "#0b0b0d" }, body);
    el("stop", { offset: "100%", "stop-color": "#040405" }, body);

    const ring = el("linearGradient", { id: "ring", x1: "0.2", y1: "0", x2: "0.8", y2: "1" }, defs);
    [["0%", "#f4f4f5"], ["30%", "#b4b5b9"], ["52%", "#6f7075"], ["72%", "#c6c7cb"], ["100%", "#88898e"]]
        .forEach(([offset, color]) => el("stop", { offset, "stop-color": color }, ring));

    const face = el("radialGradient", { id: "face", cx: "50%", cy: "45%", r: "55%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#141416" }, face);
    el("stop", { offset: "100%", "stop-color": "#060607" }, face);

    const lcdFill = el("linearGradient", { id: "lcdFill", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#1c0705" }, lcdFill);
    el("stop", { offset: "100%", "stop-color": "#0c0303" }, lcdFill);

    const glow = el("filter", { id: "glow", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
    el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "3", result: "blur" }, glow);
    const merge = el("feMerge", {}, glow);
    el("feMergeNode", { in: "blur" }, merge);
    el("feMergeNode", { in: "SourceGraphic" }, merge);

    // Lit STI badge: the logo shape in pink
    const badge = el("filter", { id: "badge", x: "-10%", y: "-10%", width: "120%", height: "120%" }, defs);
    el("feFlood", { "flood-color": "#ff3c8c" }, badge);
    el("feComposite", { in2: "SourceAlpha", operator: "in", result: "tint" }, badge);
    el("feGaussianBlur", { in: "tint", stdDeviation: "2", result: "blur" }, badge);
    const badgeMerge = el("feMerge", {}, badge);
    el("feMergeNode", { in: "blur" }, badgeMerge);
    el("feMergeNode", { in: "tint" }, badgeMerge);

    const dots = el("pattern", { id: "redDots", width: 7, height: 7, patternUnits: "userSpaceOnUse" }, defs);
    el("circle", { cx: 3.5, cy: 3.5, r: 1.9, fill: TICK }, dots);

    const hub = el("radialGradient", { id: "hub", cx: "38%", cy: "32%", r: "70%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#3a3a3d" }, hub);
    el("stop", { offset: "55%", "stop-color": "#121213" }, hub);
    el("stop", { offset: "100%", "stop-color": "#020202" }, hub);

    const needleFill = el("linearGradient", { id: "needleFill", x1: "0", y1: "1", x2: "0", y2: "0" }, defs);
    el("stop", { offset: "0%", "stop-color": "#c8180c" }, needleFill);
    el("stop", { offset: "100%", "stop-color": "#ff5a36" }, needleFill);
}

function buildBody(svg) {
    const outline = "M60 670 L60 330 C60 232 140 192 262 182 C420 172 520 52 800 46 " +
        "C1080 52 1180 172 1338 182 C1460 192 1540 232 1540 330 L1540 670 Q1540 710 1500 710 L100 710 Q60 710 60 670 Z";
    el("path", { d: outline, fill: "url(#body)", stroke: "#2b2c30", "stroke-width": 3 }, svg);
}

function gaugeFace(svg, g, ringWidth) {
    el("circle", { cx: g.cx, cy: g.cy, r: g.r + ringWidth / 2 + 4, fill: "#030303" }, svg);
    el("circle", { cx: g.cx, cy: g.cy, r: g.r, fill: "url(#face)", stroke: "url(#ring)", "stroke-width": ringWidth }, svg);
    el("circle", { cx: g.cx, cy: g.cy, r: g.r - ringWidth / 2, fill: "none", stroke: "#1a1a1b", "stroke-width": 2 }, svg);
}

// --- Tachometer ---

function tachAngle(rpm) {
    return TACH.start + TACH.sweep * clamp(rpm / (sti.tachMax * 1000), 0, 1);
}

// Dial from 0 to one step above the maximum RPM, with a dotted red zone at the top
function configureTach(maxRpm) {
    const tachMax = Math.max(4, Math.ceil((maxRpm || 8000) / 1000) + 1);
    const limit = maxRpm > 0 ? maxRpm : (tachMax - 1) * 1000;
    if (tachMax === sti.tachMax && limit === sti.maxRpm) return;
    sti.tachMax = tachMax;
    sti.maxRpm = limit;

    const t = TACH;
    const dial = sti.tachDial;
    dial.innerHTML = "";
    const g = el("g", { filter: "url(#glow)" }, dial);

    // Red zone: a solid outer edge with dots inside it
    const redStart = Math.round(limit * 0.9 / 250) * 250;
    const a0 = tachAngle(redStart), a1 = tachAngle(tachMax * 1000);
    const [ox0, oy0] = polar(t.cx, t.cy, 224, a0), [ix1, iy1] = polar(t.cx, t.cy, 194, a1);
    const zone = arcPath(t.cx, t.cy, 224, a0, a1) + ` L${ix1} ${iy1} ` +
        arcPath(t.cx, t.cy, 194, a1, a0).replace(/^M[^A]+/, "") + ` L${ox0} ${oy0} Z`;
    el("path", { d: zone, fill: "url(#redDots)" }, g);
    el("path", { d: arcPath(t.cx, t.cy, 221, a0, a1), fill: "none", stroke: TICK, "stroke-width": 6 }, g);

    // Ticks every 250 RPM below 10 numbers, else every 500
    const step = tachMax > 10 ? 500 : 250;
    for (let rpm = 0; rpm <= tachMax * 1000; rpm += step) {
        const major = rpm % 1000 === 0, half = rpm % 500 === 0;
        tick(g, t.cx, t.cy, 226, major ? 38 : half ? 28 : 16, tachAngle(rpm), major ? 7 : half ? 5 : 3.5);
    }

    const labelStep = tachMax > 10 ? 2 : 1;
    for (let k = 0; k <= tachMax; k += labelStep) {
        const [x, y] = polar(t.cx, t.cy, 154, tachAngle(k * 1000));
        el("text", { x, y, class: "number", "font-size": 50 }, g, k);
    }
}

function buildTach(svg) {
    const t = TACH;
    gaugeFace(svg, t, 24);
    sti.tachDial = el("g", {}, svg);
    configureTach(0);

    el("text", { x: t.cx, y: t.cy - 96, class: "number", "font-size": 24, filter: "url(#glow)" }, svg, "x1000r/min");

    const logo = el("image", {
        x: t.cx - 55, y: t.cy + 98, width: 110, height: 43, href: "img/sti-logo.png",
        filter: "url(#badge)", preserveAspectRatio: "xMidYMid meet"
    }, svg);
    logo.addEventListener("error", () => logo.remove());
}

// --- Speedometer: MPH outside, km/h inside. The needle stops at the top of the scale. ---

function speedAngle(mph) {
    return SPEEDO.start + SPEEDO.sweep * clamp(mph / SPEED_MAX, 0, 1);
}

function buildSpeedScale(svg) {
    const s = SPEEDO;
    const g = el("g", { filter: "url(#glow)" }, svg);

    for (let mph = 0; mph <= SPEED_MAX; mph += 5) {
        const major = mph % 20 === 0, mid = mph % 10 === 0;
        tick(g, s.cx, s.cy, 193, major ? 32 : mid ? 22 : 12, speedAngle(mph), major ? 6 : mid ? 4.5 : 3);
    }
    for (let mph = 0; mph <= SPEED_MAX; mph += 20) {
        const [x, y] = polar(s.cx, s.cy, 130, speedAngle(mph));
        el("text", { x, y, class: "number", "font-size": mph >= 100 ? 35 : 38 }, g, mph);
    }

    // km/h scale on the inner ring, without a number at 0
    const kmhMax = SPEED_MAX * 1.609344;
    for (let kmh = 10; kmh <= kmhMax; kmh += 10) {
        const angle = speedAngle(kmh / 1.609344);
        tick(g, s.cx, s.cy, 100, kmh % 20 === 0 ? 10 : 5, angle, 2.5);
        if (kmh % 20 === 0) {
            const [x, y] = polar(s.cx, s.cy, 79, angle);
            el("text", { x, y, class: "number", "font-size": 14 }, g, kmh);
        }
    }
    el("text", { x: s.cx, y: s.cy - 48, class: "number", "font-size": 16 }, g, "km/h");
}

function buildSpeedo(svg) {
    const s = SPEEDO;
    gaugeFace(svg, s, 20);
    buildSpeedScale(svg);
    el("text", { x: s.cx + 124, y: s.cy + 120, class: "number", "font-size": 20, filter: "url(#glow)" }, svg, "MPH");
    lcdWindow(svg, s.cx - 80, s.cy + 92, 160, 76);
}

// --- Left gauge: fuel, DCCD and tyre temperature ---

// Small gauge on an arc with a thick red band at one end
function smallGauge(svg, g, marks, bandAt) {
    const group = el("g", { filter: "url(#glow)" }, svg);
    el("path", { d: arcPath(g.cx, g.cy, g.r, g.from, g.to), fill: "none", stroke: TICK, "stroke-width": 4 }, group);
    const bandEnd = g.from + (g.to - g.from) * (bandAt === "start" ? 0.16 : 0.84);
    const band = bandAt === "start" ? [g.from, bandEnd] : [bandEnd, g.to];
    el("path", { d: arcPath(g.cx, g.cy, g.r - 7, Math.min(...band), Math.max(...band)), fill: "none", stroke: TICK, "stroke-width": 14 }, group);
    [0, 0.5, 1].forEach(f => tick(group, g.cx, g.cy, g.r + 2, 18, g.from + (g.to - g.from) * f, 5));
    marks.forEach(([text, f]) => {
        const [x, y] = polar(g.cx, g.cy, g.r - 34, g.from + (g.to - g.from) * f);
        el("text", { x, y, class: "number", "font-size": 30 }, group, text);
    });
    return group;
}

function fuelIcon(parent, x, y) {
    const g = el("g", { transform: `translate(${x} ${y})`, fill: "none", stroke: NUMBER, "stroke-width": 3 }, parent);
    el("rect", { x: -10, y: -14, width: 16, height: 26, rx: 2 }, g);
    el("rect", { x: -6, y: -10, width: 8, height: 7, fill: NUMBER, stroke: "none" }, g);
    el("path", { d: "M6 -6 h5 v14 a3 3 0 0 0 6 0 v-16 l-5 -5" }, g);
}

function tempIcon(parent, x, y) {
    const g = el("g", { transform: `translate(${x} ${y})`, fill: "none", stroke: NUMBER, "stroke-width": 3 }, parent);
    el("path", { d: "M0 -16 v18" }, g);
    el("circle", { cx: 0, cy: 6, r: 5, fill: NUMBER }, g);
    el("path", { d: "M0 -12 h7 M0 -6 h7 M0 0 h7" }, g);
    el("path", { d: "M-14 15 q4 -4 7 0 t7 0 t7 0 t7 0", "stroke-width": 2.5 }, g);
}

function buildLeft(svg) {
    const l = LEFT;
    gaugeFace(svg, l, 20);

    const fuel = smallGauge(svg, FUEL, [["E", 0], ["F", 1]], "start");
    fuelIcon(fuel, FUEL.cx - 58, FUEL.cy + 2);
    const temp = smallGauge(svg, TEMP, [["C", 0], ["H", 1]], "end");
    tempIcon(temp, TEMP.cx + 56, TEMP.cy + 2);

    // DCCD lock display: LOCK on top, then cells with arrows that fill from the bottom
    el("text", { x: l.cx - 44, y: l.cy - 148, class: "number", "font-size": 22, filter: "url(#glow)" }, svg, "DCCD");
    const x = l.cx - 11;
    const dccd = el("g", { opacity: 0.7 }, svg);
    sti.dccd = [];
    for (let i = 0; i < DCCD_CELLS; i++) {
        const y = l.cy + 52 - i * 30;
        el("rect", { x, y, width: 22, height: 20, rx: 3, fill: "none", stroke: "#3a3a3c", "stroke-width": 1.5 }, dccd);
        const w = 6 + i * 1.5;
        sti.dccd.push(el("path", { d: `M${l.cx - w} ${y + 6} L${l.cx + w} ${y + 6} L${l.cx} ${y + 15} Z`, fill: LAMP_OFF }, dccd));
    }
    const lockY = l.cy + 52 - DCCD_CELLS * 30 - 4;
    el("rect", { x: x - 2, y: lockY, width: 26, height: 22, rx: 4, fill: "none", stroke: "#3a3a3c", "stroke-width": 1.5 }, dccd);
    sti.dccdLock = el("text", { x: l.cx, y: lockY + 11, "font-size": 10, "font-weight": 700, "text-anchor": "middle", fill: LAMP_OFF }, dccd, "LOCK");

    lcdWindow(svg, l.cx - 66, l.cy + 104, 132, 66);
    el("text", { x: l.cx - 44, y: l.cy + 116, class: "number", "font-size": 14 }, svg, "ODO");
}

// --- Lamp strip under the tachometer ---

function buildStrip(svg) {
    el("rect", { x: 600, y: 604, width: 400, height: 50, rx: 10, fill: "#050506", stroke: "#2a2a2c", "stroke-width": 2 }, svg);
    [["REV.", 566], ["TRIP", 1034]].forEach(([label, x]) => {
        el("text", { x, y: 596, class: "plain", "font-size": 16, "text-anchor": "middle" }, svg, label);
        el("circle", { cx: x, cy: 624, r: 11, fill: "url(#hub)", stroke: "#3a3a3c", "stroke-width": 1.5 }, svg);
    });
}

function buildCluster() {
    const svg = document.getElementById("cluster");
    const live = document.getElementById("live");
    if (!svg || !live) return;
    buildDefs(svg);
    buildBody(svg);
    buildLeft(svg);
    buildSpeedo(svg);
    buildTach(svg);
    buildStrip(svg);
    buildLive(live);
    updateLamps();
    setInterval(updateLamps, 100);
}

// --- Needles, LCDs and lamps ---

function needle(parent, cx, cy, length, tail, width) {
    const group = el("g", {}, parent);
    const shape = `${cx - width / 2},${cy + tail} ${cx - width * 0.28},${cy - length} ${cx},${cy - length - 4} ` +
        `${cx + width * 0.28},${cy - length} ${cx + width / 2},${cy + tail}`;
    el("polygon", { points: shape, fill: "#ff2a12", opacity: 0.25, stroke: "#ff2a12", "stroke-width": 6, "stroke-linejoin": "round" }, group);
    el("polygon", { points: shape, fill: "url(#needleFill)" }, group);
    return group;
}

function hub(parent, cx, cy, r) {
    el("circle", { cx, cy, r, fill: "url(#hub)", stroke: "#000", "stroke-width": 2 }, parent);
}

function setNeedle(group, cx, cy, angle) {
    group.setAttribute("transform", `rotate(${angle.toFixed(2)} ${cx} ${cy})`);
}

function buildLive(svg) {
    const defs = el("defs", {}, svg);
    for (const id of ["needleFill", "hub"]) defs.appendChild(document.getElementById(id).cloneNode(true));
    const revGlow = el("radialGradient", { id: "revGlow" }, defs);
    el("stop", { offset: "0%", "stop-color": "#ff3a22", "stop-opacity": "0.8" }, revGlow);
    el("stop", { offset: "100%", "stop-color": "#ff3a22", "stop-opacity": "0" }, revGlow);

    sti.fuelNeedle = needle(svg, FUEL.cx, FUEL.cy, 84, 0, 7);
    hub(svg, FUEL.cx, FUEL.cy, 22);
    sti.tempNeedle = needle(svg, TEMP.cx, TEMP.cy, 84, 0, 7);
    hub(svg, TEMP.cx, TEMP.cy, 22);
    sti.speedNeedle = needle(svg, SPEEDO.cx, SPEEDO.cy, 176, 0, 9);
    hub(svg, SPEEDO.cx, SPEEDO.cy, 28);
    sti.rpmNeedle = needle(svg, TACH.cx, TACH.cy, 206, 0, 11);
    hub(svg, TACH.cx, TACH.cy, 34);

    setNeedle(sti.fuelNeedle, FUEL.cx, FUEL.cy, FUEL.from);
    setNeedle(sti.tempNeedle, TEMP.cx, TEMP.cy, TEMP.from);
    setNeedle(sti.speedNeedle, SPEEDO.cx, SPEEDO.cy, speedAngle(0));
    setNeedle(sti.rpmNeedle, TACH.cx, TACH.cy, tachAngle(0));

    const s = SPEEDO;
    // Speedometer LCD: lap time on top, the split to the best lap below, right aligned.
    // The split is green when ahead.
    const right = s.cx + 66;
    sti.lapTime = lcd(svg, right - lcdWidth(28, "88:88.88"), s.cy + 100, 28, "88:88.88");
    sti.split = lcd(svg, right - lcdWidth(25, "888.88"), s.cy + 135, 25, "888.88");

    // Lamp strip: best lap in the middle, gear at the right end
    sti.bestTime = lcd(svg, 800 - lcdWidth(30, "88:88.88") / 2, 614, 30, "88:88.88");
    sti.gear = lcd(svg, 986 - lcdWidth(34, "88"), 612, 34, "88");

    // Left LCD: odometer
    sti.odometer = lcd(svg, LEFT.cx + 58 - lcdWidth(30, "888888"), LEFT.cy + 128, 30, "888888");

    // REV indicator: the knob lights at the shift point
    sti.rev = el("g", { opacity: 0 }, svg);
    el("circle", { cx: 566, cy: 624, r: 20, fill: "url(#revGlow)" }, sti.rev);
    el("circle", { cx: 566, cy: 624, r: 10, fill: "#ff3a22", stroke: "#ffb09a", "stroke-width": 1.5 }, sti.rev);

    sti.brake = el("text", { x: 455, y: 214, class: "lamp", "font-size": 24, fill: LAMP_OFF }, svg, "BRAKE");
    // updateTraction in dash-scripts.js blinks this lamp
    const abs = el("text", { id: "traction", x: 614, y: 629, class: "lamp", "font-size": 24, fill: "#ffb21f" }, svg, "ABS");
    abs.style.display = "none";
}

// Hand brake lamp
function updateLamps() {
    const data = typeof telemetry !== "undefined" ? telemetry : null;
    const on = data && data["IsRaceOn"] == 1 && data["HandBrake"] > 0;
    sti.brake.setAttribute("fill", on ? "#ff2a3a" : LAMP_OFF);
}

// --- Telemetry updates ---

// Above the top of the scale the needle bounces off the stop: hard when it first hits,
// then a small shake. The further past the top, the faster it bounces.
function updateSpeed(speed) {
    if (!sti.speedNeedle) return;
    const mph = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    let angle = speedAngle(mph);
    if (mph > SPEED_MAX) {
        const now = performance.now();
        if (sti.peggedSince == null) {
            sti.peggedSince = now;
            sti.pegPhase = 0;
            sti.pegLast = now;
        }
        const rate = Math.min(4, 1 + (mph - SPEED_MAX) / 40);
        sti.pegPhase += (now - sti.pegLast) / 45 * rate;
        sti.pegLast = now;
        const amplitude = 1.2 + 4.8 * Math.exp(-(now - sti.peggedSince) / 350);
        angle -= amplitude * Math.abs(Math.sin(sti.pegPhase));
    } else {
        sti.peggedSince = null;
    }
    setNeedle(sti.speedNeedle, SPEEDO.cx, SPEEDO.cy, angle);
}

function updateRpm(rpm, maxRPM, gear = -99) {
    if (!sti.rpmNeedle || rpm == null || maxRPM == null) return;
    configureTach(maxRPM);
    setNeedle(sti.rpmNeedle, TACH.cx, TACH.cy, tachAngle(rpm));

    initShiftLightRPM(maxRPM);
    configureShiftLight(rpm, maxRPM, gear);
    updateShiftLight(rpm);
    if (gear == -99) resetShiftLightRPM();

    // Same shift point as the last step of the shift lights
    const shift = rpmDotMax > 0 && rpm > rpmDotMax * (1 - 0.0375);
    sti.rev.setAttribute("opacity", shift ? 1 : 0);
}

function updateGear(gear, gearMax = null, gearNeutral = null, gearReverse = null) {
    if (!sti.gear || gear == null) return;
    let text = String(gear);
    if (gearNeutral != null && gear == gearNeutral) text = "N";
    else if ((gearReverse != null && gear == gearReverse) || gear == 0) text = "r";
    else if (!(gear > 0 && gear < 11) && !(gearMax != null && gear <= gearMax)) text = "N";
    sti.gear.set(text);
}

function updateFuel(percentage) {
    if (!sti.fuelNeedle) return;
    const f = Number.isFinite(percentage) ? clamp(percentage / 100, 0, 1) : 0;
    setNeedle(sti.fuelNeedle, FUEL.cx, FUEL.cy, FUEL.from + (FUEL.to - FUEL.from) * f);
}

// The temperature gauge shows the average tyre temperature
function updateTireTemp(tire, temp) {
    if (!sti.tempNeedle) return;
    sti.tyres[tire] = temp != null && Number.isFinite(Number(temp)) ? Number(temp) : null;
    const values = ["FL", "FR", "RL", "RR"].map(n => sti.tyres[n]).filter(v => v != null);
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : TEMP_COLD;
    const f = clamp((average - TEMP_COLD) / (TEMP_HOT - TEMP_COLD), 0, 1);
    setNeedle(sti.tempNeedle, TEMP.cx, TEMP.cy, TEMP.from + (TEMP.to - TEMP.from) * f);
}

function updateTireWear(tire, percentage) {
}

function updateDistance(meters) {
    if (!sti.odometer) return;
    sti.odometer.set(Number.isFinite(meters) && meters > 0 ? metersToMiles(meters).slice(-6) : "");
}

// Lap time without leading zeros: 41.70, 1:23.45
function lapFormat(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0.00";
    const cs = Math.floor(seconds * 100);
    const m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60, c = cs % 100;
    const pad = n => String(n).padStart(2, "0");
    return m > 0 ? `${m % 100}:${pad(s)}.${pad(c)}` : `${s}.${pad(c)}`;
}

function updateTime(id, time, minutes = true) {
    if (id === "time" && sti.lapTime) sti.lapTime.set(lapFormat(time));
    else if (id === "best-time" && sti.bestTime) sti.bestTime.set(lapFormat(time));
}

function updateSplit(split) {
    if (!sti.split) return;
    if (split == null || !Number.isFinite(split) || split >= invalidSplit) {
        sti.split.set("");
        return;
    }
    setLcdColor(sti.split, split <= 0 ? "#2ad460" : LCD_ON);
    sti.split.set((split < 0 ? "-" : "") + Math.min(99.99, Math.abs(split)).toFixed(2));
}

// The ABS lamp blinks on wheel slip; the DCCD cells fill with the slip, and LOCK lights
// at the slip that blinks the lamp
const sharedUpdateTraction = window.updateTraction;
window.updateTraction = function (tireSlipFront, tireSlipRear) {
    sharedUpdateTraction(tireSlipFront, tireSlipRear);
    if (!sti.dccd) return;
    const slip = tireSlipFront == null || tireSlipRear == null ? 0 : Math.max(tireSlipFront, tireSlipRear);
    const lit = Math.round(clamp(slip / 2, 0, 1) * DCCD_CELLS);
    sti.dccd.forEach((cell, i) => cell.setAttribute("fill", i < lit ? TICK : LAMP_OFF));
    sti.dccdLock.setAttribute("fill", slip > 2 ? TICK : LAMP_OFF);
};

buildCluster();
