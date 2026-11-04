// Autocross Telemetry Recorder
// Communicates with Go backend for server-side recording, for the game that the dash runs

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
            .then(async status => {
                // Details saved while the recorder was not reachable go to it now
                const pending = readPendingDetails();
                if (pending && await pushPendingDetails()) {
                    detailsSetBeforeStart = true;
                    status = { ...status, ...pending };
                }
                setCurrentDriver(status.driver, status.car, status.carClass);
                window.AutocrossApp?.setSessionClass?.(status.carClass, false);
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
                const pending = readPendingDetails();
                if (pending) setCurrentDriver(pending.driver, pending.car, pending.carClass);
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

    async function postConfig(body) {
        const res = await fetch('/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return res.json();
    }

    // The game that the dash runs. When no game runs, the user selects one and it starts.
    // Returns the game ID, or null.
    async function ensureTelemetry() {
        const check = await postConfig({ game: 'get' });
        const running = check.game && check.game.return;
        if (running) return running.toUpperCase();

        const games = await fetch('/games').then(r => r.json()).catch(() => ({ categories: [] }));
        const gameId = window.AutocrossCourses
            ? await AutocrossCourses.chooseGame(games.categories || [])
            : null;
        if (!gameId) return null;

        const start = await postConfig({ game: gameId });
        if (!start.game || !start.game.success) {
            showToast('Could not start telemetry for ' + gameId, 'error');
            return null;
        }
        // Give the telemetry process time to start
        await new Promise(r => setTimeout(r, 800));
        return gameId.toUpperCase();
    }

    // Entry of a game ID in the dash game list (name, classes), or null
    async function gameInfo(gameId) {
        try {
            const games = await fetch('/games').then(r => r.json());
            for (const category of games.categories || []) {
                const game = (category.games || []).find(g => g.id.toUpperCase() === gameId);
                if (game) return game;
            }
        } catch (e) { /* not in the list */ }
        return null;
    }

    // Game of the recorder, else the game that the dash runs, else the game of the newest run
    // in the open course, else the last game on this device
    const LAST_GAME_KEY = 'recorder_lastGame';
    async function currentGame(status) {
        let game = status && status.game;
        if (!game) {
            const check = await postConfig({ game: 'get' }).catch(() => ({}));
            game = check.game && check.game.return ? String(check.game.return).toUpperCase() : '';
        }
        if (game) {
            localStorage.setItem(LAST_GAME_KEY, game);
            return game;
        }
        return courseGame() || localStorage.getItem(LAST_GAME_KEY) || '';
    }

    function courseGame() {
        const newest = (window.AutocrossApp?.getAllRuns() || [])
            .filter(r => r.game)
            .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
        return newest ? String(newest.game).toUpperCase() : '';
    }

    async function gameName(gameId) {
        return (await gameInfo(gameId))?.name || gameId;
    }

    async function getRecorderStatus() {
        const res = await fetch(`http://${window.location.hostname}:8888/autocross/recording/status`);
        return res.json();
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

    let lastTelemetry = null;

    // Poll telemetry until the track ID is populated (up to maxWaitMs).
    // Returns null when no ID came, and undefined at once for a game that sends no track ID.
    async function waitForTrackId(maxWaitMs = 5000) {
        const interval = 500;
        const attempts = maxWaitMs / interval;
        for (let i = 0; i < attempts; i++) {
            const telem = await getLiveTelemetry();
            lastTelemetry = telem;
            if (telem && Object.keys(telem).length) {
                const id = telem.TrackId ?? telem.TrackOrdinal;
                if (id === undefined) return undefined;
                if (id) return String(id);
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
            const gameId = await ensureTelemetry();
            if (!gameId) return;

            const status = await getRecorderStatus();
            if (await pushPendingDetails()) detailsSetBeforeStart = true;
            if (!status.canRecord) {
                showToast(`${await gameName(gameId)} sends no run timer, so runs cannot be recorded.`, 'warning');
                return;
            }

            // Poll for track ID (the game may need a moment to send packets)
            const trackId = await waitForTrackId(5000);

            const courseId = await resolveCourseForTrack(trackId, await gameName(gameId));
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
                await clearDetailsForStart();
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
    async function resolveCourseForTrack(trackId, game) {
        const courses = await getCourses();
        const current = courses.find(c => c.courseId === currentCourseId);

        const currentFits = current && !current.isArchived &&
            (!trackId || !current.trackId || current.trackId === 'manual' || current.trackId === trackId);
        if (currentFits) {
            return current.courseId;
        }

        if (trackId === null) {
            showToast(`No track detected yet. Start driving in ${game}, then press Start again.`, 'warning');
            return null;
        }

        // The game sends no track ID
        if (!trackId) {
            const course = await createCourse(game, null);
            notifyCourseSelected(course.courseId, `Created course "${game}". Rename it for your track or stage.`);
            return course.courseId;
        }

        // Rally stage IDs are the stage length in metres
        const trackMappings = await getTrackMappings();
        const isStage = lastTelemetry && lastTelemetry.StageLength !== undefined;
        const trackName = trackMappings[trackId]
            || (isStage ? `Stage ${(Number(trackId) / 1000).toFixed(2)} km` : `Track ${trackId}`);

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
    let currentDriver = { driver: '', car: '', carClass: '' };
    // True when the user set the driver details while not armed: then Start keeps the class and the car
    let detailsSetBeforeStart = false;
    const SESSION_START_KEY = 'recorder_sessionStart';

    function setCurrentDriver(driver, car, carClass) {
        currentDriver = { driver: driver || '', car: car || '', carClass: carClass || '' };
        const text = document.getElementById('driverBtnText');
        if (text) {
            const parts = [currentDriver.driver, currentDriver.carClass || currentDriver.car].filter(Boolean);
            text.textContent = parts.join(' · ') || 'Driver / Car';
        }
    }

    // Custom classes for each game (not in the game class list), newest first
    const RECENT_CLASSES_KEY = 'recentClasses';
    const MAX_RECENT_CLASSES = 8;

    function recentClasses(game) {
        let saved = [];
        try {
            saved = JSON.parse(localStorage.getItem(`${RECENT_CLASSES_KEY}_${game}`) || '[]');
        } catch (e) { /* the list is only a convenience */ }
        const fromRuns = (window.AutocrossApp?.getAllRuns() || [])
            .filter(r => r.game === game && r.carClass)
            .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
            .map(r => r.carClass);
        return [...new Set([...saved, ...fromRuns])].slice(0, MAX_RECENT_CLASSES);
    }

    function rememberClass(game, carClass) {
        if (!game || !carClass) return;
        const classes = [carClass, ...recentClasses(game).filter(c => c !== carClass)].slice(0, MAX_RECENT_CLASSES);
        try {
            localStorage.setItem(`${RECENT_CLASSES_KEY}_${game}`, JSON.stringify(classes));
        } catch (e) { /* the list is only a convenience */ }
    }

    async function sendDetails(details) {
        const response = await fetch(`http://${window.location.hostname}:8888/autocross/recording/driver`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(details)
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'not saved');
    }

    // Details for new runs, kept on this device while the recorder is not reachable
    const PENDING_DETAILS_KEY = 'recorder_pendingDetails';

    function readPendingDetails() {
        try {
            return JSON.parse(localStorage.getItem(PENDING_DETAILS_KEY));
        } catch (e) {
            return null;
        }
    }

    // Sends the kept details to the recorder. Returns true when it sent them.
    async function pushPendingDetails() {
        const pending = readPendingDetails();
        if (!pending) return false;
        try {
            await sendDetails(pending);
            localStorage.removeItem(PENDING_DETAILS_KEY);
            return true;
        } catch (e) {
            return false;
        }
    }

    // Gives the details to the recorder. When it is not reachable (no game running), this device
    // keeps them and sends them at the next Start. Returns false in that case.
    async function saveCurrentDriver(driver, car, carClass) {
        const details = { driver, car, carClass };
        setCurrentDriver(driver, car, carClass);
        try {
            await sendDetails(details);
            localStorage.removeItem(PENDING_DETAILS_KEY);
            return true;
        } catch (e) {
            localStorage.setItem(PENDING_DETAILS_KEY, JSON.stringify(details));
            return false;
        }
    }

    // Start gives new runs no class and no car, unless the user set them before Start
    async function clearDetailsForStart() {
        localStorage.setItem(SESSION_START_KEY, String(Date.now()));
        if (!detailsSetBeforeStart && (currentDriver.carClass || currentDriver.car)) {
            await saveCurrentDriver(currentDriver.driver, '', '');
            window.AutocrossApp?.setSessionClass('', true);
        }
        detailsSetBeforeStart = false;
    }

    // Runs since the last Start without a driver or a class
    function sessionRunsMissingDetails() {
        const since = Number(localStorage.getItem(SESSION_START_KEY)) || 0;
        if (!since) return [];
        return (window.AutocrossApp?.getAllRuns() || []).filter(r =>
            new Date(r.timestamp).getTime() >= since && (!r.driver || !r.carClass));
    }

    const NEW_DRIVER = '__new_driver__';
    const OTHER_CLASS = '__other_class__';

    function fillSelect(select, options, value) {
        select.innerHTML = options
            .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
            .join('');
        select.value = value;
    }

    // Driver list with "+ New driver…" and a ⋮ menu to rename or remove the driver.
    // el: { select, menuBtn, menu, renameBtn, removeBtn }. Returns { value(), detach() }.
    function attachDriverPicker(el, drivers, selected) {
        let current = selected || '';

        const fill = (list, value) => {
            const names = [...new Set([...list, value].filter(Boolean))].sort((a, b) => a.localeCompare(b));
            fillSelect(el.select, [
                { value: '', label: 'No driver' },
                ...names.map(d => ({ value: d, label: d })),
                { value: NEW_DRIVER, label: '+ New driver…' }
            ], value || '');
            current = value || '';
            el.renameBtn.disabled = !current;
            el.removeBtn.disabled = !current;
        };

        // "+ New driver…" asks for the name; Cancel selects the previous driver again
        const onChange = async () => {
            if (el.select.value !== NEW_DRIVER) {
                current = el.select.value;
                el.renameBtn.disabled = !current;
                el.removeBtn.disabled = !current;
                return;
            }
            const name = await window.AutocrossApp.promptDialog({
                title: 'New driver', label: 'Name:', placeholder: 'e.g., Jesse', confirmLabel: 'Add'
            });
            if (!name) {
                el.select.value = current;
                return;
            }
            try {
                fill(await apiRequest('addDriver', { name }), name);
            } catch (err) {
                el.select.value = current;
                showToast('Could not add the driver.', 'error');
            }
        };
        const toggleMenu = (e) => {
            e.stopPropagation();
            el.menu.classList.toggle('hidden');
        };
        const closeMenu = (e) => {
            if (!el.menu.contains(e.target)) el.menu.classList.add('hidden');
        };
        const rename = async () => {
            el.menu.classList.add('hidden');
            const from = current;
            if (!from) return;
            const to = await window.AutocrossApp.promptDialog({
                title: 'Rename driver', label: 'Name:', value: from, confirmLabel: 'Rename'
            });
            if (!to || to === from) return;
            try {
                const result = await apiRequest('renameDriver', { from, to });
                fill(result.drivers, to);
                if (currentDriver.driver === from) setCurrentDriver(to, currentDriver.car, currentDriver.carClass);
                if (result.runs) await window.AutocrossApp?.refreshRuns();
            } catch (err) {
                showToast('Could not rename the driver.', 'error');
            }
        };
        const remove = async () => {
            el.menu.classList.add('hidden');
            const name = current;
            if (!name) return;
            const ok = await window.AutocrossApp?.confirmDialog({
                title: 'Remove driver',
                message: `${name} is removed from the driver list. Runs keep their driver.`,
                confirmLabel: 'Remove',
                danger: true
            });
            if (!ok) return;
            try {
                fill(await apiRequest('removeDriver', { name }), '');
            } catch (err) {
                showToast('Could not remove the driver.', 'error');
            }
        };

        fill(drivers, current);
        el.menu.classList.add('hidden');
        el.select.addEventListener('change', onChange);
        el.menuBtn.addEventListener('click', toggleMenu);
        document.addEventListener('click', closeMenu);
        el.renameBtn.addEventListener('click', rename);
        el.removeBtn.addEventListener('click', remove);

        return {
            value: () => current,
            detach: () => {
                el.select.removeEventListener('change', onChange);
                el.menuBtn.removeEventListener('click', toggleMenu);
                document.removeEventListener('click', closeMenu);
                el.renameBtn.removeEventListener('click', rename);
                el.removeBtn.removeEventListener('click', remove);
            }
        };
    }

    // Class list: "Any", the game classes, recent classes and "Other…" (typed).
    // Returns { value(), detach() }; value() is the class to save.
    async function attachClassPicker(select, otherInput, game, selected) {
        const gameClasses = game ? ((await gameInfo(game))?.classes || []) : [];
        const classes = [...new Set([...gameClasses, ...recentClasses(game), selected].filter(Boolean))];
        fillSelect(select, [
            { value: '', label: 'Any (no class)' },
            ...classes.map(c => ({ value: c, label: c })),
            { value: OTHER_CLASS, label: 'Other…' }
        ], selected || '');
        otherInput.classList.add('hidden');
        otherInput.value = '';

        const onChange = () => {
            const other = select.value === OTHER_CLASS;
            otherInput.classList.toggle('hidden', !other);
            if (other) otherInput.focus();
        };
        select.addEventListener('change', onChange);

        return {
            value: () => {
                const carClass = select.value === OTHER_CLASS ? otherInput.value.trim() : select.value;
                if (carClass && !gameClasses.includes(carClass)) rememberClass(game, carClass);
                return carClass;
            },
            detach: () => select.removeEventListener('change', onChange)
        };
    }

    // Driver picker elements; the run details dialog uses the same IDs with a "run" prefix
    function driverPickerElements(prefix = '') {
        const id = (name) => document.getElementById(prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name);
        return {
            select: id('driverSelect'),
            menuBtn: id('driverMenuBtn'),
            menu: id('driverMenu'),
            renameBtn: id('renameDriverBtn'),
            removeBtn: id('removeDriverBtn')
        };
    }

    // Driver, class and car dialog. Driver and class come from lists. The car name is typed,
    // and only for a game without car IDs. A class from the game replaces the class set here.
    async function openNamingModal() {
        const modal = document.getElementById('nameIdentifiersModal');
        const form = document.getElementById('nameIdentifiersForm');
        const classSelect = document.getElementById('classSelect');
        const carNameInput = document.getElementById('carNameInput');
        const trackNameInput = document.getElementById('trackNameInput');
        const applyCheck = document.getElementById('applyRunsCheck');
        const cancelBtn = document.getElementById('cancelNameIdentifiers');

        const [telem, trackMappings, status, drivers] = await Promise.all([
            getLiveTelemetry(),
            getTrackMappings().catch(() => ({})),
            getRecorderStatus().catch(() => ({})),
            apiRequest('getDrivers').catch(() => [])
        ]);
        const game = await currentGame(status);
        const gameClasses = game ? ((await gameInfo(game))?.classes || []) : [];
        const carId = telem && telem.CarId ? String(telem.CarId) : (telem && telem.CarOrdinal ? String(telem.CarOrdinal) : '');
        const trackId = status.trackId ? String(status.trackId) : '';
        const liveClass = telem && telem.CarClass !== undefined
            ? (gameClasses[telem.CarClass] || `Class ${telem.CarClass}`)
            : '';

        window.AutocrossApp?.fillDetailOptions();

        const driverPicker = attachDriverPicker(driverPickerElements(), drivers, currentDriver.driver);
        const classPicker = await attachClassPicker(classSelect, document.getElementById('classOtherInput'),
            game, liveClass || currentDriver.carClass);
        classSelect.disabled = !!liveClass;
        document.getElementById('classNote').textContent = liveClass
            ? `The game sends the class (${liveClass}). New runs get it.`
            : '';

        // Car name only when the game sends no car ID
        document.getElementById('carNameGroup').classList.toggle('hidden', !!carId);
        carNameInput.value = carId ? '' : currentDriver.car;

        // Track name for a game track ID
        document.getElementById('trackNameGroup').classList.toggle('hidden', !trackId);
        trackNameInput.value = trackMappings[trackId] || '';
        document.getElementById('trackIdNote').textContent = trackId ? `Game track ID ${trackId}` : '';

        // Runs since Start without the details
        const missing = sessionRunsMissingDetails();
        document.getElementById('applyRunsLabel').classList.toggle('hidden', missing.length === 0);
        applyCheck.checked = true;
        document.getElementById('applyRunsText').textContent =
            `Also set the ${missing.length} run${missing.length !== 1 ? 's' : ''} since Start that have no driver or class`;

        modal.classList.remove('hidden');

        const close = () => {
            modal.classList.add('hidden');
            form.removeEventListener('submit', handleSubmit);
            cancelBtn.removeEventListener('click', close);
            driverPicker.detach();
            classPicker.detach();
        };

        const handleSubmit = async (e) => {
            e.preventDefault();
            const driver = driverPicker.value();
            const carClass = liveClass ? currentDriver.carClass : classPicker.value();
            const car = carId ? '' : carNameInput.value.trim();
            const trackName = trackNameInput.value.trim();
            const classChanged = carClass !== currentDriver.carClass;
            try {
                if (trackId && trackName) await apiRequest('setTrackName', { trackId, name: trackName });
                const sent = await saveCurrentDriver(driver, car, carClass);
                if (state === STATE.IDLE) detailsSetBeforeStart = true;
                if (!sent) showToast('Saved. The recorder gets these details when you press Start.', 'info');

                if (applyCheck.checked && missing.length) {
                    const courseId = window.AutocrossApp?.getCurrentCourse();
                    await Promise.all(missing.map(run => apiRequest('updateRun', {
                        courseId,
                        runId: run.runId,
                        driver: run.driver ? undefined : (driver || undefined),
                        carClass: run.carClass ? undefined : (carClass || undefined),
                        car: run.car || run.carId ? undefined : (car || undefined)
                    })));
                }

                close();
                if (classChanged) window.AutocrossApp?.setSessionClass(carClass, true);
                await window.AutocrossApp?.refreshRuns();
            } catch (err) {
                console.error('Could not save driver, class and car:', err);
                showToast('Could not save the details: ' + err.message, 'error');
            }
        };

        form.addEventListener('submit', handleSubmit);
        cancelBtn.addEventListener('click', close);
    }

    // Driver and class lists for the run details dialog. Returns { driver(), carClass(), detach() }.
    async function attachRunDetailPickers(run) {
        const drivers = await apiRequest('getDrivers').catch(() => []);
        const driverPicker = attachDriverPicker(driverPickerElements('run'), drivers, run.driver);
        const classPicker = await attachClassPicker(document.getElementById('runClassSelect'),
            document.getElementById('runClassOtherInput'), run.game ? String(run.game).toUpperCase() : '', run.carClass);
        return {
            driver: driverPicker.value,
            carClass: classPicker.value,
            detach: () => { driverPicker.detach(); classPicker.detach(); }
        };
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
                    followTrack(status);
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

    // While armed, a new track ID from the game (another stage or track) moves recording
    // to the course of that track. Courses without a track ID stay as the user selected.
    let followingTrack = false;
    let followedTrackId = '';
    async function followTrack(status) {
        const trackId = status.trackId ? String(status.trackId) : '';
        if (!trackId || trackId === followedTrackId || followingTrack || status.runActive) return;
        followingTrack = true;
        followedTrackId = trackId;
        try {
            const courses = await getCourses();
            const current = courses.find(c => c.courseId === currentCourseId);
            if (!current || !current.trackId || current.trackId === 'manual' || current.trackId === trackId) return;

            lastTelemetry = await getLiveTelemetry();
            const courseId = await resolveCourseForTrack(trackId, await gameName(status.game));
            if (!courseId || courseId === currentCourseId) return;
            currentCourseId = courseId;
            localStorage.setItem('recorder_courseId', courseId);
            await rearm(courseId);
        } catch (e) {
            console.error('Recorder: could not follow the track change', e);
        } finally {
            followingTrack = false;
        }
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
        isRecording: () => state === STATE.RECORDING,
        attachRunDetailPickers
    };
})();

// Export to window
window.AutocrossRecorder = AutocrossRecorder;
