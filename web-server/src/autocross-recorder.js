// Autocross Telemetry Recorder
// Communicates with Go backend for server-side recording

const AutocrossRecorder = (function() {
    // States
    const STATE = {
        IDLE: 'idle',
        RECORDING: 'recording',
    };

    // State variables
    let state = STATE.IDLE;
    let currentCourseId = null;
    let statusPollingInterval = null;

    // DOM elements
    let statusElement = null;
    let toggleButton = null;

    // Initialize the recorder
    function init() {
        console.log('Initializing Autocross Recorder (Go Backend)...');

        statusElement = document.getElementById('recordingStatus');
        toggleButton = document.getElementById('toggleRecordingBtn');
        const nameIdentifiersBtn = document.getElementById('nameIdentifiersBtn');

        if (!toggleButton) {
            console.error('Toggle recording button not found');
            return;
        }

        // Setup event listeners
        toggleButton.addEventListener('click', toggleRecording);

        if (nameIdentifiersBtn) {
            nameIdentifiersBtn.addEventListener('click', openNamingModal);
        }

        // Check server for persisted armed state and resume if active
        fetch(`http://${window.location.hostname}:8888/autocross/recording/status`)
            .then(r => r.json())
            .then(status => {
                setCurrentDriver(status.driver, status.car);
                if (status.isRecording && status.courseId) {
                    currentCourseId = status.courseId;
                    localStorage.setItem('recorder_courseId', currentCourseId);
                    state = STATE.RECORDING;
                    lastRunSavedAt = status.runSavedAt || 0;
                    startStatusPolling();
                    console.log('Recorder: Resumed armed state for course:', currentCourseId);

                    // Sync course selection in main app
                    notifyCourseSelected(currentCourseId);
                } else {
                    // Restore course from localStorage as fallback
                    const savedCourseId = localStorage.getItem('recorder_courseId');
                    if (savedCourseId) {
                        currentCourseId = savedCourseId;
                    }
                }
                updateUI();
            })
            .catch(() => {
                // Server not reachable, fall back to localStorage
                const savedCourseId = localStorage.getItem('recorder_courseId');
                if (savedCourseId) currentCourseId = savedCourseId;
                updateUI();
            });

        console.log('Recorder initialized');
    }

    // Set current course. While armed, the recorder is armed again for the new course,
    // so runs save to the course on screen.
    function setCourse(courseId) {
        const changed = courseId && courseId !== currentCourseId;
        currentCourseId = courseId;
        if (changed && state === STATE.RECORDING) rearm(courseId);
        if (courseId) {
            localStorage.setItem('recorder_courseId', courseId);
        } else {
            localStorage.removeItem('recorder_courseId');
        }
        console.log('Recorder: Course set to', courseId);
    }

    async function rearm(courseId) {
        try {
            const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseId })
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'not armed');
        } catch (e) {
            console.error('Recorder: could not arm for the new course', e);
            showToast('Could not switch recording to this course. Press Stop, then Start.', 'error');
        }
    }

    // Toggle recording
    async function toggleRecording() {
        if (state === STATE.IDLE) {
            await startRecording();
        } else if (state === STATE.RECORDING) {
            await stopRecording();
        }
    }

    // Ensure AC telemetry is running (start or restart via Node server)
    async function ensureACTelemetry() {
        try {
            // Check what game is currently running
            const checkRes = await fetch('/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ game: 'get' })
            });
            const checkResult = await checkRes.json();
            const currentGame = checkResult.game && checkResult.game.return;

            if (currentGame && currentGame.toLowerCase() === 'ac') {
                // AC already running, nothing to do
                return true;
            }

            // Stop whatever is running, then start AC
            if (currentGame) {
                await fetch('/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ game: 'stop' })
                });
                // Brief pause for process to die
                await new Promise(r => setTimeout(r, 300));
            }

            const startRes = await fetch('/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ game: 'ac' })
            });
            const startResult = await startRes.json();
            if (!startResult.game || !startResult.game.success) {
                console.error('Failed to start AC telemetry:', startResult);
                return false;
            }
            console.log('AC telemetry started');
            // Wait briefly for the Go server to come up
            await new Promise(r => setTimeout(r, 500));
            return true;
        } catch (error) {
            console.error('Error ensuring AC telemetry:', error);
            return false;
        }
    }

    // Fetch live telemetry from Go backend
    async function getLiveTelemetry() {
        try {
            const res = await fetch(`http://${window.location.hostname}:8888/telemetry`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    // Poll telemetry until TrackID is populated (up to maxWaitMs)
    async function waitForTrackId(maxWaitMs = 5000) {
        const interval = 500;
        const attempts = maxWaitMs / interval;
        for (let i = 0; i < attempts; i++) {
            const telem = await getLiveTelemetry();
            if (telem && telem.TrackId) {
                return String(telem.TrackId);
            }
            await new Promise(r => setTimeout(r, interval));
        }
        return null;
    }

    // Start recording (via Go backend)
    async function startRecording() {
        toggleButton.disabled = true;
        if (statusElement) statusElement.textContent = 'Connecting...';

        try {
            // Ensure AC telemetry process is running
            await ensureACTelemetry();

            // Poll for track ID (AC may need a moment to send packets)
            const trackId = await waitForTrackId(5000);

            const courseId = await resolveCourseForTrack(trackId);
            if (!courseId) return;
            currentCourseId = courseId;
            localStorage.setItem('recorder_courseId', currentCourseId);

            const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseId: currentCourseId })
            });

            const result = await response.json();
            if (result.success) {
                state = STATE.RECORDING;
                startStatusPolling();
                console.log('Recording started on course:', currentCourseId);
            } else {
                showToast('Failed to start recording: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            // A network error or a non-JSON reply means the Go recorder is not answering on port 8888
            const unreachable = error instanceof TypeError || error instanceof SyntaxError;
            showToast(unreachable
                ? 'Cannot reach the telemetry recorder on port 8888. Check that no other program uses that port.'
                : 'Failed to start recording: ' + error.message, 'error');
            console.error('Error starting recording:', error);
        } finally {
            updateUI();
        }
    }

    // Choose the course to record into.
    // Keeps the selected course when it fits the current track, otherwise uses or creates
    // the active course for this track. Returns null when no course can be chosen.
    async function resolveCourseForTrack(trackId) {
        const courses = await getCourses();
        const current = courses.find(c => c.courseId === currentCourseId);

        const currentFits = current && !current.isArchived &&
            (!trackId || !current.trackId || current.trackId === 'manual' || current.trackId === trackId);
        if (currentFits) {
            return current.courseId;
        }

        if (!trackId) {
            showToast('No track detected yet. Start driving in Assetto Corsa, then press Start again.', 'warning');
            return null;
        }

        const trackMappings = await getTrackMappings();
        const trackName = trackMappings[trackId] || `Track ${trackId}`;

        // One course for this track: use it. More than one: ask which.
        const matches = courses.filter(c => !c.isArchived && c.trackId === trackId);
        let choice = matches.length === 1 ? matches[0].courseId : 'new';
        if (matches.length > 1 && window.AutocrossCourses) {
            choice = await AutocrossCourses.chooseCourse(matches, trackName);
            if (choice === null) return null;
        }

        if (choice !== 'new') {
            const match = matches.find(c => c.courseId === choice);
            notifyCourseSelected(choice, `Recording to course "${match.name}"`);
            return choice;
        }

        const course = await createCourse(trackName, trackId);
        notifyCourseSelected(course.courseId, `Created course "${trackName}" for this track`);
        return course.courseId;
    }

    function notifyCourseSelected(courseId, message) {
        if (window.AutocrossApp) {
            window.AutocrossApp.onCourseAutoSelected(courseId, message);
        }
    }

    // Stop recording (via Go backend)
    async function stopRecording() {
        try {
            const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/stop`, {
                method: 'POST'
            });

            const result = await response.json();
            if (result.success) {
                state = STATE.IDLE;
                updateUI();
                stopStatusPolling();
                console.log('Recording stopped');
            } else {
                console.error('Failed to stop recording:', result.error);
            }
        } catch (error) {
            console.error('Failed to stop recording:', error);
        }
    }

    // Create course via API
    async function createCourse(name, trackId) {
        const response = await fetch('/autocross/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'createCourse', name, trackId })
        });
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error);
        }
        return result.data;
    }

    // Get all courses
    async function getCourses() {
        const response = await fetch('/autocross/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getCourses' })
        });
        const result = await response.json();
        return result.success ? (result.data || []) : [];
    }

    // Get track mappings
    async function getTrackMappings() {
        const response = await fetch('/autocross/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getTrackMappings' })
        });
        const result = await response.json();
        return result.success ? (result.data || {}) : {};
    }

    // Driver and car that the recorder gives to new runs
    let currentDriver = { driver: '', car: '' };

    function setCurrentDriver(driver, car) {
        currentDriver = { driver: driver || '', car: car || '' };
        const text = document.getElementById('driverBtnText');
        if (text) text.textContent = currentDriver.driver || 'Driver / Car';
    }

    async function saveCurrentDriver(driver, car) {
        const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/driver`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ driver, car })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'not saved');
        setCurrentDriver(driver, car);
    }

    // Driver and car dialog. With a live game car ID, the car name is saved for that ID.
    // Without one, the recorder gives the car name to new runs.
    async function openNamingModal() {
        const modal = document.getElementById('nameIdentifiersModal');
        const form = document.getElementById('nameIdentifiersForm');
        const driverInput = document.getElementById('driverInput');
        const carNameInput = document.getElementById('carNameInput');
        const trackNameInput = document.getElementById('trackNameInput');
        const cancelBtn = document.getElementById('cancelNameIdentifiers');

        const [telem, carMappings, trackMappings] = await Promise.all([
            getLiveTelemetry(),
            apiRequest('getCarMappings').catch(() => ({})),
            getTrackMappings().catch(() => ({}))
        ]);
        const carId = telem && telem.CarId ? String(telem.CarId) : '';
        const trackId = telem && telem.TrackId ? String(telem.TrackId) : '';

        window.AutocrossApp?.fillDetailOptions(carMappings);
        driverInput.value = currentDriver.driver;
        carNameInput.value = carId ? (carMappings[carId] || '') : currentDriver.car;
        document.getElementById('carIdNote').textContent = carId
            ? `Game car ID ${carId}. All runs with this ID get this car name.`
            : 'No car ID from the game. New runs get this car name.';
        document.getElementById('trackNameGroup').classList.toggle('hidden', !trackId);
        trackNameInput.value = trackMappings[trackId] || '';
        document.getElementById('trackIdNote').textContent = trackId ? `Game track ID ${trackId}` : '';

        modal.classList.remove('hidden');
        setTimeout(() => driverInput.focus(), 100);

        const close = () => {
            modal.classList.add('hidden');
            form.removeEventListener('submit', handleSubmit);
            cancelBtn.removeEventListener('click', close);
        };

        const handleSubmit = async (e) => {
            e.preventDefault();
            const driver = driverInput.value.trim();
            const carName = carNameInput.value.trim();
            const trackName = trackNameInput.value.trim();
            try {
                if (carId && carName) await apiRequest('setCarName', { carId, name: carName });
                if (trackId && trackName) await apiRequest('setTrackName', { trackId, name: trackName });
                await saveCurrentDriver(driver, carId ? '' : carName);
                window.AutocrossApp?.rememberDriver(driver);
                close();
                await window.AutocrossApp?.refreshRuns();
            } catch (err) {
                console.error('Could not save driver and car:', err);
                showToast('Could not save the driver on the telemetry recorder (port 8888).', 'error');
            }
        };

        form.addEventListener('submit', handleSubmit);
        cancelBtn.addEventListener('click', close);
    }

    // Poll recording status for UI updates
    let lastRunSavedAt = 0;
    let statusRequestPending = false;
    let failedPolls = 0;
    const OFFLINE_AFTER_FAILURES = 10; // 2 s of failed polls

    function startStatusPolling() {
        if (statusPollingInterval) return;

        statusPollingInterval = setInterval(async () => {
            // Skip this tick while the previous request is still running
            if (statusRequestPending) return;
            statusRequestPending = true;
            try {
                const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/status`);
                const status = await response.json();
                failedPolls = 0;

                if (window.AutocrossLive) AutocrossLive.onStatus(status);

                if (status.isRecording) {
                    state = STATE.RECORDING;
                    // Show run-active state in UI
                    if (status.runActive) {
                        updateUI(status.elapsed);
                    } else {
                        updateUI(); // enabled but waiting for run to start
                    }
                } else {
                    state = STATE.IDLE;
                    updateUI();
                    stopStatusPolling();
                }

                // Detect auto-saved run via runSavedAt timestamp
                if (status.runSavedAt && status.runSavedAt !== lastRunSavedAt) {
                    lastRunSavedAt = status.runSavedAt;
                    if (window.AutocrossApp && window.AutocrossApp.onRunSaved) {
                        await window.AutocrossApp.onRunSaved();
                    }
                    if (window.AutocrossLive) AutocrossLive.onRunSaved();
                }
            } catch (error) {
                console.error('Error polling recording status:', error);
                // The recorder stopped answering: say so, and end any live run on screen
                if (++failedPolls === OFFLINE_AFTER_FAILURES) {
                    if (window.AutocrossLive) AutocrossLive.onStatus({ isRecording: false, runActive: false });
                    if (statusElement) {
                        statusElement.textContent = 'Recorder offline';
                        statusElement.className = 'recording-status offline';
                    }
                }
            } finally {
                statusRequestPending = false;
            }
        }, 200);
    }

    function stopStatusPolling() {
        if (statusPollingInterval) {
            clearInterval(statusPollingInterval);
            statusPollingInterval = null;
        }
    }

    // Update UI based on state
    function updateUI(elapsed) {
        if (!statusElement || !toggleButton) return;

        switch (state) {
            case STATE.IDLE:
                statusElement.textContent = 'Ready';
                statusElement.className = 'recording-status';
                toggleButton.textContent = 'Start';
                toggleButton.className = 'btn btn-start';
                toggleButton.disabled = false;
                break;

            case STATE.RECORDING:
                if (elapsed) {
                    statusElement.textContent = `Recording ${elapsed.toFixed(1)}s`;
                    statusElement.className = 'recording-status recording';
                } else {
                    statusElement.textContent = 'Armed';
                    statusElement.className = 'recording-status armed';
                }
                toggleButton.textContent = 'Stop';
                toggleButton.className = 'btn btn-stop';
                toggleButton.disabled = false;
                break;
        }
    }

    // Public API
    return {
        init,
        setCourse,
        getState: () => state,
        isRecording: () => state === STATE.RECORDING
    };
})();

// Export to window
window.AutocrossRecorder = AutocrossRecorder;
