// Autocross Align - line runs up at one point on the track.
// When a car is tapped, every run is shifted in time so that all cars are at that car's
// position at that moment (the anchor). After that each run plays at its own pace, so the
// cars spread out by what they gained or lost from the anchor. The timeline is the
// reference run's time.

const AutocrossAlign = (function () {
    let reference = null;       // run object, or null in time mode
    let referenceDist = null;   // cumulative distance along the reference path
    let runs = [];
    let anchorTime = 0;         // reference time where the runs are lined up
    const offsetByRun = new Map(); // runId -> run time minus reference time at the anchor
    const listeners = [];

    function isActive() {
        return reference !== null;
    }

    function getReference() {
        return reference;
    }

    // Line the runs up at the reference run's position at referenceTime
    function setReference(run, referenceTime) {
        if (!run) return;
        reference = run;
        referenceDist = AutocrossTrack.cumulativeDistance(run.telemetry.posX, run.telemetry.posY);
        const ts = run.telemetry.timestamps;
        anchorTime = Math.max(ts[0], Math.min(ts[ts.length - 1], referenceTime ?? 0));
        recompute();
        notify();
    }

    function getAnchorTime() {
        return anchorTime;
    }

    // Run time minus reference time at the anchor (0 for the reference run)
    function offsetOf(run) {
        return offsetByRun.get(run.runId) || 0;
    }

    // Back to time mode
    function clear() {
        if (!reference) return;
        reference = null;
        referenceDist = null;
        offsetByRun.clear();
        notify();
    }

    // Update the run list. Leaves align mode when the reference run is no longer shown.
    function setRuns(newRuns) {
        runs = newRuns;
        if (!reference) return;

        const stillShown = newRuns.find(r => r.runId === reference.runId);
        if (!stillShown) {
            reference = null;
            referenceDist = null;
            offsetByRun.clear();
            return;
        }
        reference = stillShown;
        recompute();
    }

    // Offset of each run: when it reached the reference position at the anchor
    function recompute() {
        offsetByRun.clear();
        const anchorDist = AutocrossTrack.interpolate(reference.telemetry.timestamps, referenceDist, anchorTime);
        runs.forEach(run => {
            if (run.runId === reference.runId) return;
            const progress = AutocrossTrack.progressAlongPath(reference.telemetry, referenceDist, run.telemetry);
            const t = AutocrossTrack.timeAtProgress(anchorDist, progress, run.telemetry.timestamps);
            offsetByRun.set(run.runId, t === null ? 0 : t - anchorTime);
        });
    }

    // Reference times covering every run after its shift: from the earliest start
    // to the last finish, so playback continues until the last car finishes
    function timeRange() {
        const shifted = runs.map(run => {
            const ts = run.telemetry.timestamps;
            const off = offsetOf(run);
            return [ts[0] - off, ts[ts.length - 1] - off];
        });
        return {
            start: Math.min(...shifted.map(r => r[0])),
            end: Math.max(...shifted.map(r => r[1]))
        };
    }

    // Time in a run that matches a reference time, kept within the run
    function timeInRun(run, referenceTime) {
        if (!reference || run.runId === reference.runId) return referenceTime;
        const ts = run.telemetry.timestamps;
        return Math.max(ts[0], Math.min(ts[ts.length - 1], referenceTime + offsetOf(run)));
    }

    function onChange(listener) {
        listeners.push(listener);
    }

    function notify() {
        listeners.forEach(fn => fn(reference));
    }

    return {
        isActive,
        getReference,
        setReference,
        getAnchorTime,
        offsetOf,
        timeRange,
        clear,
        setRuns,
        timeInRun,
        onChange
    };
})();

window.AutocrossAlign = AutocrossAlign;
