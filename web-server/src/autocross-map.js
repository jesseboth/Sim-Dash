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

    // Pan state
    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // Touch state
    let lastTouchDistance = 0;

    // Rendering preferences
    let mostRecentOnTop = true;

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
        // Load saved preference
        const savedPreference = localStorage.getItem('mostRecentOnTop');
        if (savedPreference !== null) {
            mostRecentOnTop = savedPreference === 'true';
        }

        // Set toggle initial state
        const toggle = document.getElementById('mostRecentOnTopToggle');
        if (toggle) {
            toggle.checked = mostRecentOnTop;
            toggle.addEventListener('change', (e) => {
                mostRecentOnTop = e.target.checked;
                localStorage.setItem('mostRecentOnTop', mostRecentOnTop);
                render();
            });
        }

        // Play button
        document.getElementById('mapPlayBtn')?.addEventListener('click', () => {
            if (window.AutocrossScrubber) {
                window.AutocrossScrubber.togglePlayback();
            }
        });

        // Zoom controls
        document.getElementById('zoomInBtn')?.addEventListener('click', () => {
            zoom *= 1.2;
            clampOffset();
            render();
        });

        document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
            zoom /= 1.2;
            clampOffset();
            render();
        });

        document.getElementById('fitBtn')?.addEventListener('click', fitToView);

        // Pan controls (mouse)
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseUp);

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
            if (currentRuns.length > 0) {
                // Maintain the current view when resizing
                render();
            } else {
                render();
            }
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
        canvas.style.cursor = 'grabbing';
    }

    // Handle mouse move
    function handleMouseMove(e) {
        if (!isPanning) return;

        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;

        // Don't divide by zoom - maintain consistent screen-space pan speed
        offsetX += dx;
        offsetY += dy;

        // Clamp offset to prevent infinite panning
        clampOffset();

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        render();
    }

    // Handle mouse up
    function handleMouseUp() {
        isPanning = false;
        canvas.style.cursor = 'grab';
    }

    // Handle wheel zoom
    function handleWheel(e) {
        e.preventDefault();

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoom *= delta;
        zoom = Math.max(0.1, Math.min(10, zoom));

        clampOffset();
        render();
    }

    // Handle touch start
    function handleTouchStart(e) {
        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length === 1) {
            // Single touch - start panning
            isPanning = true;
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
            canvas.style.cursor = 'grabbing';
        } else if (e.touches.length === 2) {
            // Two touches - prepare for pinch zoom
            isPanning = false;
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            lastTouchDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
        }
    }

    // Handle touch move
    function handleTouchMove(e) {
        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length === 1 && isPanning) {
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
        } else if (e.touches.length === 2) {
            // Pinch zoom
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const distance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );

            if (lastTouchDistance > 0) {
                const delta = distance / lastTouchDistance;
                zoom *= delta;
                zoom = Math.max(0.1, Math.min(10, zoom));
                clampOffset();
                render();
            }

            lastTouchDistance = distance;
        }
    }

    // Handle touch end
    function handleTouchEnd(e) {
        // Only prevent default if we were actually interacting with the map
        if (isPanning || lastTouchDistance > 0) {
            if (e.cancelable) {
                e.preventDefault();
            }
        }

        if (e.touches.length === 0) {
            isPanning = false;
            lastTouchDistance = 0;
            canvas.style.cursor = 'grab';
        } else if (e.touches.length === 1) {
            // One finger lifted, restart panning with remaining finger
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
            isPanning = true;
            lastTouchDistance = 0;
        }
    }

    // Load single run
    function loadRun(run) {
        console.log('Loading run on map:', run.runId);
        currentRuns = [run];
        currentPositionIndex = 0;
        currentTime = 0;
        fitToView();
        render();
    }

    // Compare multiple runs
    function compareRuns(runs) {
        console.log('Comparing runs on map:', runs.map(r => r.runId));
        currentRuns = runs.slice(0, 6); // Max 6 runs
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

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (currentRuns.length === 0) {
            // Draw placeholder text
            ctx.fillStyle = '#888';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Select a run to view track map', canvas.width / 2, canvas.height / 2);
            return;
        }

        // Create array with run data and original indices for color mapping
        // Note: currentRuns is already sorted by speed (fastest first) from loadSelectedRuns()
        const runsWithIndices = currentRuns.map((run, index) => ({
            run,
            colorIndex: index, // Color assignment based on speed order (fastest gets first color)
            adjustedTime: run.lapTime + ((run.cones || 0) * 2),
            isMostRecent: run.isMostRecent || false
        }));

        // Sort by adjusted time (slowest to fastest) for rendering order
        const sortedRuns = [...runsWithIndices].sort((a, b) => b.adjustedTime - a.adjustedTime);

        // Move the most recent run to the end so it draws on top (if enabled)
        if (mostRecentOnTop) {
            const mostRecentIndex = sortedRuns.findIndex(item => item.isMostRecent);
            if (mostRecentIndex !== -1 && mostRecentIndex !== sortedRuns.length - 1) {
                const mostRecent = sortedRuns.splice(mostRecentIndex, 1)[0];
                sortedRuns.push(mostRecent);
            }
        }

        // Draw each run in sorted order (slowest first, fastest/most recent last)
        sortedRuns.forEach(({ run, colorIndex, isMostRecent }) => {
            // Most recent run gets dark blue, others get their speed-based color
            const color = isMostRecent ? '#7d5aff' : COLORS[colorIndex % COLORS.length];
            // All runs have full opacity
            const opacity = 1;
            drawRun(run, color, opacity);
        });

        // Draw position markers for all runs (color-matched)
        // Each run calculates its own position based on currentTime
        sortedRuns.forEach(({ run, colorIndex, isMostRecent }) => {
            // Most recent run gets dark blue, others get their speed-based color
            const color = isMostRecent ? '#7d5aff' : COLORS[colorIndex % COLORS.length];

            // Find the correct index for THIS run based on current time
            const runIndex = findClosestIndex(run.telemetry.timestamps, currentTime);
            drawPositionMarker(run, runIndex, color);
        });

        // Update legend
        updateLegend();
    }

    // Draw a single run
    function drawRun(run, color, opacity) {
        const { posX, posY, speed } = run.telemetry;

        if (posX.length < 2) return;

        ctx.globalAlpha = opacity;
        ctx.lineWidth = 3;
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
    function drawPositionMarker(run, index, color) {
        if (index < 0 || index >= run.telemetry.posX.length) return;

        const pos = worldToScreen(run.telemetry.posX[index], run.telemetry.posY[index]);

        // Draw marker circle with run color
        ctx.fillStyle = color;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw direction arrow in white for contrast
        if (index < run.telemetry.posX.length - 1) {
            const nextPos = worldToScreen(run.telemetry.posX[index + 1], run.telemetry.posY[index + 1]);
            const angle = Math.atan2(nextPos.y - pos.y, nextPos.x - pos.x);

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;

            ctx.beginPath();
            ctx.moveTo(pos.x + Math.cos(angle) * 6, pos.y + Math.sin(angle) * 6);
            ctx.lineTo(pos.x + Math.cos(angle + 2.5) * 4, pos.y + Math.sin(angle + 2.5) * 4);
            ctx.lineTo(pos.x + Math.cos(angle - 2.5) * 4, pos.y + Math.sin(angle - 2.5) * 4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
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
            // Most recent run gets dark blue, others get their speed-based color
            const color = run.isMostRecent ? '#7d5aff' : COLORS[index % COLORS.length];
            colorBox.style.backgroundColor = color;

            const label = document.createElement('span');
            const lapTime = formatLapTime(run.lapTime);
            const runNumber = run.runNumber || (index + 1);
            label.textContent = `Run #${runNumber}: ${lapTime}`;

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
        let closest = 0;
        let minDiff = Math.abs(arr[0] - value);

        for (let i = 1; i < arr.length; i++) {
            const diff = Math.abs(arr[i] - value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = i;
            }
        }

        return closest;
    }

    // Format lap time
    function formatLapTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(3);
        return `${mins}:${secs.padStart(6, '0')}`;
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
        render
    };
})();

// Export to window
window.AutocrossMap = AutocrossMap;

// Initialize map when page loads
document.addEventListener('DOMContentLoaded', () => {
    AutocrossMap.init();
});
