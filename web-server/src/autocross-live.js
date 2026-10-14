// Autocross Live - full-screen split timer shown while a run is being driven.
// Compares the live position and lap timer with a reference run at the same point on the track.

const AutocrossLive = (function () {
    const POLL_MS = 50;
    const BAR_RANGE = 1.0;          // seconds shown at the end of the gain/loss bar
    const SECTOR_FLASH_MS = 3000;
    const RESULT_SHOW_MS = 6000;
    const SAVE_WAIT_MS = 4000;      // how long to wait for the saved run after the run ends

    let enabled = true;
    let overlay = null;

    // Run state
    let runActive = false;
    let hiddenForThisRun = false;
    let pollTimer = null;
    let pollPending = false;
    let liveCarId = null;
    let endTimer = null;
    let resultTimer = null;

    // Reference state
    let reference = null;           // full run object
    let referenceDist = null;
    let gateProgress = [];          // reference progress at each sector gate
    let tracker = null;
    let refOptions = [];            // [{key, label, run}]
    let refKey = null;
    let preparedFor = '';           // course|car|runs signature the reference was chosen for

    // Sector splits during the run
    let nextGate = 0;
    let deltaAtLastGate = 0;
    let livePath = [];              // [x, y, elapsed] driven so far this run

    function init() {
        overlay = document.getElementById('liveOverlay');
        enabled = localStorage.getItem('liveOverlayEnabled') !== 'false';
        updateToggleButton();

        document.getElementById('liveToggleBtn')?.addEventListener('click', () => {
            enabled = !enabled;
            localStorage.setItem('liveOverlayEnabled', String(enabled));
            updateToggleButton();
            if (!enabled) hide();
            showToast(enabled ? 'Live split screen on' : 'Live split screen off', 'info');
        });
        document.getElementById('liveCloseBtn')?.addEventListener('click', () => {
            hiddenForThisRun = true;
            hide();
        });
        document.getElementById('liveRefBtn')?.addEventListener('click', cycleReference);
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

    // Choose the reference: best run with the same car by default
    async function prepareReference() {
        if (!window.AutocrossApp) return;
        const courseId = AutocrossApp.getCurrentCourse();
        if (!courseId) return;

        if (!liveCarId) {
            const telem = await getLiveTelemetry();
            if (telem && telem.CarId) liveCarId = String(telem.CarId);
        }

        const runs = AutocrossApp.getAllRuns().filter(r => r.isValid);
        const sectors = window.AutocrossSectors ? AutocrossSectors.getSectors() : [];
        const signature = `${courseId}|${liveCarId}|${runs.map(r => r.runId + ':' + (r.cones || 0)).join(',')}|${sectors.map(x => x.sectorId).join(',')}`;
        if (signature === preparedFor) return;
        preparedFor = signature;

        refOptions = buildReferenceOptions(runs);
        const savedKey = localStorage.getItem('liveRefMode') || 'car';
        const option = refOptions.find(o => o.key === savedKey) || refOptions[0] || null;
        await setReference(option);
    }

    function buildReferenceOptions(runs) {
        const options = [];
        const seen = new Set();
        const add = (key, label, run) => {
            if (!run || seen.has(run.runId)) return;
            seen.add(run.runId);
            options.push({ key, label, run });
        };
        const best = list => sortByAdjustedTime(list)[0];

        add('car', 'Best · this car', best(runs.filter(r => r.carId === liveCarId)));
        add('overall', 'Best · overall', best(runs));
        [...new Set(runs.map(r => r.carId))]
            .filter(id => id && id !== liveCarId)
            .forEach(id => add(`car:${id}`, `Best · ${AutocrossApp.getCarName(id)}`, best(runs.filter(r => r.carId === id))));
        return options;
    }

    async function setReference(option) {
        refKey = option ? option.key : null;
        reference = null;
        if (!option) {
            renderReferenceLabel();
            return;
        }

        try {
            const run = await AutocrossApp.getRunData(option.run.runId);
            reference = run;
            referenceDist = AutocrossTrack.cumulativeDistance(run.telemetry.posX, run.telemetry.posY);

            const sectors = window.AutocrossSectors ? AutocrossSectors.getSectors() : [];
            gateProgress = AutocrossTrack.gateTimes(run.telemetry, sectors)
                .map(t => t === null ? null : AutocrossTrack.interpolate(run.telemetry.timestamps, referenceDist, t));
        } catch (e) {
            console.error('Live: failed to load reference run', e);
        }
        // A run in progress is measured against the new reference from here on
        if (runActive) resetTracking();
        renderReferenceLabel();
    }

    // Tap the reference label to compare against the next option
    async function cycleReference() {
        if (refOptions.length < 2) return;
        const index = refOptions.findIndex(o => o.key === refKey);
        const next = refOptions[(index + 1) % refOptions.length];
        localStorage.setItem('liveRefMode', next.key);
        await setReference(next);
        resetTracking();
    }

    function renderReferenceLabel() {
        const btn = document.getElementById('liveRefBtn');
        if (!btn) return;
        const option = refOptions.find(o => o.key === refKey);
        if (!reference || !option) {
            btn.textContent = 'No reference yet. This run will be the first.';
            btn.disabled = true;
            return;
        }
        const runNumber = AutocrossApp.getRunNumber(reference.runId);
        btn.textContent = `vs Run ${runNumber} · ${formatLapTime(reference.lapTime)} · ${option.label}` +
            (refOptions.length > 1 ? '  ▸' : '');
        btn.disabled = refOptions.length < 2;
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
        show();

        clearInterval(pollTimer);
        pollTimer = setInterval(poll, POLL_MS);
    }

    // Start tracking against the current reference. The path driven so far is replayed,
    // so changing the reference during a run keeps the correct position.
    function resetTracking() {
        tracker = reference
            ? AutocrossTrack.createProgressTracker(reference.telemetry.posX, reference.telemetry.posY, referenceDist)
            : null;
        nextGate = 0;
        deltaAtLastGate = 0;
        setText('liveSector', '');
        if (!tracker) return;

        // The live run starts at the start line, after the reference run's launch
        const { timestamps, posX, posY } = reference.telemetry;
        let progress = tracker(AutocrossTrack.interpolate(timestamps, posX, 0), AutocrossTrack.interpolate(timestamps, posY, 0));
        livePath.forEach(([x, y]) => { progress = tracker(x, y); });
        while (nextGate < gateProgress.length && gateProgress[nextGate] !== null && progress >= gateProgress[nextGate]) {
            nextGate++;
        }
        if (livePath.length > 0) {
            const elapsed = livePath[livePath.length - 1][2];
            deltaAtLastGate = elapsed - AutocrossTrack.interpolate(referenceDist, reference.telemetry.timestamps, progress);
        }
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
            if (telem && runActive) {
                // A different car than expected: choose the reference again
                if (telem.CarId && String(telem.CarId) !== liveCarId) {
                    liveCarId = String(telem.CarId);
                    await prepareReference();
                    resetTracking();
                }
                update(telem);
            }
        } finally {
            pollPending = false;
        }
    }

    function update(telem) {
        const elapsed = Number(telem.CurrentLap) || 0;
        const speed = Number(telem.Speed) || 0;

        setText('liveElapsed', formatLapTime(elapsed));
        setText('liveSpeed', `${Math.round(speed)}`);
        setText('liveGear', telem.Gear === -1 ? 'R' : (telem.Gear === 0 ? 'N' : String(telem.Gear ?? '')));

        const x = Number(telem.PositionX);
        const y = Number(telem.PositionZ);
        livePath.push([x, y, elapsed]);

        if (!reference || !tracker) {
            setDelta(null);
            return;
        }

        const progress = tracker(x, y);
        const refTime = AutocrossTrack.interpolate(referenceDist, reference.telemetry.timestamps, progress);
        const refSpeed = AutocrossTrack.interpolate(referenceDist, reference.telemetry.speed, progress);
        const delta = elapsed - refTime;

        setDelta(delta);
        setText('livePredicted', formatLapTime(reference.lapTime + delta));
        const speedDiff = Math.round(speed - refSpeed);
        setText('liveSpeedDelta', speedDiff === 0 ? '' : `${speedDiff > 0 ? '+' : ''}${speedDiff}`);
        document.getElementById('liveSpeedDelta')?.classList.toggle('up', speedDiff > 0);

        // Sector split when passing a gate
        while (nextGate < gateProgress.length && gateProgress[nextGate] !== null && progress >= gateProgress[nextGate]) {
            const split = delta - deltaAtLastGate;
            deltaAtLastGate = delta;
            nextGate++;
            flashSector(`S${nextGate}  ${formatDelta(split)}`, split);
        }
    }

    // --- Display ---
    function setDelta(delta) {
        const el = document.getElementById('liveDelta');
        const fill = document.getElementById('liveBarFill');
        if (!el || !fill) return;

        if (delta === null) {
            el.textContent = '—';
            el.className = 'live-delta';
            fill.style.width = '0';
            return;
        }

        el.textContent = formatDelta(delta);
        el.className = `live-delta ${delta <= 0 ? 'ahead' : 'behind'}`;

        // Bar grows left (green, ahead) or right (red, behind) from the centre
        const fraction = Math.min(1, Math.abs(delta) / BAR_RANGE) * 50;
        fill.style.width = `${fraction}%`;
        fill.style.left = delta <= 0 ? `${50 - fraction}%` : '50%';
        fill.className = `live-bar-fill ${delta <= 0 ? 'ahead' : 'behind'}`;
    }

    function flashSector(text, split) {
        const el = document.getElementById('liveSector');
        if (!el) return;
        el.textContent = text;
        el.className = `live-sector ${split <= 0 ? 'ahead' : 'behind'}`;
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.textContent = ''; }, SECTOR_FLASH_MS);
    }

    // Final time of the saved run against the reference
    function showResult() {
        const runs = AutocrossApp.getAllRuns();
        const newest = findMostRecentRun(runs);
        if (!newest) { hide(); return; }

        const lines = [`Run ${AutocrossApp.getRunNumber(newest.runId)}  ${formatLapTime(newest.lapTime)}`];
        let delta = null;
        if (reference && reference.runId !== newest.runId) {
            delta = newest.lapTime - reference.lapTime;
            lines.push(`${formatDelta(delta)} vs Run ${AutocrossApp.getRunNumber(reference.runId)}`);
        }

        const sameCarRuns = runs.filter(r => r.isValid && r.carId === newest.carId);
        const best = sortByAdjustedTime(sameCarRuns)[0];
        if (best && best.runId === newest.runId && sameCarRuns.length > 1) {
            lines.push('NEW BEST');
        }

        overlay?.classList.add('live-result');
        setText('liveResult', lines.join('\n'));
        if (delta !== null) setDelta(delta);
        setText('liveSector', '');

        clearTimeout(resultTimer);
        resultTimer = setTimeout(hide, RESULT_SHOW_MS);
    }

    function show() {
        if (!enabled || hiddenForThisRun || !overlay) return;
        renderReferenceLabel();
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
