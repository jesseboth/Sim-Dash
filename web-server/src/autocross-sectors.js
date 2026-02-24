// Autocross Sectors - Sector management, comparison modal, and mini-map playback

const AutocrossSectors = (function () {

    // --- State ---
    let sectors = [];           // [{sectorId, name, posX, posY}]
    let currentCourseId = null;

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
        sectors = [];
        if (!courseId) {
            renderSectorControls();
            return;
        }
        try {
            const result = await apiRequest('getSectors', { courseId });
            sectors = result || [];
        } catch (e) {
            sectors = [];
        }
        renderSectorControls();
        if (window.AutocrossMap) AutocrossMap.render();
    }

    async function persistSectors() {
        if (!currentCourseId) return;
        try {
            await apiRequest('saveSectors', { courseId: currentCourseId, sectors });
        } catch (e) {
            console.error('Failed to save sectors:', e);
        }
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

        // Use the frontmost run — whichever loaded run has traveled furthest by this time
        const frontRun = getFrontmostRun(time) || run;
        const idx = findIndexAtTime(frontRun, time);
        const posX = frontRun.telemetry.posX[idx];
        const posY = frontRun.telemetry.posY[idx];

        // Store track direction so crossing detection works for non-overlapping runs
        const nextIdx = Math.min(idx + 3, frontRun.telemetry.posX.length - 1);
        const dx = frontRun.telemetry.posX[nextIdx] - posX;
        const dy = frontRun.telemetry.posY[nextIdx] - posY;
        const len = Math.hypot(dx, dy) || 1;
        const dirX = dx / len;
        const dirY = dy / len;

        const sectorId = `s-${Date.now()}`;
        const sectorNum = sectors.length + 1;
        sectors.push({ sectorId, name: `Sector ${sectorNum}`, posX, posY, dirX, dirY });

        // Sort sectors by time they appear in the reference run
        sortSectorsByRun(run);

        persistSectors();
        renderSectorControls();
        refreshVisualizations();
    }

    function removeSector(sectorId) {
        sectors = sectors.filter(s => s.sectorId !== sectorId);
        // Rename remaining sectors
        sectors.forEach((s, i) => { s.name = `Sector ${i + 1}`; });
        persistSectors();
        renderSectorControls();
        refreshVisualizations();
    }

    function refreshVisualizations() {
        if (window.AutocrossScrubber) AutocrossScrubber.render();
        if (window.AutocrossMap) AutocrossMap.render();
    }

    function sortSectorsByRun(run) {
        // Sort by the time the reference run passes through each sector position
        sectors.sort((a, b) => {
            const ta = findTimeAtPosition(run, a.posX, a.posY);
            const tb = findTimeAtPosition(run, b.posX, b.posY);
            return ta - tb;
        });
        // Re-number after sort
        sectors.forEach((s, i) => { s.name = `Sector ${i + 1}`; });
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

        const sectorBounds = getSectorBounds();

        // Build header — sector columns are clickable to select for map playback
        let thead = '<thead><tr><th>Run</th><th>Total</th>';
        sectorBounds.forEach((sb, i) => {
            const active = i === activeSectorIndex ? ' sector-col-active' : '';
            const label = i === 0 ? 'Sector 1' : `Sector ${i + 1}`;
            thead += `<th class="sector-col-header${active}" data-sector-index="${i}">${label}</th>`;
        });
        thead += '</tr></thead>';

        // Compute sector times per run
        const runSectorTimes = modalRuns.map(run => ({
            run,
            sectorTimes: sectorBounds.map(sb => computeSectorTime(run, sb.startPos, sb.endPos))
        }));

        // Find best time per sector
        const bestSectorTimes = sectorBounds.map((_, si) => {
            const times = runSectorTimes.map(r => r.sectorTimes[si]).filter(t => t !== null);
            return times.length > 0 ? Math.min(...times) : null;
        });

        // Optimal total = sum of best sector times
        const optimalTotal = bestSectorTimes.every(t => t !== null)
            ? bestSectorTimes.reduce((a, b) => a + b, 0)
            : null;

        // Build body rows
        let tbody = '<tbody>';
        runSectorTimes.forEach(({ run, sectorTimes }, ri) => {
            const cones = run.cones || 0;
            const total = run.lapTime + (cones * 2);
            const label = run.name || `Run #${run.runNumber || (ri + 1)}`;
            const color = COLORS[ri % COLORS.length];
            const coneTag = cones > 0 ? ` <span class="sector-cone-badge">+${cones}</span>` : '';
            tbody += `<tr>`;
            tbody += `<td><span class="sector-run-dot" style="background:${color}"></span>${escapeHtml(label)}</td>`;
            tbody += `<td>${formatTime(total)}${coneTag}</td>`;
            sectorTimes.forEach((t, si) => {
                const best = bestSectorTimes[si];
                const isBest = t !== null && best !== null && Math.abs(t - best) < 0.001;
                const delta = (t !== null && best !== null && !isBest) ? (t - best) : null;
                let cls = isBest ? 'sector-best' : '';
                let content = t !== null ? formatTime(t) : '—';
                if (delta !== null) content += `<br><span class="sector-delta">+${delta.toFixed(3)}</span>`;
                tbody += `<td class="sector-col sector-col-${si} ${cls}" data-sector-index="${si}">${content}</td>`;
            });
            tbody += `</tr>`;
        });

        // Optimal row — just the total, sector cells are blank (best times already shown green above)
        if (optimalTotal !== null) {
            tbody += `<tr class="sector-optimal-row"><td>Optimal</td><td>${formatTime(optimalTotal)}</td>`;
            sectorBounds.forEach((_, si) => { tbody += `<td class="sector-col sector-col-${si}" data-sector-index="${si}"></td>`; });
            tbody += `</tr>`;
        }

        tbody += '</tbody>';
        table.innerHTML = thead + tbody;

        // Single delegated listener — any header or cell with data-sector-index selects that sector
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

    // --- Sector bounds ---
    // Each bound is {startPos: {posX, posY} | null, endPos: {posX, posY} | null}
    // startPos null = start of run (t=0), endPos null = end of run
    function getSectorBounds() {
        if (sectors.length === 0) return [];
        const bounds = [];
        // First sector: start of run → first marker
        bounds.push({ startPos: null, endPos: sectors[0] });
        // Remaining sectors: marker[i] → marker[i+1] (last → end of run)
        for (let i = 0; i < sectors.length; i++) {
            bounds.push({
                startPos: sectors[i],
                endPos: i + 1 < sectors.length ? sectors[i + 1] : null
            });
        }
        return bounds;
    }

    // Compute sector time for a run using virtual gate crossing where possible
    function computeSectorTime(run, startSector, endSector) {
        const ts = run.telemetry.timestamps;
        const startTime = startSector ? findTimeAtGate(run, startSector) : ts[0];
        const endTime = endSector
            ? findTimeAtGate(run, endSector)
            : ts[ts.length - 1];
        if (endTime <= startTime) return null;
        return endTime - startTime;
    }

    // Find the time a run crosses a sector gate.
    // If the sector has a stored direction, use perpendicular-line crossing detection
    // (accurate regardless of which line the car took). Falls back to nearest-neighbour.
    function findTimeAtGate(run, sector) {
        if (sector.dirX !== undefined && sector.dirY !== undefined) {
            const t = findGateCrossingTime(run, sector.posX, sector.posY, sector.dirX, sector.dirY);
            if (t !== null) return t;
        }
        return findTimeAtPosition(run, sector.posX, sector.posY);
    }

    // Gate crossing: find when the run path crosses the line through (gateX, gateY)
    // perpendicular to (dirX, dirY). Uses segment intersection + linear interpolation.
    // MAX_GATE_WIDTH limits how far to either side of the gate centre a crossing can be,
    // preventing false matches from runs that pass far away from the gate.
    const MAX_GATE_WIDTH = 30; // metres

    function findGateCrossingTime(run, gateX, gateY, dirX, dirY) {
        // Gate normal is perpendicular to track direction
        const nx = -dirY;
        const ny =  dirX;

        const { posX, posY, timestamps } = run.telemetry;

        let bestTime = null;
        let bestLateralDist = Infinity;

        for (let i = 0; i < posX.length - 1; i++) {
            // Signed distance of each point from the gate line
            const d0 = nx * (posX[i]     - gateX) + ny * (posY[i]     - gateY);
            const d1 = nx * (posX[i + 1] - gateX) + ny * (posY[i + 1] - gateY);

            // Segment crosses the gate line when signs differ
            if (d0 * d1 > 0) continue;

            const t = d0 / (d0 - d1);   // interpolation fraction [0,1]
            const crossX = posX[i] + t * (posX[i + 1] - posX[i]);
            const crossY = posY[i] + t * (posY[i + 1] - posY[i]);

            // Lateral distance from the crossing point to the gate centre
            // (rules out crossings on the infinite line far from the actual gate)
            const latDist = Math.hypot(crossX - gateX, crossY - gateY);

            if (latDist < MAX_GATE_WIDTH && latDist < bestLateralDist) {
                bestLateralDist = latDist;
                bestTime = timestamps[i] + t * (timestamps[i + 1] - timestamps[i]);
            }
        }

        return bestTime;
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
        if (activeSectorIndex < 0 || activeSectorIndex >= sectors.length) return;
        const sectorBounds = getSectorBounds();
        const sb = sectorBounds[activeSectorIndex];

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        modalRuns.forEach(run => {
            const startTime = sb.startPos ? findTimeAtGate(run, sb.startPos) : run.telemetry.timestamps[0];
            const endTime = sb.endPos ? findTimeAtGate(run, sb.endPos) : run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const startIdx = findClosestTimeIndex(run.telemetry.timestamps, startTime);
            const endIdx = findClosestTimeIndex(run.telemetry.timestamps, endTime);

            const from = Math.min(startIdx, endIdx);
            const to = Math.max(startIdx, endIdx);

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

        const sectorBounds = getSectorBounds();
        const sb = sectorBounds[activeSectorIndex];
        if (!sb) return;

        // Sort draw order so fastest sector run is drawn last (on top)
        const drawOrder = modalRuns
            .map((run, ri) => ({ run, ri, t: computeSectorTime(run, sb.startPos, sb.endPos) ?? Infinity }))
            .sort((a, b) => b.t - a.t);  // slowest first, fastest last (on top)

        // Draw full track (faded) then sector portion (bright) for each run
        drawOrder.forEach(({ run, ri }) => {
            const color = COLORS[ri % COLORS.length];
            drawRunSegment(run, null, null, color, 0.15);  // full track faded
            const startTime = sb.startPos ? findTimeAtGate(run, sb.startPos) : run.telemetry.timestamps[0];
            const endTime = sb.endPos ? findTimeAtGate(run, sb.endPos) : run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const startIdx = findClosestTimeIndex(run.telemetry.timestamps, startTime);
            const endIdx = findClosestTimeIndex(run.telemetry.timestamps, endTime);
            drawRunSegment(run, Math.min(startIdx, endIdx), Math.max(startIdx, endIdx), color, 1.0);
        });

        // Draw animated position markers (same order — fastest on top)
        const speedReadouts = [];
        drawOrder.forEach(({ run, ri }) => {
            const color = COLORS[ri % COLORS.length];
            const startTime = sb.startPos ? findTimeAtGate(run, sb.startPos) : run.telemetry.timestamps[0];
            const endTime = sb.endPos ? findTimeAtGate(run, sb.endPos) : run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
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
        const sectorBounds = getSectorBounds();
        const sb = sectorBounds[activeSectorIndex];
        if (!sb) return;

        const durations = modalRuns.map(run => {
            const t = computeSectorTime(run, sb.startPos, sb.endPos);
            return t !== null ? t : 0;
        });
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
    function findTimeAtPosition(run, targetX, targetY) {
        const idx = findIndexAtPosition(run, targetX, targetY);
        return run.telemetry.timestamps[idx];
    }

    function findIndexAtPosition(run, targetX, targetY) {
        const { posX, posY } = run.telemetry;
        let minDist = Infinity, bestIdx = 0;
        for (let i = 0; i < posX.length; i++) {
            const dx = posX[i] - targetX;
            const dy = posY[i] - targetY;
            const d = dx * dx + dy * dy;
            if (d < minDist) { minDist = d; bestIdx = i; }
        }
        return bestIdx;
    }

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

    // --- For scrubber: get sector marker times for a given run ---
    function getSectorTimesForRun(run) {
        if (!run || sectors.length === 0) return [];
        return sectors.map(s => findTimeAtPosition(run, s.posX, s.posY));
    }

    // --- Utils ---
    function formatTime(seconds) {
        if (typeof seconds !== 'number' || isNaN(seconds)) return '—';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.round((seconds % 1) * 1000);
        return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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
