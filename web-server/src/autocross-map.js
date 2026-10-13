// Autocross Track Map - Canvas Rendering

const AutocrossMap = (function() {
    // Canvas and context
    let canvas = null;
    let ctx = null;

    // Current runs
    let currentRuns = [];
    let currentPositionIndex = 0;
    let currentTime = 0; // Track current playback time

    // View transform
    let viewBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let zoom = 1;
    // Zoom limits. Zoom 1 shows the whole course. Fully zoomed in shows about
    // MAX_ZOOM_VIEW metres across, so a short autocross and a long rally stage both
    // zoom to the same close-up detail.
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM_VIEW = 40; // metres across the shorter side of the map
    function maxZoom() {
        const worldWidth = viewBounds.maxX - viewBounds.minX;
        const worldHeight = viewBounds.maxY - viewBounds.minY;
        const side = Math.min(canvas.width, canvas.height);
        if (!(worldWidth > 0 && worldHeight > 0 && side > 0)) return 40;
        const fitScale = Math.min(canvas.width / worldWidth, canvas.height / worldHeight);
        return Math.max(4, side / MAX_ZOOM_VIEW / fitScale);
    }
    const clampZoom = z => Math.max(MIN_ZOOM, Math.min(maxZoom(), z));

    // Zoom slider position (0..1000) on a log scale, so each step feels the same
    const SLIDER_STEPS = 1000;
    const zoomToSlider = z => Math.round(Math.log(z / MIN_ZOOM) / Math.log(maxZoom() / MIN_ZOOM) * SLIDER_STEPS);
    const sliderToZoom = v => MIN_ZOOM * Math.pow(maxZoom() / MIN_ZOOM, v / SLIDER_STEPS);

    function syncZoomSlider() {
        const slider = document.getElementById('mapZoomSlider');
        if (slider) slider.value = zoomToSlider(zoom);
    }

    // Zoom about the cars (the middle of the cars on screen), else the middle of the map.
    // The point under the zoom centre stays where it is.
    function setZoom(z) {
        const newZoom = clampZoom(z);
        const k = newZoom / zoom;
        const f = zoomFocus();
        const cx = canvas.width / 2, cy = canvas.height / 2;
        offsetX = f.x - cx - (f.x - cx - offsetX) * k;
        offsetY = f.y - cy - (f.y - cy - offsetY) * k;
        zoom = newZoom;
        clampOffset();
        render();
    }

    function zoomFocus() {
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        const cars = currentRuns.map(run => {
            const t = alignRef ? AutocrossAlign.timeInRun(run, currentTime) : currentTime;
            const i = findClosestIndex(run.telemetry.timestamps, t);
            return worldToScreen(run.telemetry.posX[i], run.telemetry.posY[i]);
        }).filter(p => p.x >= 0 && p.y >= 0 && p.x <= canvas.width && p.y <= canvas.height);
        if (!cars.length) return { x: canvas.width / 2, y: canvas.height / 2 };
        return {
            x: cars.reduce((a, p) => a + p.x, 0) / cars.length,
            y: cars.reduce((a, p) => a + p.y, 0) / cars.length
        };
    }

    // Pan state
    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let mouseDownX = 0;
    let mouseDownY = 0;

    // Touch state
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoved = false;

    // Follow mode: the view stays centred on this run's car
    let followRunId = null;
    let gapPanelRows = []; // tap areas of the gap panel rows: { x, y, w, h, runId }

    // Loading state
    let isLoading = false;
    let loadingAngle = 0;
    let loadingAnimFrame = null;

    // Color palette (matching charts - 6 distinct colors)
    const COLORS = [
        '#4a9eff', // Blue
        '#ff4a4a', // Red
        '#4aff4a', // Green
        '#ffaa4a', // Orange
        '#ff4aff', // Magenta
        '#4affff'  // Cyan
    ];

    // Initialize map
    function init() {
        console.log('Initializing track map...');

        canvas = document.getElementById('trackMapCanvas');
        if (!canvas) {
            console.error('Track map canvas not found');
            return;
        }

        ctx = canvas.getContext('2d');

        // Setup canvas size
        resizeCanvas();

        // Setup event listeners
        setupEventListeners();

        // Initial render
        render();

        // Re-fit on window load to ensure proper sizing
        setTimeout(() => {
            resizeCanvas();
            if (currentRuns.length > 0) {
                fitToView();
            } else {
                render();
            }
        }, 100);

        console.log('Track map initialized');
    }

    // Setup event listeners
    function setupEventListeners() {
        // Play button
        document.getElementById('mapPlayBtn')?.addEventListener('click', () => {
            if (window.AutocrossScrubber) {
                window.AutocrossScrubber.togglePlayback();
            }
        });

        // Zoom controls
        document.getElementById('zoomInBtn')?.addEventListener('click', () => {
            setZoom(zoom * 1.2);
        });

        document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
            setZoom(zoom / 1.2);
        });

        document.getElementById('mapZoomSlider')?.addEventListener('input', (e) => {
            setZoom(sliderToZoom(Number(e.target.value)));
        });

        document.getElementById('fitBtn')?.addEventListener('click', () => {
            followRunId = null;
            fitToView();
        });

        document.getElementById('alignResetBtn')?.addEventListener('click', () => {
            if (window.AutocrossAlign) AutocrossAlign.clear();
        });

        // Pan controls (mouse)
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseUp);

        // Hover cursor for cars and sector markers
        canvas.addEventListener('mousemove', (e) => {
            if (isPanning) return;
            const rect = canvas.getBoundingClientRect();
            canvas.style.cursor = isClickable(e.clientX - rect.left, e.clientY - rect.top) ? 'pointer' : 'grab';
        });

        // Touch controls
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
        canvas.addEventListener('touchcancel', handleTouchEnd);

        // Wheel zoom
        canvas.addEventListener('wheel', handleWheel);

        // Resize
        window.addEventListener('resize', () => {
            resizeCanvas();
            // The zoom limit depends on the map's shape (e.g. after rotating the tablet)
            zoom = clampZoom(zoom);
            clampOffset();
            render();
        });
    }

    // Resize canvas to fit container
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        // Ensure canvas is interactive for both mouse and touch
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        canvas.style.userSelect = 'none';
        canvas.style.webkitUserSelect = 'none';
    }

    // Handle mouse down
    function handleMouseDown(e) {
        isPanning = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
        canvas.style.cursor = 'grabbing';
    }

    // Handle mouse move
    function handleMouseMove(e) {
        if (!isPanning) return;

        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) >= 5) followRunId = null;

        // Don't divide by zoom - maintain consistent screen-space pan speed
        offsetX += dx;
        offsetY += dy;

        // Clamp offset to prevent infinite panning
        clampOffset();

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        canvas.style.cursor = 'grabbing';

        render();
    }

    // Handle mouse up
    function handleMouseUp(e) {
        isPanning = false;

        // If the mouse barely moved, treat it as a click
        const dist = Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY);
        if (dist < 5) {
            const rect = canvas.getBoundingClientRect();
            handleMapClick(e.clientX - rect.left, e.clientY - rect.top);
        }

        // Restore cursor — pointer over a car or sector, otherwise grab
        const rect = canvas.getBoundingClientRect();
        canvas.style.cursor = isClickable(e.clientX - rect.left, e.clientY - rect.top) ? 'pointer' : 'grab';
    }

    // Handle wheel zoom
    function handleWheel(e) {
        e.preventDefault();

        setZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    }

    // Handle touch start
    function handleTouchStart(e) {
        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length === 1) {
            // Single touch - start panning (or a tap, if the finger does not move)
            isPanning = true;
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
            touchStartX = lastMouseX;
            touchStartY = lastMouseY;
            touchMoved = false;
            canvas.style.cursor = 'grabbing';
        } else {
            // More than one finger: no pinch zoom (use the zoom slider); stop panning
            isPanning = false;
            touchMoved = true;
        }
    }

    // Handle touch move
    function handleTouchMove(e) {
        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length === 1 && isPanning) {
            if (Math.hypot(e.touches[0].clientX - touchStartX, e.touches[0].clientY - touchStartY) > 8) {
                touchMoved = true;
                followRunId = null;
            }

            // Single touch panning
            const dx = e.touches[0].clientX - lastMouseX;
            const dy = e.touches[0].clientY - lastMouseY;

            // Don't divide by zoom - maintain consistent screen-space pan speed
            offsetX += dx;
            offsetY += dy;

            // Clamp offset to prevent infinite panning
            clampOffset();

            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;

            render();
        }
    }

    // Handle touch end
    function handleTouchEnd(e) {
        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length === 0) {
            // A touch that did not move is a tap
            if (isPanning && !touchMoved) {
                const rect = canvas.getBoundingClientRect();
                handleMapClick(touchStartX - rect.left, touchStartY - rect.top);
            }
            isPanning = false;
            canvas.style.cursor = 'grab';
        } else if (e.touches.length === 1) {
            // One finger lifted, restart panning with remaining finger
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
            isPanning = true;
        }
    }

    // Load single run
    function loadRun(run, options) {
        compareRuns([run], options);
    }

    // Compare multiple runs. With keepView, zoom, pan and playback position are kept.
    function compareRuns(runs, { keepView = false } = {}) {
        console.log('Comparing runs on map:', runs.map(r => r.runId));
        currentRuns = runs.slice(0, 6); // Max 6 runs
        if (followRunId && !currentRuns.some(r => r.runId === followRunId)) followRunId = null;
        if (keepView) {
            render();
            return;
        }
        currentPositionIndex = 0;
        currentTime = 0;
        fitToView();
        render();
    }

    // Fit view to show all runs
    function fitToView() {
        if (currentRuns.length === 0) {
            viewBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
            zoom = 1;
            offsetX = 0;
            offsetY = 0;
            return;
        }

        // Calculate bounds from all runs
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        currentRuns.forEach(run => {
            const { posX, posY } = run.telemetry;

            posX.forEach(x => {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            });

            posY.forEach(y => {
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            });
        });

        // Add padding as a percentage of the track size (10%)
        const widthRange = maxX - minX;
        const heightRange = maxY - minY;
        const paddingX = widthRange * 0.1;
        const paddingY = heightRange * 0.1;

        minX -= paddingX;
        maxX += paddingX;
        minY -= paddingY;
        maxY += paddingY;

        viewBounds = { minX, maxX, minY, maxY };

        // Reset transform
        zoom = 1;
        offsetX = 0;
        offsetY = 0;

        console.log('Fit to view bounds:', viewBounds);
        render();
    }

    // Clamp offset to prevent infinite panning
    function clampOffset() {
        if (currentRuns.length === 0) return;

        // Calculate world dimensions
        const worldWidth = viewBounds.maxX - viewBounds.minX;
        const worldHeight = viewBounds.maxY - viewBounds.minY;

        // Calculate current scale with zoom applied
        const scaleX = canvas.width / worldWidth;
        const scaleY = canvas.height / worldHeight;
        const currentScale = Math.min(scaleX, scaleY) * zoom;

        // Calculate how much the track takes up in screen space at current zoom
        const trackScreenWidth = worldWidth * currentScale;
        const trackScreenHeight = worldHeight * currentScale;

        // Keep at least 20% of the track visible on screen
        const minVisiblePercent = 0.2;
        const minVisibleWidth = trackScreenWidth * minVisiblePercent;
        const minVisibleHeight = trackScreenHeight * minVisiblePercent;

        // Calculate max offset in screen pixels: allow panning until only minVisible portion remains on screen
        // offsets are now in screen pixels, so no division by zoom needed
        const maxOffsetX = (trackScreenWidth - minVisibleWidth) / 2;
        const maxOffsetY = (trackScreenHeight - minVisibleHeight) / 2;

        offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, offsetX));
        offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, offsetY));
    }

    // World to screen transformation
    function worldToScreen(x, y) {
        const width = canvas.width;
        const height = canvas.height;

        if (width === 0 || height === 0) {
            return { x: 0, y: 0 };
        }

        const worldWidth = viewBounds.maxX - viewBounds.minX;
        const worldHeight = viewBounds.maxY - viewBounds.minY;

        if (worldWidth === 0 || worldHeight === 0) {
            return { x: width / 2, y: height / 2 };
        }

        // Calculate scale to fit in canvas (maintain aspect ratio)
        const scaleX = width / worldWidth;
        const scaleY = height / worldHeight;
        scale = Math.min(scaleX, scaleY) * zoom;

        // Center in canvas
        const centerX = width / 2;
        const centerY = height / 2;
        const worldCenterX = (viewBounds.minX + viewBounds.maxX) / 2;
        const worldCenterY = (viewBounds.minY + viewBounds.maxY) / 2;

        // offsetX and offsetY are now in screen pixels, not world units
        const screenX = centerX + (x - worldCenterX) * scale + offsetX;
        const screenY = centerY + (y - worldCenterY) * scale + offsetY;

        return { x: screenX, y: screenY };
    }

    // Render the map
    function render() {
        if (!ctx) return;
        syncZoomSlider();

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (currentRuns.length === 0) {
            if (isLoading) {
                drawLoadingSpinner();
            } else {
                ctx.fillStyle = '#888';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Select a run to view track map', canvas.width / 2, canvas.height / 2);
            }
            return;
        }

        applyFollow();

        // Create array with run data and original indices for color mapping
        // Note: currentRuns is already sorted by speed (fastest first) from loadSelectedRuns()
        const runsWithIndices = currentRuns.map((run, index) => ({
            run,
            colorIndex: index, // Color assignment based on speed order (fastest gets first color)
            scratchTime: run.lapTime,
            isMostRecent: run.isMostRecent || false
        }));

        // Drawing order: slowest to fastest scratch time (no cone penalties), so the fastest is on top
        const sortedRuns = [...runsWithIndices].sort((a, b) => b.scratchTime - a.scratchTime);

        // The followed run is drawn above all others
        const followIndex = sortedRuns.findIndex(item => item.run.runId === followRunId);
        if (followIndex !== -1) sortedRuns.push(sortedRuns.splice(followIndex, 1)[0]);

        // Draw each run in sorted order (slowest first, fastest/followed last)
        sortedRuns.forEach(({ run, colorIndex }) => {
            drawRun(run, runColor(run, colorIndex), 1);
        });

        // Start, finish and sector lines, under the cars
        drawStartFinish(window.AutocrossAlign && AutocrossAlign.getReference() || currentRuns[0]);
        drawSectorMarkers();

        // Draw position markers for all runs (color-matched).
        // Time mode: every car at the same clock time. Align mode: every car at its own time,
        // shifted so all cars were together at the anchor. Gaps are to the aligned run (time
        // gained or lost since the anchor), else to the fastest run.
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        const gapRef = alignRef || sortByAdjustedTime(currentRuns)[0];
        const gaps = [];
        sortedRuns.forEach(({ run, colorIndex }) => {
            const color = runColor(run, colorIndex);
            const runTime = alignRef ? AutocrossAlign.timeInRun(run, currentTime) : currentTime;
            const runIndex = findClosestIndex(run.telemetry.timestamps, runTime);
            drawPositionMarker(run, runIndex, color);

            if (!gapRef) return;
            if (run.runId === gapRef.runId) {
                if (alignRef) {
                    drawReferenceRing(worldToScreen(run.telemetry.posX[runIndex], run.telemetry.posY[runIndex]));
                }
            } else {
                // Gaps are measured from the start line, so none during the launch
                const gap = currentTime < 0 ? null
                    : timeGap(gapRef, run, currentTime, alignRef ? AutocrossAlign.offsetOf(run) : 0);
                gaps.push({ gap, color, runId: run.runId, runNumber: runNumberOf(run), adjustedTime: getAdjustedTime(run) });
            }
        });

        if (gapRef) {
            drawGapPanel(gapRef, gaps.sort((a, b) => a.adjustedTime - b.adjustedTime));
        }


        updateAlignButton(alignRef);
        updateLegend();
    }

    // Time gap of run to ref where ref is at refTime: + behind, - ahead.
    // Progress along the reference path is cached per reference and run.
    let gapCache = { refId: null, dist: null, progress: new Map() };
    // offset: the run's alignment shift (align mode), so the gap counts from the anchor
    function timeGap(ref, run, refTime, offset = 0) {
        if (gapCache.refId !== ref.runId || gapCache.runs !== currentRuns) {
            gapCache = {
                refId: ref.runId,
                runs: currentRuns,
                dist: AutocrossTrack.cumulativeDistance(ref.telemetry.posX, ref.telemetry.posY),
                progress: new Map()
            };
        }
        if (!gapCache.progress.has(run.runId)) {
            gapCache.progress.set(run.runId, AutocrossTrack.progressAlongPath(ref.telemetry, gapCache.dist, run.telemetry));
        }

        const t = Math.min(refTime, ref.telemetry.timestamps.at(-1));
        const dist = AutocrossTrack.interpolate(ref.telemetry.timestamps, gapCache.dist, t);
        const progress = gapCache.progress.get(run.runId);
        let runT = AutocrossTrack.timeAtProgress(dist, progress, run.telemetry.timestamps);
        // A run that ended within a few metres of the point (a different line to the finish) got there
        if (runT === null && dist - progress[progress.length - 1] < 5) runT = run.telemetry.timestamps.at(-1);
        // Not there yet: the gap is at least the time since the reference passed
        return runT === null ? refTime - t : runT - t - offset;
    }

    function runColor(run, colorIndex) {
        return run.color || (run.isMostRecent ? '#7d5aff' : COLORS[colorIndex % COLORS.length]);
    }

    // Ring around the car that the others are aligned to
    function drawReferenceRing(pos) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, arrowSize() * 0.7 + 3, 0, Math.PI * 2);
        ctx.stroke();
    }

    function runNumberOf(run) {
        return run.runNumber || AutocrossApp.getRunNumber(run.runId);
    }

    // Fixed panel in the top-left corner: the reference run, then each run's time gap to it,
    // + behind (red), - ahead (green). Tap a row to follow that car.
    function drawGapPanel(ref, gaps) {
        const PAD = 6, ROW = 28, X = 10, Y = 10;
        ctx.font = 'bold 14px Arial';
        ctx.textBaseline = 'middle';

        const rows = [{ runId: ref.runId, label: `Run ${runNumberOf(ref)}`, text: '', color: ref.color || '#ffffff' }]
            .concat(gaps.map(g => ({
                runId: g.runId,
                label: `Run ${g.runNumber}`,
                text: g.gap === null ? '' : `${g.gap >= 0 ? '+' : '−'}${Math.abs(g.gap).toFixed(2)}`,
                color: g.color,
                textColor: g.gap > 0.005 ? '#ff6b6b' : (g.gap < -0.005 ? '#5dff7a' : '#ffffff')
            })));

        const labelW = Math.max(...rows.map(r => ctx.measureText(r.label).width));
        const textW = Math.max(...rows.map(r => ctx.measureText(r.text).width));
        const w = PAD * 2 + 22 + labelW + 14 + textW + 8;
        const h = PAD * 2 + rows.length * ROW;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(X, Y, w, h);

        gapPanelRows = [];
        rows.forEach((r, i) => {
            const top = Y + PAD + i * ROW;
            const y = top + ROW / 2;
            gapPanelRows.push({ x: X, y: top, w, h: ROW, runId: r.runId });

            if (r.runId === followRunId) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(X + 3, top + 2, w - 6, ROW - 4);
            }

            ctx.fillStyle = r.color;
            ctx.beginPath();
            ctx.arc(X + PAD + 9, y, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(r.label, X + PAD + 22, y);

            ctx.textAlign = 'right';
            ctx.fillStyle = r.textColor || '#ffffff';
            ctx.fillText(r.text, X + w - PAD - 4, y);
        });
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    function getPanelRowAt(sx, sy) {
        return gapPanelRows.find(r => sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) || null;
    }

    // Tap a gap panel row to follow that car, tap it again to stop
    function toggleFollow(runId) {
        if (followRunId === runId) {
            followRunId = null;
        } else {
            followRunId = runId;
            if (zoom < 2) zoom = 3; // following only helps when zoomed in
        }
        render();
    }

    // Centre the view on the followed car
    function applyFollow() {
        const run = followRunId && currentRuns.find(r => r.runId === followRunId);
        if (!run) return;

        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        const t = alignRef ? AutocrossAlign.timeInRun(run, currentTime) : currentTime;
        const idx = findClosestIndex(run.telemetry.timestamps, t);

        offsetX = 0;
        offsetY = 0;
        const p = worldToScreen(run.telemetry.posX[idx], run.telemetry.posY[idx]);
        offsetX = canvas.width / 2 - p.x;
        offsetY = canvas.height / 2 - p.y;
    }

    function updateAlignButton(alignRef) {
        const btn = document.getElementById('alignResetBtn');
        if (!btn) return;
        btn.classList.toggle('hidden', !alignRef);
        if (alignRef) {
            btn.textContent = `Aligned to Run ${runNumberOf(alignRef)} ✕`;
            btn.style.borderColor = alignRef.color || '';
        }
    }

    // Return the run whose car marker is under a screen point, or null
    function getRunAtScreenPoint(sx, sy) {
        const HIT_RADIUS = 20; // px, sized for a finger
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        let best = null, bestDist = HIT_RADIUS;
        currentRuns.forEach(run => {
            const runTime = alignRef ? AutocrossAlign.timeInRun(run, currentTime) : currentTime;
            const idx = findClosestIndex(run.telemetry.timestamps, runTime);
            const p = worldToScreen(run.telemetry.posX[idx], run.telemetry.posY[idx]);
            const d = Math.hypot(sx - p.x, sy - p.y);
            if (d <= bestDist) { bestDist = d; best = run; }
        });
        return best;
    }

    function isClickable(sx, sy) {
        return Boolean(getPanelRowAt(sx, sy) || getRunAtScreenPoint(sx, sy) || getSectorAtScreenPoint(sx, sy));
    }

    // Return the sector under a screen point, or null
    function getSectorAtScreenPoint(sx, sy) {
        if (!window.AutocrossSectors) return null;
        const sectors = AutocrossSectors.getSectors();
        if (!sectors || sectors.length === 0) return null;

        const HIT_RADIUS = 18; // px

        for (const sector of sectors) {
            const p = worldToScreen(sector.posX, sector.posY);
            const dist = Math.hypot(sx - p.x, sy - p.y);
            if (dist <= HIT_RADIUS) return sector;
        }
        return null;
    }

    // Handle a click on the map canvas: a car toggles align mode, a sector marker asks to remove it
    function handleMapClick(sx, sy) {
        const row = getPanelRowAt(sx, sy);
        if (row) {
            toggleFollow(row.runId);
            return;
        }

        const run = getRunAtScreenPoint(sx, sy);
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        // Tapping the aligned car always leaves align mode; aligning needs two runs
        if (run && window.AutocrossAlign && (currentRuns.length > 1 || (alignRef && alignRef.runId === run.runId))) {
            const ref = alignRef;
            if (ref && ref.runId === run.runId) {
                AutocrossAlign.clear();
            } else {
                // Line up at this car's position now; while aligned, its time is offset from the timeline
                AutocrossAlign.setReference(run, alignRef ? AutocrossAlign.timeInRun(run, currentTime) : currentTime);
            }
            return;
        }

        const sector = getSectorAtScreenPoint(sx, sy);
        if (sector && window.AutocrossSectors) {
            AutocrossSectors.confirmRemoveSector(sector);
        }
    }

    // Draw sector boundary markers as perpendicular tick lines
    function drawSectorMarkers() {
        if (!window.AutocrossSectors) return;
        const sectors = AutocrossSectors.getSectors();
        if (!sectors || sectors.length === 0) return;

        const refRun = currentRuns[0];

        sectors.forEach((sector, i) => {
            const p = worldToScreen(sector.posX, sector.posY);

            // Gate line runs across the track: use the stored direction, else the reference run
            let perpAngle = Math.PI / 2; // default: vertical
            if (sector.dirX !== undefined && sector.dirY !== undefined) {
                const ahead = worldToScreen(sector.posX + sector.dirX, sector.posY + sector.dirY);
                perpAngle = Math.atan2(ahead.y - p.y, ahead.x - p.x) + Math.PI / 2;
            } else if (refRun) {
                const idx = findClosestPositionIndex(refRun, sector.posX, sector.posY);
                const nextIdx = Math.min(idx + 1, refRun.telemetry.posX.length - 1);
                const prev = worldToScreen(refRun.telemetry.posX[idx], refRun.telemetry.posY[idx]);
                const next = worldToScreen(refRun.telemetry.posX[nextIdx], refRun.telemetry.posY[nextIdx]);
                const trackAngle = Math.atan2(next.y - prev.y, next.x - prev.x);
                perpAngle = trackAngle + Math.PI / 2;
            }

            const tickLen = 14;
            const dx = Math.cos(perpAngle) * tickLen;
            const dy = Math.sin(perpAngle) * tickLen;

            // Tick line across the track
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p.x - dx, p.y - dy);
            ctx.lineTo(p.x + dx, p.y + dy);
            ctx.stroke();

            // Small center dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();

            // Label offset to the side of the tick
            const labelOffset = tickLen + 8;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`S${i + 1}`, p.x + Math.cos(perpAngle) * labelOffset, p.y + Math.sin(perpAngle) * labelOffset);
            ctx.textBaseline = 'alphabetic';
        });
    }

    // Start line where the run's timer started (time 0), finish line where it stopped
    function drawStartFinish(run) {
        if (!run) return;
        const { posX, posY, timestamps } = run.telemetry;
        const n = posX.length;
        if (n < 2) return;

        // Point at time 0, and the track direction from there
        const startIdx = Math.max(0, timestamps.findIndex(t => t >= 0));
        const sx = AutocrossTrack.interpolate(timestamps, posX, 0);
        const sy = AutocrossTrack.interpolate(timestamps, posY, 0);
        let ahead = startIdx;
        while (ahead < n - 1 && Math.hypot(posX[ahead] - sx, posY[ahead] - sy) < 1) ahead++;

        // Start and finish on the same line (closed course): one line, one label
        const sameLine = Math.hypot(posX[n - 1] - sx, posY[n - 1] - sy) < 10;
        drawGateLine(sx, sy, posX[ahead] - sx, posY[ahead] - sy, sameLine ? 'START / FINISH' : 'START');
        if (sameLine) return;

        let behind = n - 2;
        while (behind > 0 && Math.hypot(posX[n - 1] - posX[behind], posY[n - 1] - posY[behind]) < 1) behind--;
        drawGateLine(posX[n - 1], posY[n - 1], posX[n - 1] - posX[behind], posY[n - 1] - posY[behind], 'FINISH');
    }

    // Line across the track at a world point, with the track direction and a label
    function drawGateLine(x, y, dirX, dirY, label) {
        const p = worldToScreen(x, y);
        const a = worldToScreen(x + dirX, y + dirY);
        const perp = Math.atan2(a.y - p.y, a.x - p.x) + Math.PI / 2;
        const len = 18;
        const dx = Math.cos(perp) * len;
        const dy = Math.sin(perp) * len;

        ctx.save();
        ctx.lineCap = 'butt';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(p.x - dx, p.y - dy);
        ctx.lineTo(p.x + dx, p.y + dy);
        ctx.stroke();
        // Chequered look: black dashes over the white line
        ctx.strokeStyle = '#000000';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(p.x - dx, p.y - dy);
        ctx.lineTo(p.x + dx, p.y + dy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, p.x + Math.cos(perp) * (len + 16), p.y + Math.sin(perp) * (len + 16));
        ctx.restore();
    }

    // Find telemetry index closest to a world position
    function findClosestPositionIndex(run, targetX, targetY) {
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

    // Draw a single run
    function drawRun(run, color, opacity) {
        const { posX, posY, speed } = run.telemetry;

        if (posX.length < 2) return;

        ctx.globalAlpha = opacity;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw line with solid color
        ctx.strokeStyle = color;
        ctx.beginPath();

        for (let i = 0; i < posX.length; i++) {
            const p = worldToScreen(posX[i], posY[i]);
            if (i === 0) {
                ctx.moveTo(p.x, p.y);
            } else {
                ctx.lineTo(p.x, p.y);
            }
        }

        ctx.stroke();

        ctx.globalAlpha = 1;
    }

    // Draw position marker
    // Arrow length in pixels: about a car's length on the map, so it grows with zoom,
    // kept between a visible minimum and a maximum
    const ARROW_WORLD_LENGTH = 6; // metres
    function arrowSize() {
        return Math.max(13, Math.min(36, ARROW_WORLD_LENGTH * scale));
    }

    // Car marker: an arrow in the run's color pointing the way the car is driving
    function drawPositionMarker(run, index, color) {
        if (index < 0 || index >= run.telemetry.posX.length) return;

        const pos = worldToScreen(run.telemetry.posX[index], run.telemetry.posY[index]);
        const dir = AutocrossTrack.directionIndices(run.telemetry, index);
        let angle = -Math.PI / 2;
        if (dir) {
            const a = worldToScreen(run.telemetry.posX[dir[0]], run.telemetry.posY[dir[0]]);
            const b = worldToScreen(run.telemetry.posX[dir[1]], run.telemetry.posY[dir[1]]);
            angle = Math.atan2(b.y - a.y, b.x - a.x);
        }

        const points = AutocrossTrack.carArrowPolygon(pos.x, pos.y, angle, arrowSize());
        ctx.beginPath();
        points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    // Get color based on speed
    function getSpeedColor(speed) {
        // Blue (slow) to Red (fast)
        const minSpeed = 0;
        const maxSpeed = 100;

        const ratio = Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed)));

        // Interpolate between blue and red
        const r = Math.round(ratio * 255);
        const b = Math.round((1 - ratio) * 255);
        const g = 0;

        return `rgb(${r}, ${g}, ${b})`;
    }

    // Update legend
    function updateLegend() {
        const legend = document.getElementById('mapLegend');
        if (!legend) return;

        legend.innerHTML = '';

        if (currentRuns.length === 0) return;

        currentRuns.forEach((run, index) => {
            const item = document.createElement('div');
            item.className = 'legend-item';

            const colorBox = document.createElement('div');
            colorBox.className = 'legend-color';
            colorBox.style.backgroundColor = runColor(run, index);

            const label = document.createElement('span');
            const lapTime = formatLapTime(run.lapTime);
            const runNumber = run.runNumber || (index + 1);
            label.textContent = `Run ${runNumber}: ${lapTime}`;

            item.appendChild(colorBox);
            item.appendChild(label);
            legend.appendChild(item);
        });
    }

    // Seek to specific time
    function seekTo(time) {
        if (currentRuns.length === 0) return;

        // Store the current time - each run will find its own position
        currentTime = time;

        // Legacy: still calculate index for backwards compatibility
        const timestamps = currentRuns[0].telemetry.timestamps;
        const index = findClosestIndex(timestamps, time);
        currentPositionIndex = index;

        render();
    }

    // Find closest index in array
    function findClosestIndex(arr, value) {
        let lo = 0, hi = arr.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] < value) lo = mid + 1; else hi = mid;
        }
        if (lo > 0 && Math.abs(arr[lo - 1] - value) < Math.abs(arr[lo] - value)) {
            return lo - 1;
        }
        return lo;
    }

    // Format lap time
    function formatLapTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(3);
        return `${mins}:${secs.padStart(6, '0')}`;
    }

    // Loading spinner
    function drawLoadingSpinner() {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const r = 22;

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, loadingAngle, loadingAngle + Math.PI * 0.75);
        ctx.stroke();
    }

    function setLoading(state) {
        isLoading = state;
        if (state) {
            if (loadingAnimFrame) return; // already animating
            const animate = () => {
                if (!isLoading) { loadingAnimFrame = null; return; }
                loadingAngle += 0.08;
                ctx.fillStyle = '#1a1a1a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                drawLoadingSpinner();
                loadingAnimFrame = requestAnimationFrame(animate);
            };
            loadingAnimFrame = requestAnimationFrame(animate);
        } else {
            loadingAnimFrame = null;
            render();
        }
    }

    // Clear map
    function clear() {
        currentRuns = [];
        currentPositionIndex = 0;
        currentTime = 0;
        render();
    }

    // Public API
    return {
        init,
        loadRun,
        compareRuns,
        seekTo,
        clear,
        render,
        setLoading
    };
})();

// Export to window
window.AutocrossMap = AutocrossMap;

// Initialize map when page loads
document.addEventListener('DOMContentLoaded', () => {
    AutocrossMap.init();
});
