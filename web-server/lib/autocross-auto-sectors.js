// Automatic sector lines for a course, made from its runs.
// Autocross and track: a line just before each big braking zone, so a sector is a braking
// zone and what follows it (sweeper, slalom) up to the next big braking zone.
// Rally: lines spread along the stage at random distances.

const AutocrossTrack = require('../src/autocross-track');

// secondsPerSector sets the sector count from the run time, between minSectors and maxSectors
const MODES = {
    autocross: { secondsPerSector: 10, minSectors: 3, maxSectors: 8, minDrop: 8, minSectorTime: 4 },
    track: { secondsPerSector: 20, minSectors: 3, maxSectors: 6, minDrop: 10, minSectorTime: 8 },
    rally: { secondsPerSector: Infinity, minSectors: 6, maxSectors: 6, minSectorTime: 20 }
};
const HYSTERESIS = 3;        // mph; speed change that ends a rise or a fall
const CLUSTER_RADIUS = 25;   // m; braking points of different runs closer than this are one zone
const LEAD_TIME = 0.5;       // s before the braking point
const MIN_LEAD = 5;          // m
const STRAIGHT_SEARCH = 10;  // m back from the target to look for a straighter point
const RALLY_SNAP = 40;       // m either side of a rally target to look for a straighter point
const MPH_TO_MPS = 0.44704;

// Lines for the runs: [{posX, posY, dirX, dirY}]
function generate(runs) {
    const ref = fastestRun(runs);
    if (!ref) return [];
    const mode = guessMode(runs);
    const cfg = MODES[mode];
    const count = Math.min(cfg.maxSectors, Math.max(cfg.minSectors, Math.round(ref.lapTime / cfg.secondsPerSector)));
    return suggest(runs, mode, count);
}

// Best mode for the runs: closed circuit = track, long open stage = rally
function guessMode(runs) {
    const ref = fastestRun(runs);
    if (!ref) return 'autocross';
    const { posX, posY, timestamps } = ref.telemetry;
    const i0 = timedStart(ref);
    const n = posX.length - 1;
    const closed = Math.hypot(posX[n] - posX[i0], posY[n] - posY[i0]) < 15;
    const length = AutocrossTrack.cumulativeDistance(posX, posY)[n];
    if (closed && timestamps[n] > 45) return 'track';
    if (!closed && length > 3000) return 'rally';
    return 'autocross';
}

// Lines for count sectors, in track order
function suggest(runs, mode, count) {
    const ref = fastestRun(runs);
    if (!ref) return [];
    const cfg = MODES[mode] || MODES.autocross;
    const path = buildPath(ref);
    const picks = mode === 'rally'
        ? rallyPoints(path, count, cfg)
        : brakingPoints(runs, ref, path, count, cfg);
    const lines = picks.map(p => gateAt(path, p.idx));

    // Keep only lines that most runs pass
    return lines.filter((line, i) => {
        const passed = runs.filter(run => AutocrossTrack.gateTimes(run.telemetry, [line])[0] !== null).length;
        return passed * 2 >= runs.length;
    });
}

function fastestRun(runs) {
    return runs.reduce((best, r) => (!best || r.lapTime < best.lapTime ? r : best), null);
}

function timedStart(run) {
    const i = run.telemetry.timestamps.findIndex(t => t >= 0);
    return Math.max(0, i);
}

function buildPath(ref) {
    const t = ref.telemetry;
    return {
        run: ref,
        posX: t.posX,
        posY: t.posY,
        ts: t.timestamps,
        speed: t.speed,
        dist: AutocrossTrack.cumulativeDistance(t.posX, t.posY),
        start: timedStart(ref),
        end: t.posX.length - 1
    };
}

// --- Autocross and track ---

function brakingPoints(runs, ref, path, count, cfg) {
    // Braking zones of every run, as distances along the reference path
    const found = [];
    runs.forEach(run => {
        const progress = run === ref ? path.dist : AutocrossTrack.progressAlongPath(ref.telemetry, path.dist, run.telemetry);
        brakingZones(run, cfg.minDrop).forEach(z => found.push({ dist: progress[z.idx], drop: z.drop }));
    });
    found.sort((a, b) => a.dist - b.dist);

    // Zones that most runs share score highest
    const clusters = [];
    found.forEach(z => {
        const last = clusters[clusters.length - 1];
        if (last && z.dist - last.members[last.members.length - 1].dist <= CLUSTER_RADIUS) last.members.push(z);
        else clusters.push({ members: [z] });
    });
    clusters.forEach(c => {
        const ds = c.members.map(m => m.dist).sort((a, b) => a - b);
        const drops = c.members.map(m => m.drop).sort((a, b) => a - b);
        c.dist = ds[ds.length >> 1];
        c.drop = drops[drops.length >> 1];
        c.score = c.members.reduce((s, m) => s + m.drop, 0) / runs.length;
    });

    // Strongest zones first, at least minSectorTime from the S1 line, the finish and each other
    const startT = path.ts[path.start], endT = path.ts[path.end];
    const picked = [];
    clusters.sort((a, b) => b.score - a.score);
    for (const c of clusters) {
        if (picked.length >= count - 1) break;
        const idx = lineIndexBefore(path, c.dist);
        if (idx === null) continue;
        const t = path.ts[idx];
        if (t - startT < cfg.minSectorTime || endT - t < cfg.minSectorTime) continue;
        if (picked.some(p => Math.abs(path.ts[p.idx] - t) < cfg.minSectorTime)) continue;
        picked.push({ idx });
    }
    return picked.sort((a, b) => a.idx - b.idx);
}

