// Autocross Live - full-screen split timer shown while a run is being driven.
// Compares the live position and lap timer with a reference run at the same point on the track.

const AutocrossLive = (function () {
    const POLL_MS = 50;
    const RESULT_SHOW_MS = 30000;
    const STAGED_HOLD_MS = 5000;    // the ready screen stays this long after the car leaves the start
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
    let staged = false;             // the ready screen shows: the car stands at the start
    let stagedTimer = null;

    // Reference state
    let reference = null;           // full run object
    let referenceDist = null;
    let gateProgress = [];          // reference progress at each sector line
    let tracker = null;
    let preparedFor = '';           // signature of the inputs the reference was chosen from
    let refSectors = [];            // reference run time of each sector
    let bestSectors = [];           // best time of each sector, from all runs the reference is chosen from
    let startProgress = 0;          // reference progress at time 0

    // Sector splits during the run
    let nextGate = 0;
    let deltaAtLastGate = 0;
    let sectorSplits = [];          // split of each finished sector
    let livePath = [];              // [x, y, elapsed] driven so far this run
    let lastProgress = 0;

    function init() {
        overlay = document.getElementById('liveOverlay');
        enabled = localStorage.getItem('liveOverlayEnabled') !== 'false';
        updateToggleButton();

        document.getElementById('liveToggleBtn')?.addEventListener('click', () => {
            // During a run, a closed or switched-off live screen opens again
            if ((runActive || staged) && overlay?.classList.contains('hidden')) {
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
            hiddenForThisRun = runActive || staged;
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
        } else if (!runActive) {
            setStaged(!!status.isRecording && !!status.staged);
        }
    }

    // Ready screen while the car stands at the start, before the timer starts (for example in the countdown)
    function setStaged(on) {
        if (on) {
            clearTimeout(stagedTimer);
            stagedTimer = null;
            if (staged || endTimer || overlay?.classList.contains('live-result')) return;
            staged = true;
            hiddenForThisRun = false;
            clearTimeout(resultTimer);
            resetDisplay();
            setText('liveSector', 'Ready');
            show();
        } else if (staged && !stagedTimer) {
            stagedTimer = setTimeout(() => {
                stagedTimer = null;
                staged = false;
                hiddenForThisRun = false;
                hide();
            }, STAGED_HOLD_MS);
        }
    }

    function clearStaged() {
        clearTimeout(stagedTimer);
        stagedTimer = null;
        staged = false;
    }

    function resetDisplay() {
        overlay?.classList.remove('live-result');
        setText('liveResult', '');
        setText('liveSector', '');
        setText('liveElapsed', formatLapTime(0));
        sectorSplits = [];
        setDelta(null);
        renderSectorPills();
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

    // Runs the reference is chosen from: the class of new runs (all runs when no class is set)
    function referencePool() {
        const runs = AutocrossApp.getAllRuns().filter(r => r.isValid !== false);
        const sessionClass = AutocrossApp.getSessionClass();
        const inClass = sessionClass ? runs.filter(r => r.carClass === sessionClass) : [];
        return inClass.length ? inClass : runs;
    }

    // The reference is the best run of the reference pool.
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
        bestSectors = computeBestSectorTimes(referencePool());
        const sectors = window.AutocrossSectors ? AutocrossSectors.getSectors() : [];
        const signature = `${courseId}|${run ? run.runId + ':' + (run.cones || 0) : ''}|${sectors.map(x => x.sectorId).join(',')}`;
        if (signature === preparedFor) return;
        preparedFor = signature;
        await setReference(run);
    }

    async function setReference(run) {
        reference = null;
        gateProgress = [];
        refSectors = [];
        if (run) {
            try {
                const data = await AutocrossApp.getRunData(run.runId);
                const ts = data.telemetry.timestamps;
                referenceDist = AutocrossTrack.cumulativeDistance(data.telemetry.posX, data.telemetry.posY);
                startProgress = AutocrossTrack.interpolate(ts, referenceDist, 0);
                const sectors = window.AutocrossSectors ? AutocrossSectors.getSectors() : [];
                const gates = AutocrossTrack.gateTimes(data.telemetry, sectors);
                gateProgress = gates.map(t => t === null ? null : AutocrossTrack.interpolate(ts, referenceDist, t));
                refSectors = AutocrossTrack.sectorTimes(data.telemetry, sectors);
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
        // A screen closed while staged stays closed for the run
        if (!staged) hiddenForThisRun = false;
        clearStaged();
        runActive = true;
        clearTimeout(endTimer);
        clearTimeout(resultTimer);
        endTimer = null;
        livePath = [];
        resetDisplay();
        resetTracking();
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
        lastProgress = startProgress;
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
        lastProgress = progress;
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
            hiddenForThisRun = false;
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

    // Gap of the reference to the best time of each sector (null when a time is unknown)
    function sectorGaps() {
        const count = gateProgress.length + 1;
        if (count < 2 || refSectors.length !== count || bestSectors.length !== count) return null;
        const gaps = refSectors.map((t, i) => t === null || bestSectors[i] == null ? null : t - bestSectors[i]);
        return gaps.includes(null) ? null : gaps;
    }

    // Part of the current sector that is driven (0..1), from the reference distance
    function currentSectorPart() {
        const done = sectorSplits.length;
        const from = done === 0 ? startProgress : gateProgress[done - 1];
        const to = done < gateProgress.length ? gateProgress[done] : referenceDist[referenceDist.length - 1];
        return to > from ? Math.min(1, Math.max(0, (lastProgress - from) / (to - from))) : 0;
    }

    // A pill fills from the centre line: left and green when ahead, right and red when behind
    // Against the best sectors the colours are purple when ahead and yellow when behind
    function setPillFill(pill, delta, range, bestColours = false) {
        const fill = pill.querySelector('.live-pill-fill');
        if (!fill) return;
        const ahead = delta !== null && delta <= 0;
        const half = delta === null ? 0 : Math.min(1, Math.abs(delta) / range) * 50;
        fill.style.width = `${half}%`;
        fill.style.left = ahead ? `${50 - half}%` : '50%';
        fill.className = `live-pill-fill ${bestColours ? (ahead ? 'purple' : 'slower') : (ahead ? 'ahead' : 'behind')}`;
    }

    // Two rows of small pills, one pill for each sector. The first row is the split against the
    // reference run, the second row is the sector time against the best time of that sector
    // (purple when faster, yellow when slower). Finished sectors keep their value; the current
    // sector shows its value so far. Shown only when the course has sector lines.
    function renderSectorPills(currentSplit = null) {
        const count = reference ? gateProgress.length + 1 : 0;
        const done = sectorSplits.length;
        const current = runActive && done < count ? done : -1;
        const valueAt = (i, finished, now) => i < done ? finished(i) : (i === current && currentSplit !== null ? now(i) : null);

        fillSectorRow('liveSectorPills', count, current,
            i => valueAt(i, j => sectorSplits[j], () => currentSplit), false);

        // The reference gap to the best sector is added by the part of the sector driven
        const gaps = sectorGaps();
        fillSectorRow('liveBestPills', gaps ? count : 0, current,
            i => valueAt(i, j => sectorSplits[j] + gaps[j], j => currentSplit + gaps[j] * currentSectorPart()), true);
    }

    function fillSectorRow(id, count, current, valueOf, bestColours) {
        const row = document.getElementById(id);
        if (!row) return;
        row.classList.toggle('hidden', count < 2);
        if (count < 2) return;

        if (row.children.length !== count) {
            row.innerHTML = Array.from({ length: count }, (_, i) =>
                `<div class="live-sector-item"><div class="live-sector-pill"><div class="live-pill-fill"></div><div class="live-pill-center"></div></div><span class="live-sector-label">S${i + 1}</span></div>`
            ).join('');
        }
        const [ahead, behind] = bestColours ? ['purple', 'slower'] : ['ahead', 'behind'];
        [...row.children].forEach((item, i) => {
            const value = valueOf(i);
            item.classList.toggle('current', i === current);
            item.classList.toggle('pending', value === null);
            setPillFill(item.querySelector('.live-sector-pill'), value, SECTOR_PILL_RANGE, bestColours);
            const label = item.querySelector('.live-sector-label');
            const name = bestColours ? `Best S${i + 1}` : `S${i + 1}`;
            label.textContent = value === null ? name : `${name} ${formatDelta(value)}`;
            label.className = `live-sector-label ${value === null ? '' : value <= 0 ? ahead : behind}`;
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

        // The last sector ends at the finish, which has no sector line: its split comes from the final times
        if (delta !== null && gateProgress.length > 0 && sectorSplits.length === gateProgress.length) {
            sectorSplits.push(delta - deltaAtLastGate);
        }
        renderSectorPills();

        overlay?.classList.add('live-result');
        setText('liveResult', lines.join('\n'));
        setDelta(delta);
        setText('liveSector', '');

        clearTimeout(resultTimer);
        resultTimer = setTimeout(() => {
            hiddenForThisRun = false;
            hide();
        }, RESULT_SHOW_MS);
    }

    function show() {
        if (!enabled || hiddenForThisRun || !overlay) return;
        overlay.classList.remove('hidden');
    }

    function hide() {
        overlay?.classList.add('hidden');
        overlay?.classList.remove('live-result');
        clearTimeout(resultTimer);
        resultTimer = null;
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
