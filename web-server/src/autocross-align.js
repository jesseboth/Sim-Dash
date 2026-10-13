// Autocross Align - line runs up by track position relative to a reference run.
// In align mode the timeline is the reference run's time. Every other run is shown
// where it was when it reached the same point on the track as the reference.

const AutocrossAlign = (function () {
    let reference = null;       // run object, or null in time mode
    let referenceDist = null;   // cumulative distance along the reference path
    let runs = [];
    const progressByRun = new Map(); // runId -> progress along the reference path per sample
    const listeners = [];

    function isActive() {
        return reference !== null;
    }

    function getReference() {
        return reference;
    }

    // Set the run that the others line up with
    function setReference(run) {
        if (!run) return;
        reference = run;
        referenceDist = AutocrossTrack.cumulativeDistance(run.telemetry.posX, run.telemetry.posY);
        recompute();
        notify();
    }

    // Back to time mode
    function clear() {
        if (!reference) return;
        reference = null;
        referenceDist = null;
        progressByRun.clear();
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
            progressByRun.clear();
            return;
        }
        reference = stillShown;
        recompute();
    }

    function recompute() {
        progressByRun.clear();
        runs.forEach(run => {
            if (run.runId === reference.runId) return;
            progressByRun.set(run.runId,
                AutocrossTrack.progressAlongPath(reference.telemetry, referenceDist, run.telemetry));
        });
    }

    // Time in a run that matches a reference time (same track position).
    // Returns the run's end time when the run never got that far.
    function timeInRun(run, referenceTime) {
        if (!reference || run.runId === reference.runId) return referenceTime;
        const progress = progressByRun.get(run.runId);
        if (!progress) return referenceTime;

        const dist = AutocrossTrack.interpolate(reference.telemetry.timestamps, referenceDist, referenceTime);
        const t = AutocrossTrack.timeAtProgress(dist, progress, run.telemetry.timestamps);
        return t === null ? run.telemetry.timestamps[run.telemetry.timestamps.length - 1] : t;
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
        clear,
        setRuns,
        timeInRun,
        onChange
    };
})();

window.AutocrossAlign = AutocrossAlign;
