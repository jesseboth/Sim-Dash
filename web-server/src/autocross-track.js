// Autocross Track Math - shared by the browser and the Node server
// Path progress, run alignment, and sector gate timing.

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.AutocrossTrack = api;
    }
})(typeof self !== 'undefined' ? self : this, function () {

    const MAX_GATE_WIDTH = 15;          // metres either side of a gate centre
    const NEAREST_FALLBACK_RADIUS = 15; // metres, for sectors without a direction
    const SEARCH_BACK = 5;              // reference segments searched behind the last match
    const SEARCH_AHEAD = 150;           // reference segments searched ahead of the last match

    // Results for a run's telemetry are cached, because run data does not change.
    // Callers must not change the returned arrays.
    const distanceCache = new WeakMap();  // posX array -> cumulative distance
    const progressCache = new WeakMap();  // reference telemetry -> (telemetry -> progress)

    // Cumulative distance along a path
    function cumulativeDistance(posX, posY) {
        const cached = distanceCache.get(posX);
        if (cached) return cached;
        const dist = new Array(posX.length);
        dist[0] = 0;
        for (let i = 1; i < posX.length; i++) {
            dist[i] = dist[i - 1] + Math.hypot(posX[i] - posX[i - 1], posY[i] - posY[i - 1]);
        }
        distanceCache.set(posX, dist);
        return dist;
    }

    // Tracks progress (distance along a reference path) for a moving point.
    // The search only moves forward through the path, so crossings and nearby parts
    // of the course are not confused. Progress never goes backward.
    function createProgressTracker(refX, refY, refDist) {
        let seg = 0;
        let prev = 0;

        return function update(x, y) {
            let bestDist = Infinity, bestProgress = prev, bestSeg = seg;
            const from = Math.max(0, seg - SEARCH_BACK);
            const to = Math.min(refX.length - 2, seg + SEARCH_AHEAD);
            for (let s = from; s <= to; s++) {
                const ax = refX[s], ay = refY[s];
                const sx = refX[s + 1] - ax, sy = refY[s + 1] - ay;
                const len2 = sx * sx + sy * sy;
                const f = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (y - ay) * sy) / len2)) : 0;
                const d = Math.hypot(x - (ax + f * sx), y - (ay + f * sy));
                if (d < bestDist) {
                    bestDist = d;
                    bestSeg = s;
                    bestProgress = refDist[s] + f * (refDist[s + 1] - refDist[s]);
                }
            }
            seg = bestSeg;
            prev = Math.max(prev, bestProgress);
            return prev;
        };
    }

    // Progress along the reference path for each sample of a run.
    // refDist must be the cumulative distance of refTelemetry.
    function progressAlongPath(refTelemetry, refDist, telemetry) {
        let byRun = progressCache.get(refTelemetry);
        if (!byRun) progressCache.set(refTelemetry, byRun = new WeakMap());
        const cached = byRun.get(telemetry);
        if (cached) return cached;

        const update = createProgressTracker(refTelemetry.posX, refTelemetry.posY, refDist);
        const { posX, posY } = telemetry;
        const progress = new Array(posX.length);
        for (let k = 0; k < posX.length; k++) {
            progress[k] = update(posX[k], posY[k]);
        }
        byRun.set(telemetry, progress);
        return progress;
    }

    // Linear interpolation of ys at x, where xs is non-decreasing. Clamps at both ends.
    function interpolate(xs, ys, x) {
        const n = xs.length;
        if (n === 0) return null;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[n - 1]) return ys[n - 1];
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] < x) lo = mid; else hi = mid;
        }
        const span = xs[hi] - xs[lo];
        const f = span > 0 ? (x - xs[lo]) / span : 0;
        return ys[lo] + f * (ys[hi] - ys[lo]);
    }

    // Time at which a run reached a progress value, or null if it never got that far
    function timeAtProgress(target, progress, timestamps) {
        if (target > progress[progress.length - 1]) return null;
        return interpolate(progress, timestamps, target);
    }

    // --- Car marker ---
    // Two sample indices that give the driving direction at sample i: the next sample at
    // least minDist metres away, else the previous one (car standing at the end). Null if never moving.
    function directionIndices(telemetry, i, minDist = 1) {
        const { posX, posY } = telemetry;
        for (let j = i + 1; j < posX.length; j++) {
            if (Math.hypot(posX[j] - posX[i], posY[j] - posY[i]) >= minDist) return [i, j];
        }
        for (let j = i - 1; j >= 0; j--) {
            if (Math.hypot(posX[i] - posX[j], posY[i] - posY[j]) >= minDist) return [j, i];
        }
        return null;
    }

    // Corners of a navigation arrow (dart) centred on x, y and pointing along angle
    function carArrowPolygon(x, y, angle, size) {
        const shape = [[0.6, 0], [-0.45, 0.42], [-0.2, 0], [-0.45, -0.42]];
        const cos = Math.cos(angle), sin = Math.sin(angle);
        return shape.map(([u, v]) => [x + (u * cos - v * sin) * size, y + (u * sin + v * cos) * size]);
    }

    // --- Sector gates ---
    // A gate is the line through a sector position, across the track
    // (perpendicular to dirX/dirY). Returns the interpolated time of the first forward
    // crossing after afterTime, within MAX_GATE_WIDTH of the gate centre, or null.
    function findGateCrossingTime(telemetry, sector, afterTime) {
        const { posX, posY, timestamps } = telemetry;
        const { posX: gateX, posY: gateY, dirX, dirY } = sector;

        for (let i = 0; i < posX.length - 1; i++) {
            if (timestamps[i + 1] <= afterTime) continue;

            // Signed distance along the track direction: negative before the gate, positive after
            const d0 = dirX * (posX[i] - gateX) + dirY * (posY[i] - gateY);
            const d1 = dirX * (posX[i + 1] - gateX) + dirY * (posY[i + 1] - gateY);
            if (!(d0 < 0 && d1 >= 0)) continue;

            const f = d0 / (d0 - d1);
            const crossX = posX[i] + f * (posX[i + 1] - posX[i]);
            const crossY = posY[i] + f * (posY[i + 1] - posY[i]);
            if (Math.hypot(crossX - gateX, crossY - gateY) > MAX_GATE_WIDTH) continue;

            return timestamps[i] + f * (timestamps[i + 1] - timestamps[i]);
        }
        return null;
    }

    // Fallback for sectors without a direction: the closest point after afterTime
    function findTimeNearPosition(telemetry, targetX, targetY, afterTime) {
        const { posX, posY, timestamps } = telemetry;
        let minDist = Infinity, bestIdx = -1;
        for (let i = 0; i < posX.length; i++) {
            if (timestamps[i] <= afterTime) continue;
            const d = Math.hypot(posX[i] - targetX, posY[i] - targetY);
            if (d < minDist) { minDist = d; bestIdx = i; }
        }
        return bestIdx !== -1 && minDist <= NEAREST_FALLBACK_RADIUS ? timestamps[bestIdx] : null;
    }

    // Time a run passes each gate, in sector order. Each gate is searched only after
    // the previous gate. A gate the run does not pass gets null.
    function gateTimes(telemetry, sectors) {
        const times = [];
        let afterTime = startLineTime(telemetry);
        for (const sector of sectors) {
            let t = null;
            if (sector.dirX !== undefined && sector.dirY !== undefined) {
                t = findGateCrossingTime(telemetry, sector, afterTime);
            }
            if (t === null) {
                t = findTimeNearPosition(telemetry, sector.posX, sector.posY, afterTime);
            }
            times.push(t);
            if (t !== null) afterTime = t;
        }
        return times;
    }

    // Time 0 is the S1 line. Runs recorded without the launch start just after it.
    function startLineTime(telemetry) {
        return Math.max(0, telemetry.timestamps[0]);
    }

    // Start and end time of sector i (0 = S1 line to gate 1, last = last gate to the finish)
    function sectorWindow(telemetry, gates, sectorIndex) {
        const ts = telemetry.timestamps;
        const startTime = sectorIndex === 0 ? startLineTime(telemetry) : gates[sectorIndex - 1];
        const endTime = sectorIndex === gates.length ? ts[ts.length - 1] : gates[sectorIndex];
        if (startTime === null || endTime === null || endTime <= startTime) return null;
        return { startTime, endTime };
    }

    // Duration of every sector (gates.length + 1 values, null where a gate was missed)
    function sectorTimes(telemetry, sectors) {
        if (!sectors || sectors.length === 0) return [];
        const gates = gateTimes(telemetry, sectors);
        const result = [];
        for (let i = 0; i <= gates.length; i++) {
            const w = sectorWindow(telemetry, gates, i);
            result.push(w ? w.endTime - w.startTime : null);
        }
        return result;
    }

    return {
        cumulativeDistance,
        createProgressTracker,
        progressAlongPath,
        interpolate,
        timeAtProgress,
        gateTimes,
        directionIndices,
        carArrowPolygon,
        startLineTime,
        sectorWindow,
        sectorTimes
    };
});
