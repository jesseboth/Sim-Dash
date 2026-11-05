// Autocross Live - full-screen split timer shown while a run is being driven.
// Compares the live position and lap timer with a reference run at the same point on the track.

const AutocrossLive = (function () {
    const POLL_MS = 50;
    const RESULT_SHOW_MS = 6000;
    const SAVE_WAIT_MS = 4000;      // how long to wait for the saved run after the run ends
    const PILL_RANGE = 2.0;         // seconds at the end of the main pill
    const SECTOR_PILL_RANGE = 1.0;  // seconds at the end of a sector pill
    const SELECTED_KEY = 'liveRefSelected';

    let enabled = true;
    let overlay = null;

    // Run state
    let runActive = false;
    let hiddenForThisRun = false;
    let pollTimer = null;
    let pollPending = false;
    let endTimer = null;
    let resultTimer = null;

    // Reference state
    let reference = null;           // full run object
    let referenceDist = null;
    let gateProgress = [];          // reference progress at each sector line
    let tracker = null;
    let preparedFor = '';           // signature of the inputs the reference was chosen from

    // Sector splits during the run
    let nextGate = 0;
    let deltaAtLastGate = 0;
    let sectorSplits = [];          // split of each finished sector
    let livePath = [];              // [x, y, elapsed] driven so far this run

    function init() {
        overlay = document.getElementById('liveOverlay');
        enabled = localStorage.getItem('liveOverlayEnabled') !== 'false';
        updateToggleButton();

        document.getElementById('liveToggleBtn')?.addEventListener('click', () => {
            // During a run, a closed or switched-off live screen opens again
            if (runActive && overlay?.classList.contains('hidden')) {
                enabled = true;
                localStorage.setItem('liveOverlayEnabled', 'true');
                hiddenForThisRun = false;
                updateToggleButton();
                show();
                return;
            }
            enabled = !enabled;
            localStorage.setItem('liveOverlayEnabled', String(enabled));
            updateToggleButton();
            if (!enabled) hide();
            const armed = window.AutocrossRecorder?.getState() !== 'idle';
            showToast(!enabled ? 'Live split screen off'
                : armed ? 'Live split screen on. It opens when the next run starts.'
                : 'Live split screen on. It opens when a run starts. Press Start to record.', 'info');
        });
        document.getElementById('liveCloseBtn')?.addEventListener('click', () => {
            hiddenForThisRun = true;
            hide();
        });

        const selectedToggle = document.getElementById('liveRefSelectedToggle');
        if (selectedToggle) {
            selectedToggle.checked = localStorage.getItem(SELECTED_KEY) === 'true';
            selectedToggle.addEventListener('change', () => {
                localStorage.setItem(SELECTED_KEY, String(selectedToggle.checked));
                preparedFor = '';
                prepareReference();
            });
        }
    }

    function updateToggleButton() {
        const btn = document.getElementById('liveToggleBtn');
        if (!btn) return;
        btn.classList.toggle('active', enabled);
        btn.title = enabled ? 'Live split screen is on' : 'Live split screen is off';
    }

    // --- Status from the recorder (called on every status poll) ---
    function onStatus(status) {
        if (status.isRecording && !runActive) {
            prepareReference();
        }

        if (status.runActive && !runActive) {
            startRun();
        } else if (!status.runActive && runActive) {
            endRun();
        }
    }

    // Called after the app has loaded a newly saved run
    function onRunSaved() {
        preparedFor = '';
        if (!endTimer) return;
        clearTimeout(endTimer);
        endTimer = null;
        showResult();
    }

    // --- Reference run ---
    async function getLiveTelemetry() {
        try {
            const res = await fetch(`http://${window.location.hostname}:8888/telemetry`);
            return res.ok ? await res.json() : null;
        } catch (e) {
            return null;
        }
    }

    // The reference is the best run of the class of new runs (all runs when no class is set).
    // With "Live vs selected", it is the best of the selected runs.
    function chooseReference() {
        const runs = AutocrossApp.getAllRuns().filter(r => r.isValid !== false);
        const best = list => sortByAdjustedTime(list)[0] || null;

        if (localStorage.getItem(SELECTED_KEY) === 'true') {
            const selected = new Set(AutocrossApp.getSelectedRunIds());
            const fromSelected = best(runs.filter(r => selected.has(r.runId)));
            if (fromSelected) return fromSelected;
        }
        const sessionClass = AutocrossApp.getSessionClass();
        const inClass = sessionClass ? runs.filter(r => r.carClass === sessionClass) : [];
        return best(inClass.length ? inClass : runs);
    }

    async function prepareReference() {
        if (!window.AutocrossApp) return;
        const courseId = AutocrossApp.getCurrentCourse();
        if (!courseId) return;

        const run = chooseReference();
        const sectors = window.AutocrossSectors ? AutocrossSectors.getSectors() : [];
        const signature = `${courseId}|${run ? run.runId + ':' + (run.cones || 0) : ''}|${sectors.map(x => x.sectorId).join(',')}`;
        if (signature === preparedFor) return;
        preparedFor = signature;
        await setReference(run);
    }

    async function setReference(run) {
        reference = null;
        gateProgress = [];
        if (run) {
            try {
                const data = await AutocrossApp.getRunData(run.runId);
                referenceDist = AutocrossTrack.cumulativeDistance(data.telemetry.posX, data.telemetry.posY);
                const sectors = window.AutocrossSectors ? AutocrossSectors.getSectors() : [];
                gateProgress = AutocrossTrack.gateTimes(data.telemetry, sectors)
                    .map(t => t === null ? null : AutocrossTrack.interpolate(data.telemetry.timestamps, referenceDist, t));
                reference = data;
            } catch (e) {
                console.error('Live: failed to load reference run', e);
            }
        }
        // A run in progress is measured against the new reference from here on
        if (runActive) resetTracking();
        renderSectorPills();
    }

    // --- Run lifecycle ---
    function startRun() {
        runActive = true;
        hiddenForThisRun = false;
        clearTimeout(endTimer);
        clearTimeout(resultTimer);
        endTimer = null;
        livePath = [];
        resetTracking();

        overlay?.classList.remove('live-result');
        setText('liveResult', '');
        setText('liveSector', '');
        show();

        clearInterval(pollTimer);
        pollTimer = setInterval(poll, POLL_MS);
    }

    // Start tracking against the current reference. The path driven so far is replayed,
    // so changing the reference during a run keeps the correct position and sector splits.
    function resetTracking() {
        tracker = reference
            ? AutocrossTrack.createProgressTracker(reference.telemetry.posX, reference.telemetry.posY, referenceDist)
            : null;
        nextGate = 0;
        deltaAtLastGate = 0;
        sectorSplits = [];
        setDelta(null);
        if (!tracker) return;

        // The live run starts at the S1 line, after the reference run's launch
        const { timestamps, posX, posY } = reference.telemetry;
        tracker(AutocrossTrack.interpolate(timestamps, posX, 0), AutocrossTrack.interpolate(timestamps, posY, 0));
        livePath.forEach(([x, y, elapsed]) => advance(elapsed, tracker(x, y)));
        renderSectorPills();
    }

    // Time difference at a point on the track; records the split of each sector line passed
    function advance(elapsed, progress) {
        const delta = elapsed - AutocrossTrack.interpolate(referenceDist, reference.telemetry.timestamps, progress);
        while (nextGate < gateProgress.length && gateProgress[nextGate] !== null && progress >= gateProgress[nextGate]) {
            sectorSplits.push(delta - deltaAtLastGate);
            deltaAtLastGate = delta;
            nextGate++;
        }
        return delta;
    }

    function endRun() {
        runActive = false;
        clearInterval(pollTimer);
        pollTimer = null;

        // Wait for the saved run; if none arrives the run was discarded
        setText('liveSector', 'Finish…');
        clearTimeout(endTimer);
        endTimer = setTimeout(() => {
            endTimer = null;
            hide();
        }, SAVE_WAIT_MS);
    }

    async function poll() {
        if (pollPending) return;
        pollPending = true;
        try {
            const telem = await getLiveTelemetry();
            if (telem && runActive) update(telem);
        } finally {
            pollPending = false;
        }
    }

    function update(telem) {
        const elapsed = Number(telem.CurrentLap) || 0;
        setText('liveElapsed', formatLapTime(elapsed));

        const x = Number(telem.PositionX);
        const y = Number(telem.PositionZ);
        livePath.push([x, y, elapsed]);
        if (!reference || !tracker) return;

        const delta = advance(elapsed, tracker(x, y));
        setDelta(delta);
        renderSectorPills(delta - deltaAtLastGate);
    }

    // --- Display ---
    // Time difference to the reference and the main pill; hidden when there is no reference
    function setDelta(delta) {
        const el = document.getElementById('liveDelta');
        const pill = document.getElementById('livePill');
        if (!el || !pill) return;
        const none = delta === null;
        el.classList.toggle('hidden', none);
        pill.classList.toggle('hidden', none);
        if (none) return;
        el.textContent = formatDelta(delta);
        el.className = `live-delta ${delta <= 0 ? 'ahead' : 'behind'}`;
        setPillFill(pill, delta, PILL_RANGE);
    }

    // A pill fills from the centre line: left and green when ahead, right and red when behind
    function setPillFill(pill, delta, range) {
        const fill = pill.querySelector('.live-pill-fill');
        if (!fill) return;
        const half = delta === null ? 0 : Math.min(1, Math.abs(delta) / range) * 50;
        fill.style.width = `${half}%`;
        fill.style.left = delta !== null && delta <= 0 ? `${50 - half}%` : '50%';
        fill.className = `live-pill-fill ${delta !== null && delta <= 0 ? 'ahead' : 'behind'}`;
    }

    // One small pill for each sector: finished sectors keep their split, the current sector
    // shows its split so far. Shown only when the course has sector lines.
    function renderSectorPills(currentSplit = null) {
        const row = document.getElementById('liveSectorPills');
        if (!row) return;
        const count = reference ? gateProgress.length + 1 : 0;
        row.classList.toggle('hidden', count < 2);
        if (count < 2) return;

        if (row.children.length !== count) {
            row.innerHTML = Array.from({ length: count }, (_, i) =>
                `<div class="live-sector-item"><div class="live-sector-pill"><div class="live-pill-fill"></div><div class="live-pill-center"></div></div><span class="live-sector-label">S${i + 1}</span></div>`
            ).join('');
        }
        [...row.children].forEach((item, i) => {
            const split = i < sectorSplits.length ? sectorSplits[i]
                : (i === sectorSplits.length && runActive ? currentSplit : null);
            item.classList.toggle('current', i === sectorSplits.length && runActive);
            item.classList.toggle('pending', split === null);
            setPillFill(item.querySelector('.live-sector-pill'), split, SECTOR_PILL_RANGE);
            const label = item.querySelector('.live-sector-label');
            label.textContent = split === null ? `S${i + 1}` : `S${i + 1} ${formatDelta(split)}`;
            label.className = `live-sector-label ${split === null ? '' : split <= 0 ? 'ahead' : 'behind'}`;
        });
    }

    // Final time of the saved run against the reference
    function showResult() {
        const runs = AutocrossApp.getAllRuns();
        const newest = findMostRecentRun(runs);
        if (!newest) { hide(); return; }

        const dnf = newest.isValid === false;
        const lines = [`Run ${AutocrossApp.getRunNumber(newest.runId)}  ${dnf ? 'DNF' : formatLapTime(newest.lapTime)}`];
        let delta = null;
        if (!dnf && reference && reference.runId !== newest.runId) {
            delta = newest.lapTime - reference.lapTime;
        }

        // Same class when the run has one, else same game car ID
        const sameCarRuns = runs.filter(r => r.isValid && (newest.carClass
            ? r.carClass === newest.carClass
            : r.carId === newest.carId));
        const best = sortByAdjustedTime(sameCarRuns)[0];
        if (best && best.runId === newest.runId && sameCarRuns.length > 1) {
            lines.push('NEW BEST');
        }

        overlay?.classList.add('live-result');
        setText('liveResult', lines.join('\n'));
        setDelta(delta);
        setText('liveSector', '');

        clearTimeout(resultTimer);
        resultTimer = setTimeout(hide, RESULT_SHOW_MS);
    }

    function show() {
        if (!enabled || hiddenForThisRun || !overlay) return;
        overlay.classList.remove('hidden');
    }

    function hide() {
        overlay?.classList.add('hidden');
        overlay?.classList.remove('live-result');
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function formatDelta(delta) {
        return `${delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)}`;
    }

    return {
        init,
        onStatus,
        onRunSaved
    };
})();

window.AutocrossLive = AutocrossLive;

document.addEventListener('DOMContentLoaded', () => {
    AutocrossLive.init();
});
