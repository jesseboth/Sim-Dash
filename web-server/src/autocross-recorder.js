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

        // Restore course from previous session
        const savedCourseId = localStorage.getItem('recorder_courseId');
        if (savedCourseId) {
            currentCourseId = savedCourseId;
            console.log('Recorder: Restored course from storage:', savedCourseId);
        }

        updateUI();
        console.log('Recorder initialized');
    }

    // Set current course (for manual override if needed)
    function setCourse(courseId) {
        currentCourseId = courseId;
        if (courseId) {
            localStorage.setItem('recorder_courseId', courseId);
        } else {
            localStorage.removeItem('recorder_courseId');
        }
        console.log('Recorder: Course set to', courseId);
    }

    // Toggle recording
    async function toggleRecording() {
        if (state === STATE.IDLE) {
            await startRecording();
        } else if (state === STATE.RECORDING) {
            await stopRecording();
        }
    }

    // Start recording (via Go backend)
    async function startRecording() {
        // Get current telemetry to check track ID
        const telem = typeof telemetry !== 'undefined' ? telemetry : null;
        let trackId = telem && telem.TrackID ? String(telem.TrackID) : null;

        // Check if course is selected
        if (!currentCourseId) {
            // Try to auto-select course based on trackID
            if (trackId) {
                const existingCourse = await findCourseByTrackId(trackId);
                if (existingCourse) {
                    currentCourseId = existingCourse.courseId;
                    console.log('Auto-selected course:', existingCourse.name);

                    // Notify main app to update UI
                    if (window.AutocrossApp) {
                        window.AutocrossApp.onCourseAutoSelected(currentCourseId);
                    }
                }
            }

            // If still no course, auto-create one (requires a valid trackId)
            if (!currentCourseId) {
                if (!trackId) {
                    alert('No track detected yet. Please wait for telemetry to connect, then try again.');
                    return;
                }
                try {
                    // Get track name from mappings if available
                    const trackMappings = await getTrackMappings();
                    const trackName = trackMappings[trackId] || `Track ${trackId}`;

                    const course = await createCourse(trackName, trackId);
                    currentCourseId = course.courseId;
                    localStorage.setItem('recorder_courseId', currentCourseId);
                    console.log('Auto-created course:', trackName);

                    // Notify main app
                    if (window.AutocrossApp) {
                        window.AutocrossApp.onCourseAutoSelected(currentCourseId);
                    }
                } catch (error) {
                    alert('Failed to create course: ' + error.message);
                    return;
                }
            }
        }

        try {
            const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseId: currentCourseId })
            });

            const result = await response.json();
            if (result.success) {
                state = STATE.RECORDING;
                updateUI();
                startStatusPolling();
                console.log('Recording started on course:', currentCourseId);
            } else {
                alert('Failed to start recording: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            alert('Failed to start recording: ' + error.message);
            console.error('Error starting recording:', error);
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

                // Notify main app to refresh runs
                if (window.AutocrossApp && window.AutocrossApp.onRunSaved) {
                    window.AutocrossApp.onRunSaved();
                }
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

    // Find course by trackID
    async function findCourseByTrackId(trackId) {
        const response = await fetch('/autocross/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getCourses' })
        });
        const result = await response.json();
        if (!result.success) return null;

        const courses = result.data || [];
        return courses.find(c => c.trackId === trackId);
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

    // Open naming modal (triggered by button click)
    async function openNamingModal() {
        // Get current telemetry
        const telem = typeof telemetry !== 'undefined' ? telemetry : null;
        if (!telem || !telem.CarID || !telem.TrackID) {
            alert('No telemetry available. Please start Assetto Corsa and begin driving.');
            return;
        }

        const carId = String(telem.CarID);
        const trackId = String(telem.TrackID);

        await showNamingModal(carId, trackId);
    }

    // Show naming modal for car/track
    async function showNamingModal(carId, trackId) {
        return new Promise((resolve) => {
            const modal = document.getElementById('nameIdentifiersModal');
            const form = document.getElementById('nameIdentifiersForm');
            const carIdDisplay = document.getElementById('carIdDisplay');
            const trackIdDisplay = document.getElementById('trackIdDisplay');
            const carNameInput = document.getElementById('carNameInput');
            const trackNameInput = document.getElementById('trackNameInput');
            const cancelBtn = document.getElementById('cancelNameIdentifiers');

            // Load existing mappings and populate form
            Promise.all([
                fetch('/autocross/api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'getCarMappings' })
                }).then(r => r.json()),
                fetch('/autocross/api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'getTrackMappings' })
                }).then(r => r.json())
            ]).then(([carResult, trackResult]) => {
                const carMappings = carResult.data || {};
                const trackMappings = trackResult.data || {};

                // Set display values
                carIdDisplay.value = carId;
                trackIdDisplay.value = trackId;
                carNameInput.value = carMappings[carId] || '';
                trackNameInput.value = trackMappings[trackId] || '';
                carNameInput.placeholder = carMappings[carId] || 'e.g., Mazda Miata, BMW M3';
                trackNameInput.placeholder = trackMappings[trackId] || 'e.g., Laguna Seca, Silverstone';
            });

            // Show modal
            modal.classList.remove('hidden');

            // Handle form submission
            const handleSubmit = async (e) => {
                e.preventDefault();

                const carName = carNameInput.value.trim();
                const trackName = trackNameInput.value.trim();

                // Save mappings if provided
                if (carName) {
                    const response = await fetch('/autocross/api', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'setCarName', carId, name: carName })
                    });
                    const result = await response.json();
                    if (result.success) {
                        console.log('Car name saved:', carName);
                    }
                }

                if (trackName) {
                    const response = await fetch('/autocross/api', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'setTrackName', trackId, name: trackName })
                    });
                    const result = await response.json();
                    if (result.success) {
                        console.log('Track name saved:', trackName);
                    }
                }

                // Close modal and resolve
                modal.classList.add('hidden');
                form.removeEventListener('submit', handleSubmit);
                cancelBtn.removeEventListener('click', handleCancel);
                resolve(true);
            };

            // Handle cancel/skip
            const handleCancel = () => {
                modal.classList.add('hidden');
                form.removeEventListener('submit', handleSubmit);
                cancelBtn.removeEventListener('click', handleCancel);
                resolve(false);
            };

            form.addEventListener('submit', handleSubmit);
            cancelBtn.addEventListener('click', handleCancel);
        });
    }

    // Poll recording status for UI updates
    function startStatusPolling() {
        if (statusPollingInterval) return;

        statusPollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/status`);
                const status = await response.json();

                if (status.isRecording) {
                    state = STATE.RECORDING;
                    updateUI(status.elapsed);
                } else if (state === STATE.RECORDING) {
                    // Recording stopped by backend (auto-stop)
                    state = STATE.IDLE;
                    updateUI();
                    stopStatusPolling();

                    // Notify main app to refresh runs
                    if (window.AutocrossApp && window.AutocrossApp.onRunSaved) {
                        window.AutocrossApp.onRunSaved();
                    }
                }
            } catch (error) {
                console.error('Error polling recording status:', error);
            }
        }, 100); // Poll every 100ms
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
                const elapsedStr = elapsed ? elapsed.toFixed(1) : '0.0';
                statusElement.textContent = `Recording ${elapsedStr}s`;
                statusElement.className = 'recording-status recording';
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
