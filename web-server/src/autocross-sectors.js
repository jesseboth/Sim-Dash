// Autocross Sectors - Sector management, comparison modal, and mini-map playback

const AutocrossSectors = (function () {

    // --- State ---
    let sectors = [];           // [{sectorId, name, posX, posY, dirX, dirY}], in track order
    let currentCourseId = null;
    let sectorsVersion = 0;     // Increments when sectors change, invalidates gate time cache
    const gateTimeCache = new WeakMap(); // run -> {version, times}
    let saveQueue = Promise.resolve();

    // Modal state
    let modalRuns = [];         // full run objects with telemetry
    let activeSectorIndex = 0;  // which sector the mini-map is playing

    // Mini-map playback
    let mapCanvas = null;
    let mapCtx = null;
    let playbackInterval = null;
    let playbackTime = 0;       // relative seconds from sector start
    let maxPlaybackTime = 0;
    let isPlaying = false;

    // View transform for mini-map
    let mapViewBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

    const COLORS = ['#4a9eff', '#ff4a4a', '#4aff4a', '#ffaa4a', '#ff4aff', '#4affff'];
    const PLAYBACK_STEP_MS = 50;   // ~20fps
    const PLAYBACK_SPEED = 1.0;    // real-time

    // --- Init ---
    function init() {
        const addBtn = document.getElementById('addSectorBtn');
        if (addBtn) addBtn.addEventListener('click', handleAddSector);

        const closeBtn = document.getElementById('closeSectorsModal');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        const sectorsModal = document.getElementById('sectorsModal');
        if (sectorsModal) {
            sectorsModal.addEventListener('click', (e) => {
                if (e.target === sectorsModal) closeModal();
            });
        }

        const openBtn = document.getElementById('openSectorsBtn');
        if (openBtn) openBtn.addEventListener('click', handleOpenSectors);

        const sectorPlayBtn = document.getElementById('sectorPlayBtn');
        if (sectorPlayBtn) sectorPlayBtn.addEventListener('click', togglePlayback);

        document.getElementById('cancelDeleteSector')?.addEventListener('click', closeDeleteModal);
        document.getElementById('confirmDeleteSector')?.addEventListener('click', executeDeleteSector);
        document.getElementById('deleteSectorModal')?.addEventListener('click', (e) => {
            if (e.target === document.getElementById('deleteSectorModal')) closeDeleteModal();
        });

        mapCanvas = document.getElementById('sectorMapCanvas');
        if (mapCanvas) mapCtx = mapCanvas.getContext('2d');

        const table = document.getElementById('sectorsTable');
        if (table) setupTableListeners(table);
    }

    // --- Delete confirmation modal ---
    let pendingDeleteSectorId = null;

    function confirmRemoveSector(sector) {
        pendingDeleteSectorId = sector.sectorId;
        const msg = document.getElementById('deleteSectorMsg');
        if (msg) msg.textContent = `Remove "${sector.name}"?`;
        document.getElementById('deleteSectorModal')?.classList.remove('hidden');
    }

    function closeDeleteModal() {
        pendingDeleteSectorId = null;
        document.getElementById('deleteSectorModal')?.classList.add('hidden');
    }

    function executeDeleteSector() {
        if (pendingDeleteSectorId) removeSector(pendingDeleteSectorId);
        closeDeleteModal();
    }

    // --- Course change ---
    async function loadSectors(courseId) {
        currentCourseId = courseId;
        setSectors([]);
        if (!courseId) {
            renderSectorControls();
            refreshVisualizations();
            return;
        }
        let loaded = [];
        try {
            loaded = (await apiRequest('getSectors', { courseId })) || [];
        } catch (e) {
            loaded = [];
        }
        // Ignore the result if the course changed while loading
        if (courseId !== currentCourseId) return;
        setSectors(loaded);
        renderSectorControls();
        refreshVisualizations();
    }

    function setSectors(newSectors) {
        sectors = newSectors;
        sectors.forEach((s, i) => { s.name = `Sector ${i + 1}`; });
        sectorsVersion++;
    }

    // Saves run one after another so the last change always wins
    function persistSectors() {
        if (!currentCourseId) return;
        const courseId = currentCourseId;
        const snapshot = sectors.map(s => ({ ...s }));
        saveQueue = saveQueue
            .then(() => apiRequest('saveSectors', { courseId, sectors: snapshot }))
            // Sector times on the run cards are calculated by the server
            .then(() => { if (window.AutocrossApp && courseId === currentCourseId) AutocrossApp.refreshRuns(); })
            .catch(e => console.error('Failed to save sectors:', e));
    }

    // --- Add / Remove ---
    function handleAddSector() {
        if (!window.AutocrossScrubber) return;
        const time = AutocrossScrubber.getCurrentTime();
        const run = AutocrossScrubber.getCurrentRun();
        if (!run) {
            showToast('Load a run before adding sectors', 'warning');
            return;
        }

        // Use the aligned reference run, else whichever run has traveled furthest by this time
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        const frontRun = alignRef || getFrontmostRun(time) || run;
        const { posX, posY, timestamps } = frontRun.telemetry;
        const idx = findIndexAtTime(frontRun, time);
        const gateX = posX[idx];
        const gateY = posY[idx];

        // Track direction at the gate, from the next point at least 1 m away
        let dx = 0, dy = 0;
        for (let i = idx + 1; i < posX.length; i++) {
            dx = posX[i] - gateX;
            dy = posY[i] - gateY;
            if (Math.hypot(dx, dy) >= 1) break;
        }
        const len = Math.hypot(dx, dy);
        if (len < 0.1) {
            showToast('Cannot add a sector here: the car is not moving', 'warning');
            return;
        }

        // Insert in track order: before the first gate this run reaches later
        const gateTime = timestamps[idx];
        const existingTimes = getGateTimes(frontRun);
        let insertAt = existingTimes.findIndex(t => t !== null && t > gateTime);
        if (insertAt === -1) insertAt = sectors.length;

        const newSectors = [...sectors];
        newSectors.splice(insertAt, 0, {
            sectorId: `s-${Date.now()}`,
            posX: gateX,
            posY: gateY,
            dirX: dx / len,
            dirY: dy / len
        });
        setSectors(newSectors);

        persistSectors();
        renderSectorControls();
        refreshVisualizations();
        showToast(`Added sector marker S${insertAt + 1}`, 'success');
    }

    function removeSector(sectorId) {
        setSectors(sectors.filter(s => s.sectorId !== sectorId));
        persistSectors();
        renderSectorControls();
        refreshVisualizations();
    }

    function refreshVisualizations() {
        if (window.AutocrossScrubber) AutocrossScrubber.render();
        if (window.AutocrossMap) AutocrossMap.render();
        if (window.AutocrossCharts) AutocrossCharts.render();
        if (window.AutocrossApp) AutocrossApp.updateHint();
    }

    // --- Sector controls (below scrubber) ---
    function renderSectorControls() {
        const container = document.getElementById('sectorsList');
        if (!container) return;
        container.innerHTML = '';

        sectors.forEach((s) => {
            const chip = document.createElement('span');
            chip.className = 'sector-chip';
            chip.innerHTML = `${s.name} <button class="sector-chip-remove" data-id="${s.sectorId}" title="Remove sector">×</button>`;
            chip.querySelector('.sector-chip-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                removeSector(s.sectorId);
            });
            container.appendChild(chip);
        });

        // Show/hide open button based on whether there are sectors
        const openBtn = document.getElementById('openSectorsBtn');
        if (openBtn) {
            openBtn.disabled = sectors.length === 0;
            openBtn.textContent = sectors.length > 0
                ? `Sectors (${sectors.length})`
                : 'Sectors';
        }
    }

    // --- Open modal ---
    async function handleOpenSectors() {
        // Get loaded runs from the main app
        const app = window.AutocrossApp;
        if (!app) return;

        const runObjects = app.getLoadedRunObjects();
        if (!runObjects || runObjects.length === 0) {
            showToast('Select runs to compare sectors', 'warning');
            return;
        }
        if (sectors.length === 0) {
            showToast('Add sectors first using "+ Sector" button', 'warning');
            return;
        }

        modalRuns = runObjects;
        activeSectorIndex = 0;

        openModal();
    }

    function openModal() {
        const modal = document.getElementById('sectorsModal');
        if (!modal) return;
        modal.classList.remove('hidden');

        renderTable();

        // Defer mini-map init to allow DOM layout to settle
        setTimeout(() => {
            initMiniMap();
            setActiveSector(0);
        }, 50);
    }

    function closeModal() {
        stopPlayback();
        const modal = document.getElementById('sectorsModal');
        if (modal) modal.classList.add('hidden');
    }

    function setActiveSector(index) {
        activeSectorIndex = index;

        // Update active column highlighting — headers and all cells
        document.querySelectorAll('[data-sector-index]').forEach(el => {
            el.classList.toggle('sector-col-active', parseInt(el.dataset.sectorIndex, 10) === index);
        });

        // Update map label
        const label = document.getElementById('sectorMapLabel');
        if (label) label.textContent = `Sector ${index + 1}`;

        restartPlayback();
    }

    // --- Sector time table ---
    function renderTable() {
        const table = document.getElementById('sectorsTable');
        if (!table) return;

        const sectorCount = sectors.length + 1;
        const sectorIndexes = [...Array(sectorCount).keys()];

        // Header — sector columns are clickable to select for map playback
        let thead = '<thead><tr><th>Run</th><th>Total</th>';
        sectorIndexes.forEach(i => {
            const active = i === activeSectorIndex ? ' sector-col-active' : '';
            thead += `<th class="sector-col-header${active}" data-sector-index="${i}">Sector ${i + 1}</th>`;
        });
        thead += '</tr></thead>';

        const runSectorTimes = modalRuns.map(run => ({
            run,
            sectorTimes: sectorIndexes.map(i => computeSectorTime(run, i))
        }));

        const bestSectorTimes = sectorIndexes.map(si => {
            const times = runSectorTimes.map(r => r.sectorTimes[si]).filter(t => t !== null);
            return times.length > 0 ? Math.min(...times) : null;
        });

        // Optimal total = sum of best sector times
        const optimalTotal = bestSectorTimes.every(t => t !== null)
            ? bestSectorTimes.reduce((a, b) => a + b, 0)
            : null;

        let tbody = '<tbody>';
        runSectorTimes.forEach(({ run, sectorTimes }, ri) => {
            const cones = run.cones || 0;
            const total = getAdjustedTime(run);
            const label = run.name || `Run ${run.runNumber || (ri + 1)}`;
            const color = run.color || COLORS[ri % COLORS.length];
            const coneTag = cones > 0 ? ` <span class="sector-cone-badge" title="${cones} cone${cones !== 1 ? 's' : ''}">+${cones * CONE_PENALTY}s</span>` : '';
            tbody += `<tr>`;
            tbody += `<td><span class="sector-run-dot" style="background:${color}"></span>${escapeHtml(label)}</td>`;
            tbody += `<td>${formatTime(total)}${coneTag}</td>`;
            sectorTimes.forEach((t, si) => {
                const best = bestSectorTimes[si];
                const isBest = t !== null && best !== null && Math.abs(t - best) < 0.001;
                const delta = (t !== null && best !== null && !isBest) ? (t - best) : null;
                const cls = isBest ? 'sector-best' : '';
                let content = t !== null ? formatTime(t) : '—';
                if (delta !== null) content += `<br><span class="sector-delta">+${delta.toFixed(3)}</span>`;
                tbody += `<td class="sector-col sector-col-${si} ${cls}" data-sector-index="${si}">${content}</td>`;
            });
            tbody += `</tr>`;
        });

        // Optimal row — sum of best sectors, without cone penalties
        if (optimalTotal !== null) {
            tbody += `<tr class="sector-optimal-row"><td title="Sum of the best sector times, without cone penalties">Optimal</td><td>${formatTime(optimalTotal)}</td>`;
            sectorIndexes.forEach(si => { tbody += `<td class="sector-col sector-col-${si}" data-sector-index="${si}"></td>`; });
            tbody += `</tr>`;
        }

        tbody += '</tbody>';
        table.innerHTML = thead + tbody;
    }

    // Table listeners are added once; the table content is replaced on each render
    function setupTableListeners(table) {
        // Any header or cell with data-sector-index selects that sector
        table.addEventListener('click', (e) => {
            const cell = e.target.closest('[data-sector-index]');
            if (cell) setActiveSector(parseInt(cell.dataset.sectorIndex, 10));
        });

        // Column hover highlight
        table.addEventListener('mouseover', (e) => {
            const cell = e.target.closest('[data-sector-index]');
            table.querySelectorAll('.sector-col-hover').forEach(el => el.classList.remove('sector-col-hover'));
            if (cell) {
                const idx = cell.dataset.sectorIndex;
                table.querySelectorAll(`[data-sector-index="${idx}"]`).forEach(el => el.classList.add('sector-col-hover'));
            }
        });

        table.addEventListener('mouseleave', () => {
            table.querySelectorAll('.sector-col-hover').forEach(el => el.classList.remove('sector-col-hover'));
        });
    }

    // --- Gate timing (math in autocross-track.js) ---
    function getSectorWindow(run, sectorIndex) {
        return AutocrossTrack.sectorWindow(run.telemetry, getGateTimes(run), sectorIndex);
    }

    function computeSectorTime(run, sectorIndex) {
        const w = getSectorWindow(run, sectorIndex);
        return w ? w.endTime - w.startTime : null;
    }

    function getGateTimes(run) {
        const cached = gateTimeCache.get(run);
        if (cached && cached.version === sectorsVersion) return cached.times;

        const times = AutocrossTrack.gateTimes(run.telemetry, sectors);
        gateTimeCache.set(run, { version: sectorsVersion, times });
        return times;
    }

    // --- Mini-map ---
    function initMiniMap() {
        if (!mapCanvas || !mapCtx) return;
        resizeMiniMap();
        renderMiniMap();
    }

    function resizeMiniMap() {
        if (!mapCanvas) return;
        const rect = mapCanvas.getBoundingClientRect();
        mapCanvas.width = rect.width > 0 ? rect.width : 300;
        mapCanvas.height = rect.height > 0 ? rect.height : 300;
    }

    function computeMapBounds() {
        if (activeSectorIndex < 0 || activeSectorIndex > sectors.length) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        modalRuns.forEach(run => {
            const w = getSectorWindow(run, activeSectorIndex);
            if (!w) return;
            const from = findClosestTimeIndex(run.telemetry.timestamps, w.startTime);
            const to = findClosestTimeIndex(run.telemetry.timestamps, w.endTime);

            for (let i = from; i <= to; i++) {
                const x = run.telemetry.posX[i];
                const y = run.telemetry.posY[i];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        });

        if (!isFinite(minX)) return;

        const padX = (maxX - minX) * 0.25 || 5;
        const padY = (maxY - minY) * 0.25 || 5;
        mapViewBounds = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
    }

    function renderMiniMap() {
        if (!mapCtx) return;
        const w = mapCanvas.width;
        const h = mapCanvas.height;

        mapCtx.fillStyle = '#1a1a1a';
        mapCtx.fillRect(0, 0, w, h);

        if (modalRuns.length === 0 || sectors.length === 0) return;

        computeMapBounds();

        // Draw order: runs that miss the sector first, then slowest to fastest (fastest on top)
        const drawOrder = modalRuns
            .map((run, ri) => ({ run, ri, w: getSectorWindow(run, activeSectorIndex) }))
            .sort((a, b) => (b.w ? b.w.endTime - b.w.startTime : Infinity) - (a.w ? a.w.endTime - a.w.startTime : Infinity));

        // Draw full track (faded) then sector portion (bright) for each run
        drawOrder.forEach(({ run, ri, w }) => {
            const color = run.color || COLORS[ri % COLORS.length];
            drawRunSegment(run, null, null, color, 0.15);
            if (!w) return;
            const startIdx = findClosestTimeIndex(run.telemetry.timestamps, w.startTime);
            const endIdx = findClosestTimeIndex(run.telemetry.timestamps, w.endTime);
            drawRunSegment(run, startIdx, endIdx, color, 1.0);
        });

        // Draw animated position markers (same order — fastest on top)
        const speedReadouts = [];
        drawOrder.forEach(({ run, ri, w }) => {
            if (!w) return;
            const color = run.color || COLORS[ri % COLORS.length];
            const { startTime, endTime } = w;
            const targetTime = startTime + playbackTime;

            const endIdx = findClosestTimeIndex(run.telemetry.timestamps, endTime);
            let markerIdx;
            let finished;
            if (targetTime > endTime) {
                markerIdx = endIdx;
                finished = true;
            } else {
                markerIdx = findClosestTimeIndex(run.telemetry.timestamps, targetTime);
                finished = false;
            }
            drawMarker(run, markerIdx, color, finished);

            // Collect speed for readout (mph assumed — adjust if needed)
            const speed = run.telemetry.speed ? run.telemetry.speed[markerIdx] : null;
            speedReadouts.push({ ri, color, speed, finished });
        });

        // Draw speed readouts in bottom-right, fastest run at top of list
        speedReadouts.sort((a, b) => a.ri - b.ri);  // restore original run order for readout
        const fontSize = 13;
        const lineH = fontSize + 5;
        const padL = 10;
        const padB = 10;
        mapCtx.font = `bold ${fontSize}px monospace`;
        speedReadouts.forEach(({ color, speed, finished }, i) => {
            const label = speed !== null ? `${Math.round(speed)} mph` : '—';
            const x = padL;
            const y = h - padB - (speedReadouts.length - 1 - i) * lineH;

            // Speed text in run color
            mapCtx.globalAlpha = finished ? 0.4 : 1.0;
            mapCtx.fillStyle = color;
            mapCtx.fillText(label, x, y);
            mapCtx.globalAlpha = 1.0;
        });
    }

    function drawRunSegment(run, fromIdx, toIdx, color, alpha) {
        const { posX, posY } = run.telemetry;
        const start = fromIdx !== null ? fromIdx : 0;
        const end = toIdx !== null ? toIdx : posX.length - 1;

        mapCtx.globalAlpha = alpha;
        mapCtx.strokeStyle = color;
        mapCtx.lineWidth = 1.5;
        mapCtx.lineCap = 'round';
        mapCtx.lineJoin = 'round';
        mapCtx.beginPath();

        for (let i = start; i <= end; i++) {
            const p = worldToScreen(posX[i], posY[i]);
            i === start ? mapCtx.moveTo(p.x, p.y) : mapCtx.lineTo(p.x, p.y);
        }
        mapCtx.stroke();
        mapCtx.globalAlpha = 1;
    }

    function drawMarker(run, idx, color, finished) {
        const p = worldToScreen(run.telemetry.posX[idx], run.telemetry.posY[idx]);

        // Always keep the run's color — just reduce opacity when finished
        mapCtx.globalAlpha = finished ? 0.5 : 1.0;
        mapCtx.fillStyle = color;
        mapCtx.strokeStyle = '#000';
        mapCtx.lineWidth = 2;
        mapCtx.beginPath();
        mapCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        mapCtx.fill();
        mapCtx.stroke();
        mapCtx.globalAlpha = 1.0;

        // Direction arrow — only while still running
        if (!finished) {
            const { posX, posY } = run.telemetry;
            if (idx < posX.length - 1) {
                const next = worldToScreen(posX[idx + 1], posY[idx + 1]);
                const angle = Math.atan2(next.y - p.y, next.x - p.x);
                mapCtx.fillStyle = '#ffffff';
                mapCtx.strokeStyle = '#000';
                mapCtx.lineWidth = 1;
                mapCtx.beginPath();
                mapCtx.moveTo(p.x + Math.cos(angle) * 5, p.y + Math.sin(angle) * 5);
                mapCtx.lineTo(p.x + Math.cos(angle + 2.5) * 3, p.y + Math.sin(angle + 2.5) * 3);
                mapCtx.lineTo(p.x + Math.cos(angle - 2.5) * 3, p.y + Math.sin(angle - 2.5) * 3);
                mapCtx.closePath();
                mapCtx.fill();
                mapCtx.stroke();
            }
        }
    }

    function worldToScreen(x, y) {
        const w = mapCanvas.width;
        const h = mapCanvas.height;
        const ww = mapViewBounds.maxX - mapViewBounds.minX;
        const wh = mapViewBounds.maxY - mapViewBounds.minY;
        if (ww === 0 || wh === 0) return { x: w / 2, y: h / 2 };
        const scale = Math.min(w / ww, h / wh);
        const cx = w / 2;
        const cy = h / 2;
        const wcx = (mapViewBounds.minX + mapViewBounds.maxX) / 2;
        const wcy = (mapViewBounds.minY + mapViewBounds.maxY) / 2;
        return {
            x: cx + (x - wcx) * scale,
            y: cy + (y - wcy) * scale
        };
    }

    // --- Playback ---
    function togglePlayback() {
        isPlaying ? stopPlayback() : startPlayback();
    }

    function startPlayback() {
        if (modalRuns.length === 0 || sectors.length === 0) return;

        // Compute max sector duration across all runs
        const durations = modalRuns.map(run => computeSectorTime(run, activeSectorIndex) ?? 0);
        maxPlaybackTime = Math.max(...durations);

        if (playbackTime >= maxPlaybackTime) playbackTime = 0;

        isPlaying = true;
        updatePlayBtn();

        playbackInterval = setInterval(() => {
            playbackTime += (PLAYBACK_STEP_MS / 1000) * PLAYBACK_SPEED;
            if (playbackTime >= maxPlaybackTime) {
                playbackTime = maxPlaybackTime;
                stopPlayback();
            }
            renderMiniMap();
        }, PLAYBACK_STEP_MS);
    }

    function stopPlayback() {
        isPlaying = false;
        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }
        updatePlayBtn();
    }

    function restartPlayback() {
        stopPlayback();
        playbackTime = 0;
        renderMiniMap();
        startPlayback();
    }

    function updatePlayBtn() {
        const btn = document.getElementById('sectorPlayBtn');
        if (btn) btn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    }

    // --- Frontmost run ---
    // Returns the loaded run whose car has traveled the greatest path distance by `time`
    function getFrontmostRun(time) {
        const runs = window.AutocrossApp ? AutocrossApp.getLoadedRunObjects() : [];
        if (runs.length === 0) return null;
        if (runs.length === 1) return runs[0];

        let bestRun = null;
        let bestDist = -1;

        runs.forEach(run => {
            const idx = findIndexAtTime(run, time);
            let dist = 0;
            const { posX, posY } = run.telemetry;
            for (let i = 1; i <= idx; i++) {
                const dx = posX[i] - posX[i - 1];
                const dy = posY[i] - posY[i - 1];
                dist += Math.sqrt(dx * dx + dy * dy);
            }
            if (dist > bestDist) {
                bestDist = dist;
                bestRun = run;
            }
        });

        return bestRun;
    }

    // --- Telemetry helpers ---
    function findIndexAtTime(run, time) {
        return findClosestTimeIndex(run.telemetry.timestamps, time);
    }

    function findClosestTimeIndex(timestamps, time) {
        let lo = 0, hi = timestamps.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (timestamps[mid] < time) lo = mid + 1;
            else hi = mid;
        }
        // Check neighbor
        if (lo > 0 && Math.abs(timestamps[lo - 1] - time) < Math.abs(timestamps[lo] - time)) {
            return lo - 1;
        }
        return lo;
    }

    // --- For scrubber: gate times for a given run (same timing as the table) ---
    function getSectorTimesForRun(run) {
        if (!run || sectors.length === 0) return [];
        return getGateTimes(run);
    }

    // --- Utils ---
    function formatTime(seconds) {
        if (typeof seconds !== 'number' || isNaN(seconds)) return '—';
        return formatLapTime(seconds);
    }

    // Public API
    return {
        init,
        loadSectors,
        getSectors: () => sectors,
        getSectorTimesForRun,
        renderSectorControls,
        confirmRemoveSector
    };
})();

window.AutocrossSectors = AutocrossSectors;

document.addEventListener('DOMContentLoaded', () => {
    AutocrossSectors.init();
});