// Each fall in speed of at least minDrop mph, from the top speed before it to the
// lowest speed after it. idx is where the brake goes on, else the top speed.
function brakingZones(run, minDrop) {
    const { speed, brake, timestamps } = run.telemetry;
    const zones = [];
    let peak = 0, valley = 0, falling = false;
    const close = () => {
        const drop = speed[peak] - speed[valley];
        if (drop >= minDrop && timestamps[peak] >= 0) {
            let idx = peak;
            if (brake) {
                for (let i = peak; i < valley; i++) {
                    if (brake[i] > 0.1) { idx = i; break; }
                }
            }
            zones.push({ idx, drop });
        }
    };
    for (let i = 1; i < speed.length; i++) {
        if (!falling) {
            if (speed[i] > speed[peak]) peak = i;
            else if (speed[peak] - speed[i] >= HYSTERESIS) { falling = true; valley = i; }
        } else {
            if (speed[i] < speed[valley]) valley = i;
            else if (speed[i] - speed[valley] >= HYSTERESIS) {
                close();
                falling = false;
                peak = i;
            }
        }
    }
    if (falling) close();
    return zones;
}

// The straightest point a short way before the braking point
function lineIndexBefore(path, brakeDist) {
    const brakeIdx = indexAtDistance(path, brakeDist);
    const lead = Math.max(MIN_LEAD, (path.speed[brakeIdx] || 0) * MPH_TO_MPS * LEAD_TIME);
    const target = brakeDist - lead;
    if (target <= path.dist[path.start]) return null;
    return straightestNear(path, target - STRAIGHT_SEARCH, target);
}

// --- Rally ---

// Even spacing by distance, each line moved at random by up to a quarter of a sector
function rallyPoints(path, count, cfg) {
    const d0 = path.dist[path.start], d1 = path.dist[path.end];
    const span = (d1 - d0) / count;
    const picked = [];
    for (let k = 1; k < count; k++) {
        const target = d0 + k * span + (Math.random() - 0.5) * 0.5 * span;
        const idx = straightestNear(path, target - RALLY_SNAP, target + RALLY_SNAP);
        const t = path.ts[idx];
        if (picked.some(p => Math.abs(path.ts[p.idx] - t) < cfg.minSectorTime)) continue;
        picked.push({ idx });
    }
    return picked;
}

// --- Path helpers ---

function indexAtDistance(path, d) {
    let lo = path.start, hi = path.end;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (path.dist[mid] < d) lo = mid + 1; else hi = mid;
    }
    return lo;
}

// Index between two distances where the path turns least
function straightestNear(path, fromDist, toDist) {
    const a = indexAtDistance(path, Math.max(fromDist, path.dist[path.start]));
    const b = indexAtDistance(path, Math.min(toDist, path.dist[path.end]));
    let best = b, bestTurn = Infinity;
    for (let i = a; i <= b; i++) {
        const turn = turnAt(path, i);
        if (turn < bestTurn) { bestTurn = turn; best = i; }
    }
    return best;
}

// Heading change from 5 m before to 5 m after index i, in radians
function turnAt(path, i) {
    const before = indexAtDistance(path, path.dist[i] - 5);
    const after = indexAtDistance(path, path.dist[i] + 5);
    if (before >= i || after <= i) return Math.PI;
    const h1 = Math.atan2(path.posY[i] - path.posY[before], path.posX[i] - path.posX[before]);
    const h2 = Math.atan2(path.posY[after] - path.posY[i], path.posX[after] - path.posX[i]);
    return Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
}

// Gate at index i, across the driving direction
function gateAt(path, i) {
    const dir = AutocrossTrack.directionIndices(path.run.telemetry, i);
    let dirX = 0, dirY = 1;
    if (dir) {
        const dx = path.posX[dir[1]] - path.posX[dir[0]];
        const dy = path.posY[dir[1]] - path.posY[dir[0]];
        const len = Math.hypot(dx, dy);
        dirX = dx / len;
        dirY = dy / len;
    }
    return { posX: path.posX[i], posY: path.posY[i], dirX, dirY };
}

module.exports = { generate };
