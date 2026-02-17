// Autocross Scrubber - Timeline Control

const AutocrossScrubber = (function() {
    // Canvas and context
    let canvas = null;
    let ctx = null;
    let scrubberSection = null;

    // Current run
    let currentRun = null;
    let currentTime = 0;
    let maxTime = 0;
    let isPlaying = false;
    let playbackInterval = null;

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

        // Canvas touch interactions - use document for move/end to track outside canvas
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);
        document.addEventListener('touchcancel', handleTouchEnd);

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
        currentTime = 0;
        isPlaying = false;

        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }

        updatePlayPauseButton();
        render();
        updateTimeDisplay();
    }

    // Clear scrubber
    function clear() {
        currentRun = null;
        currentTime = 0;
        maxTime = 0;
        isPlaying = false;

        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }

        updatePlayPauseButton();
        render();
        updateTimeDisplay();
    }

    // Seek to specific time
    function seekTo(time) {
        if (!currentRun) return;

        // Prevent circular updates
        if (isSeeking) return;

        isSeeking = true;

        currentTime = Math.max(0, Math.min(maxTime, time));
        render();
        updateTimeDisplay();

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
            currentTime = 0;
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
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const ratio = x / rect.width;
        const time = ratio * maxTime;

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

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ratio = x / rect.width;
        const time = ratio * maxTime;

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

        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, x / canvas.width));
        const time = ratio * maxTime;

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
        const progress = currentTime / maxTime;
        const progressWidth = (width - 20) * progress;

        ctx.fillStyle = '#4a9eff';
        ctx.fillRect(10, timelineY, progressWidth, timelineHeight);

        // Draw speed graph overlay
        drawSpeedGraph(timelineY, timelineHeight);

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
        const maxSpeed = Math.max(...speeds);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3;

        ctx.beginPath();

        speeds.forEach((speed, index) => {
            const x = 10 + ((width - 20) * index / (speeds.length - 1));
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
            const time = maxTime * ratio;
            const x = 10 + (width - 20) * ratio;

            // Draw tick
            ctx.fillRect(x - 1, timelineY + timelineHeight + 2, 2, 5);

            // Draw label
            ctx.fillText(formatTime(time), x, timelineY + timelineHeight + 18);
        }
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

    // Format time as MM:SS.mmm
    function formatTime(seconds) {
        // Handle invalid input
        if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
            return '00:00.000';
        }

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);

        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    // Public API
    return {
        init,
        loadRun,
        clear,
        seekTo,
        togglePlayback
    };
})();

// Export to window
window.AutocrossScrubber = AutocrossScrubber;

// Initialize scrubber when page loads
document.addEventListener('DOMContentLoaded', () => {
    AutocrossScrubber.init();
});
