// Autocross Scrubber - Timeline Control

const AutocrossScrubber = (function() {
    // Canvas and context
    let canvas = null;
    let ctx = null;
    let scrubberSection = null;

    // Current run (frontmost = fastest, used for speed graph)
    let currentRun = null;
    let allRuns = [];       // all loaded runs, sorted fastest first
    let currentTime = 0;
    let maxTime = 0;        // slowest run's full duration
    let minTime = 0;        // earliest launch; time 0 is the S1 line
    let isPlaying = false;
    let playbackInterval = null;

    const COLORS = ['#4a9eff', '#ff4a4a', '#4aff4a', '#ffaa4a', '#ff4aff', '#4affff'];

    // Interaction state
    let isDragging = false;
    let isSeeking = false;
    let lastInteractionWasTouch = false;

    // DOM elements
    let playPauseBtn = null;
    let timeDisplay = null;

    // Initialize scrubber
    function init() {
        console.log('Initializing scrubber...');

        canvas = document.getElementById('scrubberCanvas');
        if (!canvas) {
            console.error('Scrubber canvas not found');
            return;
        }

        scrubberSection = canvas.closest('.scrubber-section');
        ctx = canvas.getContext('2d');

        playPauseBtn = document.getElementById('playPauseBtn');
        timeDisplay = document.getElementById('timeDisplay');

        // Setup canvas size
        resizeCanvas();

        // Setup event listeners
        setupEventListeners();

        // Initial render
        render();
        updateTimeDisplay();

        console.log('Scrubber initialized');
    }

    // Setup event listeners
    function setupEventListeners() {
        // Canvas mouse interactions - use window for move/up to track outside canvas
        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        // Canvas touch interactions. Touch moves go to the element the touch started on, so
        // listening on the canvas tracks a finger outside it without slowing page scrolling.
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
        canvas.addEventListener('touchcancel', handleTouchEnd);

        // Play/pause button
        playPauseBtn?.addEventListener('click', togglePlayback);

        // Window resize
        window.addEventListener('resize', () => {
            resizeCanvas();
            render();
        });
    }

    // Resize canvas
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        // Ensure canvas is interactive for both mouse and touch
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'pointer';
        canvas.style.userSelect = 'none';
        canvas.style.webkitUserSelect = 'none';
    }

    // Load run
    function loadRun(run) {
        console.log('Loading run in scrubber:', run.runId);
        currentRun = run;
        maxTime = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
        minTime = startTime(run);
        currentTime = minTime;
        isPlaying = false;

        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }

        updatePlayPauseButton();
        render();
        updateTimeDisplay();
        updateAddSectorBtn();
    }

    // Load multiple runs (sorted fastest first).
    // In time mode the fastest run drives the speed graph and the timeline covers the slowest run.
    // In align mode the timeline is the reference run's time.
    // With keepTime, the playback position is kept instead of going back to the start.
    function setRuns(runs, { keepTime = false } = {}) {
        if (!runs || runs.length === 0) { clear(); return; }

        allRuns = runs;
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        currentRun = alignRef || runs[0];

        // Align mode: until the last shifted run finishes
        const range = alignRef ? AutocrossAlign.timeRange() : null;
        maxTime = range ? range.end : Math.max(...runs.map(endTime));
        minTime = range ? Math.min(0, range.start) : Math.min(...runs.map(startTime));

        currentTime = keepTime ? Math.max(minTime, Math.min(currentTime, maxTime)) : minTime;
        if (!keepTime) {
            isPlaying = false;
            if (playbackInterval) {
                clearInterval(playbackInterval);
                playbackInterval = null;
            }
        }

        updatePlayPauseButton();
        render();
        updateTimeDisplay();
        updateAddSectorBtn();
        notifySeek();
    }

    function endTime(run) {
        return run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
    }

    // Launch time (negative) of a run, or 0 for runs recorded from the S1 line
    function startTime(run) {
        return Math.min(0, run.telemetry.timestamps[0]);
    }

    // Timeline position (0..1) of a time, and the time at a position
    function ratioOf(time) {
        return maxTime > minTime ? (time - minTime) / (maxTime - minTime) : 0;
    }

    function timeAt(ratio) {
        return minTime + ratio * (maxTime - minTime);
    }

    // Timeline position under a pointer; the timeline is drawn 10 px in from each side
    function ratioAtClientX(clientX) {
        const rect = canvas.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - rect.left - 10) / (rect.width - 20)));
    }

    // Move the playback position by a number of seconds
    function step(seconds) {
        if (!currentRun) return;
        if (isPlaying) stopPlayback();
        seekTo(currentTime + seconds);
    }

    // Clear scrubber
    function clear() {
        currentRun = null;
        allRuns = [];
        currentTime = 0;
        maxTime = 0;
        minTime = 0;
        isPlaying = false;

        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }

        updatePlayPauseButton();
        render();
        updateTimeDisplay();
        updateAddSectorBtn();
    }

    // Seek to specific time
    function seekTo(time) {
        if (!currentRun) return;

        // Prevent circular updates
        if (isSeeking) return;

        isSeeking = true;

        currentTime = Math.max(minTime, Math.min(maxTime, time));
        render();
        updateTimeDisplay();
        updateAddSectorBtn();

        // Notify charts and map
        notifySeek();

        isSeeking = false;
    }

    // Notify other components of seek
    function notifySeek() {
        if (window.AutocrossCharts) {
            window.AutocrossCharts.seekTo(currentTime, true); // true = from scrubber
        }

        if (window.AutocrossMap) {
            window.AutocrossMap.seekTo(currentTime);
        }
    }

    // Toggle playback
    function togglePlayback() {
        if (!currentRun) return;

        isPlaying = !isPlaying;

        if (isPlaying) {
            startPlayback();
        } else {
            stopPlayback();
        }

        updatePlayPauseButton();
    }

    // Start playback
    function startPlayback() {
        if (currentTime >= maxTime) {
            currentTime = minTime;
        }

        playbackInterval = setInterval(() => {
            currentTime += 0.05; // 50ms steps

            if (currentTime >= maxTime) {
                currentTime = maxTime;
                stopPlayback();
            }

            seekTo(currentTime);
        }, 50);
    }

    // Stop playback
    function stopPlayback() {
        isPlaying = false;

        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }

        updatePlayPauseButton();
    }

    // Update play/pause button
    function updatePlayPauseButton() {
        const icon = isPlaying ? '⏸' : '▶';

        if (playPauseBtn) {
            playPauseBtn.textContent = icon;
        }

        // Also update map play button if it exists
        const mapPlayBtn = document.getElementById('mapPlayBtn');
        if (mapPlayBtn) {
            mapPlayBtn.textContent = icon;
        }
    }

    // Handle mouse down
    function handleMouseDown(e) {
        // Ignore mouse events if last interaction was touch (prevents duplicate events on mobile)
        if (lastInteractionWasTouch) {
            lastInteractionWasTouch = false;
            return;
        }

        e.preventDefault();
        isDragging = true;
        handleSeekFromMouse(e);
    }

    // Handle mouse move
    function handleMouseMove(e) {
        // Ignore mouse events if last interaction was touch
        if (lastInteractionWasTouch) return;
        if (!isDragging || !currentRun) return;

        // Get position and clamp to canvas bounds
        const time = timeAt(ratioAtClientX(e.clientX));

        seekTo(time);
    }

    // Handle mouse up
    function handleMouseUp(e) {
        // Don't reset lastInteractionWasTouch here, let it persist briefly
        isDragging = false;
    }

    // Handle seek from mouse position
    function handleSeekFromMouse(e) {
        if (!currentRun) return;

        const time = timeAt(ratioAtClientX(e.clientX));

        seekTo(time);
    }

    // Handle touch start
    function handleTouchStart(e) {
        // Mark that last interaction was touch to prevent duplicate mouse events
        lastInteractionWasTouch = true;

        if (e.cancelable) {
            e.preventDefault();
        }
        isDragging = true;

        if (e.touches.length > 0) {
            handleSeekFromTouch(e.touches[0]);
        }
    }

    // Handle touch move
    function handleTouchMove(e) {
        // Only handle if we're actually dragging the scrubber
        if (!isDragging || !currentRun) return;

        // Mark that last interaction was touch
        lastInteractionWasTouch = true;

        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length > 0) {
            handleSeekFromTouch(e.touches[0]);
        }
    }

    // Handle touch end
    function handleTouchEnd(e) {
        // Only prevent default and handle if we were actually dragging
        if (isDragging) {
            if (e.cancelable) {
                e.preventDefault();
            }

            // Reset touch flag after a short delay to allow mouse events to be ignored
            setTimeout(() => {
                lastInteractionWasTouch = false;
            }, 500);
        }

        isDragging = false;
    }

    // Handle seek from touch position
    function handleSeekFromTouch(touch) {
        if (!currentRun) return;

        const time = timeAt(ratioAtClientX(touch.clientX));

        seekTo(time);
    }

    // Render scrubber
    function render() {
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        if (!currentRun) {
            // Draw placeholder
            ctx.fillStyle = '#888';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No run loaded', width / 2, height / 2);
            return;
        }

        // Draw timeline background
        const timelineHeight = 30;
        const timelineY = (height - timelineHeight) / 2;

        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(10, timelineY, width - 20, timelineHeight);

        // Draw progress
        const progress = ratioOf(currentTime);
        const progressWidth = (width - 20) * progress;

        ctx.fillStyle = '#4a9eff';
        ctx.fillRect(10, timelineY, progressWidth, timelineHeight);

        // Draw speed graph overlay
        drawSpeedGraph(timelineY, timelineHeight);

        // Draw sector markers
        drawSectorMarkers(timelineY, timelineHeight);
        drawStartMarker(timelineY, timelineHeight);

        // Draw finish lines for each run
        drawFinishLines(timelineY, timelineHeight);

        // Draw time markers
        drawTimeMarkers(timelineY, timelineHeight);

        // Draw handle
        const handleX = 10 + progressWidth;
        const handleY = height / 2;

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(handleX, handleY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    // Draw speed graph overlay
    function drawSpeedGraph(timelineY, timelineHeight) {
        if (!currentRun || !currentRun.telemetry.speed) return;

        const rect = canvas.getBoundingClientRect();
        const width = rect.width;

        const speeds = currentRun.telemetry.speed;
        const timestamps = currentRun.telemetry.timestamps;
        const maxSpeed = Math.max(...speeds);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3;

        ctx.beginPath();

        speeds.forEach((speed, index) => {
            const x = 10 + (width - 20) * ratioOf(timestamps[index]);
            const normalizedSpeed = speed / maxSpeed;
            const y = timelineY + timelineHeight - (normalizedSpeed * timelineHeight);

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Draw time markers
    function drawTimeMarkers(timelineY, timelineHeight) {
        const rect = canvas.getBoundingClientRect();
        const width = rect.width;

        ctx.fillStyle = '#888';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';

        const numMarkers = 5;
        for (let i = 0; i <= numMarkers; i++) {
            const ratio = i / numMarkers;
            const time = timeAt(ratio);
            const x = 10 + (width - 20) * ratio;

            // Draw tick
            ctx.fillRect(x - 1, timelineY + timelineHeight + 2, 2, 5);

            // Draw label
            ctx.fillText(formatTime(time), x, timelineY + timelineHeight + 18);
        }
    }

    // Draw vertical finish lines for each loaded run
    function drawFinishLines(timelineY, timelineHeight) {
        if (allRuns.length <= 1) return;
        // In align mode each finish is shown at the run's shifted time
        const aligned = window.AutocrossAlign && AutocrossAlign.isActive();

        const rect = canvas.getBoundingClientRect();
        const width = rect.width;

        allRuns.forEach((run, i) => {
            const finishTime = run.telemetry.timestamps[run.telemetry.timestamps.length - 1]
                - (aligned ? AutocrossAlign.offsetOf(run) : 0);
            const x = 10 + (width - 20) * ratioOf(finishTime);
            const color = run.color || COLORS[i % COLORS.length];

            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.moveTo(x, timelineY);
            ctx.lineTo(x, timelineY + timelineHeight);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;

            // Small flag above the line
            ctx.fillStyle = color;
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`R${run.runNumber || (i + 1)}`, x, timelineY - 2);
        });
    }

    // Update time display
    function updateTimeDisplay() {
        if (!timeDisplay) return;

        if (!currentRun || currentTime === undefined || currentTime === null) {
            timeDisplay.textContent = '00:00.000';
            return;
        }

        timeDisplay.textContent = formatTime(currentTime);
    }

    // Format time as MM:SS.mmm, with a minus sign before the S1 line
    function formatTime(seconds) {
        // Handle invalid input
        if (typeof seconds !== 'number' || isNaN(seconds)) {
            return '00:00.000';
        }
        if (seconds < 0) return `-${formatTime(-seconds)}`;

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);

        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    // Enable/disable +Sector button based on scrubber position
    function updateAddSectorBtn() {
        const btn = document.getElementById('addSectorBtn');
        if (!btn) return;

        if (!currentRun || maxTime === 0) {
            btn.disabled = true;
            return;
        }

        // Disable past the frontmost (fastest) car's finish line, or the reference run's in align mode
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        const frontFinish = alignRef
            ? endTime(alignRef)
            : (allRuns.length > 0 ? endTime(allRuns[0]) : maxTime);
        btn.disabled = currentTime < 0 || currentTime >= frontFinish - 0.05;
    }

    // S1 line where timing starts (time 0), and START at the launch when the launch is shown before it
    function drawStartMarker(timelineY, timelineHeight) {
        if (minTime >= 0) return;
        const width = canvas.getBoundingClientRect().width;
        const x = 10 + (width - 20) * ratioOf(0);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, timelineY - 4);
        ctx.lineTo(x, timelineY + timelineHeight + 4);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('S1', x, timelineY - 7);
        // START only when it does not overlap S1
        if (x - 10 > ctx.measureText('START').width + 12) {
            ctx.textAlign = 'left';
            ctx.fillText('START', 10, timelineY - 7);
        }
    }

    // Draw sector markers on the timeline
    function drawSectorMarkers(timelineY, timelineHeight) {
        if (!window.AutocrossSectors || !currentRun) return;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width;
        const times = AutocrossSectors.getSectorTimesForRun(currentRun);

        times.forEach((t, i) => {
            if (t === undefined || t === null) return;
            const x = 10 + (width - 20) * ratioOf(t);

            // Vertical line
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(x, timelineY - 4);
            ctx.lineTo(x, timelineY + timelineHeight + 4);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(AutocrossSectors.lineLabel(i), x, timelineY - 7);
        });
    }

    // Public API
    return {
        init,
        loadRun,
        clear,
        seekTo,
        togglePlayback,
        render,
        setRuns,
        step,
        pause: () => { if (isPlaying) stopPlayback(); },
        getCurrentTime: () => currentTime,
        getCurrentRun: () => currentRun
    };
})();

// Export to window
window.AutocrossScrubber = AutocrossScrubber;

// Initialize scrubber when page loads
document.addEventListener('DOMContentLoaded', () => {
    AutocrossScrubber.init();
});
