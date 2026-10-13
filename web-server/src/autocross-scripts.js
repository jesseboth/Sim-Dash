// Autocross Telemetry Analyzer - Main Script

// Global State
let currentCourse = null;
let currentCourseData = null; // Store full course data including archive status
let allRuns = [];
let selectedRuns = [];
let loadedRuns = {}; // Cache for full run data with telemetry
let mostRecentOnTop = true; // Track "Recent on top" toggle state
let courseLoadToken = 0; // Increments per course load so stale responses are ignored
let runsLoadToken = 0; // Increments per visualization load so stale loads are ignored
let lastLoadedSignature = ''; // Runs, order and cones last sent to the visualizations
let shownRuns = []; // Run objects currently in the visualizations
let runSortMode = 'fastest'; // 'fastest' or 'recent'
let carFilter = 'all'; // 'all' or a carId
let carNames = {}; // carId -> friendly name
let runNumbers = new Map(); // runId -> run number in driving order
let newRunIds = new Map(); // runId -> time the NEW highlight ends
let newRunTimer = null;
let lastRefreshedCourse = null;

const CONE_PENALTY = 2; // seconds per cone
const MAX_SELECTED_RUNS = 6;
const NEW_RUN_HIGHLIGHT_MS = 20000;
const RUN_COLORS = ['#4a9eff', '#ff4a4a', '#4aff4a', '#ffaa4a', '#ff4aff', '#4affff'];
const RECENT_COLOR = '#7d5aff';

// DOM Elements
const courseSelector = document.getElementById('courseSelector');
const runsList = document.getElementById('runsList');
const top10List = document.getElementById('top10List');
const top10Panel = document.getElementById('top10Panel');
const deleteRunBtn = document.getElementById('deleteRunBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const toastContainer = document.getElementById('toastContainer');
const runCount = document.getElementById('runCount');

// API Helper
async function apiRequest(action, data = {}) {
    try {
        const response = await fetch('/autocross/api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action, ...data })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Unknown error');
        }

        return result.data;
    } catch (error) {
        console.error('API Error:', error);
        showToast('Error: ' + error.message, 'error');
        throw error;
    }
}

// Lap time including cone penalties
function getAdjustedTime(run) {
    return run.lapTime + ((run.cones || 0) * CONE_PENALTY);
}

function sortByAdjustedTime(runs) {
    return [...runs].sort((a, b) => getAdjustedTime(a) - getAdjustedTime(b));
}

function findMostRecentRun(runs) {
    if (runs.length === 0) return null;
    return runs.reduce((latest, run) =>
        new Date(run.timestamp) > new Date(latest.timestamp) ? run : latest, runs[0]);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Toast Notification
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Loading Indicator
function showLoading() {
    loadingIndicator.classList.remove('hidden');
}

function hideLoading() {
    loadingIndicator.classList.add('hidden');
}

// Initialize Page
async function init() {
    console.log('Initializing Autocross Telemetry Analyzer...');

    // Load "Recent on top" preference
    const savedPreference = localStorage.getItem('mostRecentOnTop');
    if (savedPreference !== null) {
        mostRecentOnTop = savedPreference === 'true';
    }
    runSortMode = localStorage.getItem('runSortMode') === 'recent' ? 'recent' : 'fastest';
    updateSortButtons();

    // Load courses
    await loadCourses();

    // Setup event listeners
    setupEventListeners();

    // Initialize archive button state (disabled initially)
    updateArchiveButtonState();
    updateHint();

    // Initialize recorder
    if (window.AutocrossRecorder) {
        window.AutocrossRecorder.init();
    }

    console.log('Initialization complete');
}

// Setup Event Listeners
function setupEventListeners() {
    // Course selector
    courseSelector.addEventListener('change', handleCourseChange);

    // Delete run button
    deleteRunBtn.addEventListener('click', handleDeleteRun);

    // Export button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', handleExportRuns);
    }

    // Import button
    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    if (importBtn && importFileInput) {
        importBtn.addEventListener('click', () => {
            importFileInput.click();
        });
        importFileInput.addEventListener('change', handleImportRuns);
    }

    // Archive button
    const archiveBtn = document.getElementById('archiveBtn');
    if (archiveBtn) {
        archiveBtn.addEventListener('click', handleArchiveClick);
    }

    // Clear selections button
    const clearSelectionsBtn = document.getElementById('clearSelectionsBtn');
    if (clearSelectionsBtn) {
        clearSelectionsBtn.addEventListener('click', handleClearSelections);
    }

    // Rename modal
    const renameModal = document.getElementById('renameModal');
    const renameRunForm = document.getElementById('renameRunForm');
    const cancelRename = document.getElementById('cancelRename');

    if (cancelRename && renameModal) {
        cancelRename.addEventListener('click', () => {
            renameModal.classList.add('hidden');
            renameRunForm.reset();
        });
    }

    if (renameModal) {
        renameModal.addEventListener('click', (e) => {
            if (e.target === renameModal) {
                renameModal.classList.add('hidden');
                renameRunForm.reset();
            }
        });
    }

    if (renameRunForm) {
        renameRunForm.addEventListener('submit', handleRenameSubmit);
    }

    // Archive modal
    const archiveModal = document.getElementById('archiveModal');
    const archiveForm = document.getElementById('archiveForm');
    const cancelArchive = document.getElementById('cancelArchive');

    if (cancelArchive && archiveModal) {
        cancelArchive.addEventListener('click', () => {
            archiveModal.classList.add('hidden');
            archiveForm.reset();
        });
    }

    if (archiveModal) {
        archiveModal.addEventListener('click', (e) => {
            if (e.target === archiveModal) {
                archiveModal.classList.add('hidden');
                archiveForm.reset();
            }
        });
    }

    if (archiveForm) {
        archiveForm.addEventListener('submit', handleArchiveSubmit);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Runs toggle buttons (mobile/tablet)
    const runsToggle = document.getElementById('runsToggle');
    const runsToggleExpanded = document.getElementById('runsToggleExpanded');
    const runsSection = document.querySelector('.runs-section');

    if (runsSection) {
        // Start collapsed by default on all screens
        runsSection.classList.add('collapsed');
        document.body.classList.add('runs-collapsed');

        const toggleCollapse = () => {
            runsSection.classList.toggle('collapsed');

            // Toggle body class for padding adjustment
            if (runsSection.classList.contains('collapsed')) {
                document.body.classList.add('runs-collapsed');
            } else {
                document.body.classList.remove('runs-collapsed');
            }
        };

        if (runsToggle) {
            runsToggle.addEventListener('click', toggleCollapse);
        }
        if (runsToggleExpanded) {
            runsToggleExpanded.addEventListener('click', toggleCollapse);
        }
    }

    // Listen for "Recent on top" toggle changes from map
    const mostRecentToggle = document.getElementById('mostRecentOnTopToggle');
    if (mostRecentToggle) {
        mostRecentToggle.addEventListener('change', handleMostRecentToggle);
    }

    // Run list sort order
    document.querySelectorAll('[data-sort]').forEach(btn => {
        btn.addEventListener('click', () => {
            runSortMode = btn.dataset.sort;
            localStorage.setItem('runSortMode', runSortMode);
            updateSortButtons();
            renderRunsList();
            syncSelectionUI();
        });
    });

    // Car filter
    document.getElementById('carFilter')?.addEventListener('change', (e) => {
        carFilter = e.target.value;
        if (currentCourse) localStorage.setItem(`carFilter_${currentCourse}`, carFilter);
        renderRunsList();
        syncSelectionUI();
    });

    // Hint bar
    document.getElementById('hintDismiss')?.addEventListener('click', () => {
        const hint = document.getElementById('hintBar');
        if (hint && hint.dataset.hintId) {
            localStorage.setItem(`hintDismissed_${hint.dataset.hintId}`, 'true');
        }
        updateHint();
    });

    // Confirm dialog
    document.getElementById('confirmCancel')?.addEventListener('click', () => closeConfirmDialog(false));
    document.getElementById('confirmOk')?.addEventListener('click', () => closeConfirmDialog(true));
    document.getElementById('confirmModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') closeConfirmDialog(false);
    });

    if (window.AutocrossAlign) {
        AutocrossAlign.onChange(handleAlignChange);
    }
}

function updateSortButtons() {
    document.querySelectorAll('[data-sort]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === runSortMode);
    });
}

// --- Confirm dialog ---
let confirmResolve = null;

// Ask a yes/no question in a dialog. Resolves to true when confirmed.
function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
    if (confirmResolve) closeConfirmDialog(false);
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const okBtn = document.getElementById('confirmOk');
    okBtn.textContent = confirmLabel;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    document.getElementById('confirmModal').classList.remove('hidden');
    setTimeout(() => okBtn.focus(), 50);
    return new Promise(resolve => { confirmResolve = resolve; });
}

function closeConfirmDialog(result) {
    document.getElementById('confirmModal')?.classList.add('hidden');
    if (confirmResolve) {
        const resolve = confirmResolve;
        confirmResolve = null;
        resolve(result);
    }
}

// --- First-use hints: one short tip for the next useful step ---
function updateHint() {
    const bar = document.getElementById('hintBar');
    if (!bar) return;

    let hint = null;
    const alignActive = window.AutocrossAlign && AutocrossAlign.isActive();
    const sectorCount = window.AutocrossSectors ? AutocrossSectors.getSectors().length : 0;

    if (!currentCourse) {
        hint = { id: 'start', text: 'Press Start, then drive in Assetto Corsa. A course is created for your track, and each run saves when you cross the finish.' };
    } else if (allRuns.length === 0) {
        hint = { id: 'firstRun', text: 'Press Start and drive a run. It saves when you cross the finish line.' };
    } else if (selectedRuns.length < 2) {
        hint = { id: 'compare', text: 'Tap runs in the list (open it with ▲ at the bottom) to compare up to 6 runs.' };
    } else if (!alignActive) {
        hint = { id: 'align', text: 'Tap a car on the map to line the other cars up with it and see the time gaps.' };
    } else if (sectorCount === 0) {
        hint = { id: 'sectors', text: 'Move the timeline to a point on the track and press + Sector to split the course into sectors.' };
    }

    if (hint && localStorage.getItem(`hintDismissed_${hint.id}`) === 'true') {
        hint = null;
    }

    bar.classList.toggle('hidden', !hint);
    if (hint) {
        bar.dataset.hintId = hint.id;
        document.getElementById('hintText').textContent = hint.text;
    }
}

// Handle "Recent on top" toggle changes
async function handleMostRecentToggle(e) {
    mostRecentOnTop = e.target.checked;

    // Save preference to localStorage
    localStorage.setItem('mostRecentOnTop', mostRecentOnTop.toString());

    if (mostRecentOnTop) {
        // Don't deselect the old most recent run when toggling on
        applyMostRecentSelection(false);
        syncSelectionUI();
        saveSelectedRunsToStorage();
    }

    // Reload visualizations to update colors when toggle changes
    await loadSelectedRuns();
}

// Handle Keyboard Shortcuts
function handleKeyboardShortcuts(e) {
    if (e.key === 'Escape') {
        closeOpenModals();
        return;
    }

    // Don't trigger shortcuts when typing, using a dropdown, or with a dialog open
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
        return;
    }
    if (document.querySelector('.modal:not(.hidden)')) {
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
    }

    switch (e.key) {
        case ' ': // Space - Play/Pause scrubber
            e.preventDefault();
            const playPauseBtn = document.getElementById('playPauseBtn');
            if (playPauseBtn) {
                playPauseBtn.click();
            }
            break;

        case 'r':
        case 'R': // R - Toggle recording
            e.preventDefault();
            const toggleBtn = document.getElementById('toggleRecordingBtn');
            if (toggleBtn && !toggleBtn.disabled) {
                toggleBtn.click();
            }
            break;

        case 'Delete':
        case 'Backspace': // Delete - Delete selected runs
            e.preventDefault();
            if (!deleteRunBtn.disabled) {
                handleDeleteRun();
            }
            break;

        case 'ArrowLeft':
        case 'ArrowRight': // Step the timeline (Shift = 1 s)
            if (window.AutocrossScrubber) {
                e.preventDefault();
                const stepSize = e.shiftKey ? 1 : 0.1;
                AutocrossScrubber.step(e.key === 'ArrowLeft' ? -stepSize : stepSize);
            }
            break;

        case '?': // ? - Show help
            e.preventDefault();
            showKeyboardHelp();
            break;
    }
}

// Close any open dialog the same way its Cancel button does
function closeOpenModals() {
    document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
        const cancelBtn = modal.querySelector('#cancelRename, #cancelArchive, #cancelNameIdentifiers, #cancelDeleteSector, #closeSectorsModal, #confirmCancel, #closeCourseModal, #cancelCourseChooser, #channelsCancelBtn');
        if (cancelBtn) {
            cancelBtn.click();
        } else {
            modal.classList.add('hidden');
        }
    });
}

// Show keyboard help
function showKeyboardHelp() {
    const helpText = [
        'Keyboard Shortcuts:',
        '- Space: Play/Pause scrubber',
        '- Left/Right: Step 0.1 s (Shift: 1 s)',
        '- R: Arm/Disarm recording',
        '- Delete/Backspace: Delete selected runs',
        '- Escape: Close dialog',
        '- ?: Show this help'
    ].join('\n');
    showToast(helpText, 'info');
}

// Load Courses
async function loadCourses() {
    try {
        const courses = await apiRequest('getCourses');
        renderCourseOptions(courses);

        // If there's a saved course selection, restore it
        const savedCourseId = localStorage.getItem('selectedCourse');
        if (savedCourseId && courses.some(c => c.courseId === savedCourseId)) {
            courseSelector.value = savedCourseId;
            await handleCourseChange();
        }
    } catch (error) {
        console.error('Failed to load courses:', error);
    }
}

// Fill the course dropdown: active first (newest to oldest), then archived (newest to oldest)
function renderCourseOptions(courses) {
    const selectedValue = courseSelector.value;

    const sortedCourses = [...courses].sort((a, b) => {
        const aArchived = a.isArchived || false;
        const bArchived = b.isArchived || false;

        if (aArchived !== bArchived) {
            return aArchived ? 1 : -1;
        }

        const aDate = new Date(a.archivedDate || a.dateCreated);
        const bDate = new Date(b.archivedDate || b.dateCreated);
        return bDate - aDate;
    });

    courseSelector.innerHTML = '<option value="">Select a course...</option>';

    let archivedSeparatorAdded = false;

    sortedCourses.forEach(course => {
        // Add separator before first archived course
        if (course.isArchived && !archivedSeparatorAdded) {
            const separator = document.createElement('option');
            separator.disabled = true;
            separator.textContent = '─────── Archived ───────';
            courseSelector.appendChild(separator);
            archivedSeparatorAdded = true;
        }

        const option = document.createElement('option');
        option.value = course.courseId;

        let displayName = course.name;
        if (course.isArchived && course.archivedEventName) {
            displayName = `📦 ${course.archivedEventName} - ${course.archivedCarName}`;
        }
        displayName += ` (${course.runCount} run${course.runCount !== 1 ? 's' : ''})`;

        option.textContent = displayName;
        courseSelector.appendChild(option);
    });

    if (selectedValue && courses.some(c => c.courseId === selectedValue)) {
        courseSelector.value = selectedValue;
    }
}

// Handle Course Change
async function handleCourseChange() {
    const courseId = courseSelector.value;
    const token = ++courseLoadToken;

    if (!courseId) {
        currentCourse = null;
        currentCourseData = null;
        allRuns = [];
        selectedRuns = [];
        shownRuns = [];
        lastRefreshedCourse = null;
        localStorage.removeItem('selectedCourse');
        clearRunsList();
        clearVisualization();
        updateButtonStates();
        updateArchiveButtonState();
        if (window.AutocrossSectors) AutocrossSectors.loadSectors(null);
        if (window.AutocrossRecorder) window.AutocrossRecorder.setCourse(null);
        updateHint();
        return;
    }

    try {
        showLoading();

        localStorage.setItem('selectedCourse', courseId);

        currentCourse = courseId;
        selectedRuns = readStoredSelection(courseId);
        carFilter = localStorage.getItem(`carFilter_${courseId}`) || 'all';
        lastLoadedSignature = '';
        runsLoadToken++;
        clearVisualization();

        await Promise.all([
            refreshRuns({ deselectOldMostRecent: true }),
            window.AutocrossSectors ? AutocrossSectors.loadSectors(courseId) : null
        ]);
        if (token !== courseLoadToken) return;

        if (window.AutocrossRecorder) {
            window.AutocrossRecorder.setCourse(courseId);
        }
    } catch (error) {
        console.error('Failed to load course:', error);
    } finally {
        if (token === courseLoadToken) hideLoading();
    }
}

// Reload runs, top 10 and course info for the current course.
// Keeps the current selection and only redraws the visualizations when they change.
async function refreshRuns({ deselectOldMostRecent = true } = {}) {
    const courseId = currentCourse;
    if (!courseId) return;
    const token = courseLoadToken;

    const [courses, runs] = await Promise.all([
        apiRequest('getCourses'),
        apiRequest('getRuns', { courseId })
    ]);
    const names = await resolveCarNames(runs);

    // Ignore the result if the user switched course while loading
    if (token !== courseLoadToken || courseId !== currentCourse) return;

    // Runs that appeared since the last refresh of this course are marked as new
    if (lastRefreshedCourse === courseId) {
        const knownIds = new Set(allRuns.map(r => r.runId));
        runs.filter(r => !knownIds.has(r.runId))
            .forEach(r => newRunIds.set(r.runId, Date.now() + NEW_RUN_HIGHLIGHT_MS));
    } else {
        newRunIds.clear();
    }
    lastRefreshedCourse = courseId;

    renderCourseOptions(courses);
    currentCourseData = courses.find(c => c.courseId === courseId) || null;
    allRuns = runs;
    carNames = names;
    updateRunNumbers();

    // Drop selections of runs that no longer exist
    const existingIds = new Set(runs.map(r => r.runId));
    selectedRuns = selectedRuns.filter(id => existingIds.has(id));

    if (mostRecentOnTop) {
        applyMostRecentSelection(deselectOldMostRecent);
    }

    updateCarFilter();
    renderRunsList();
    syncSelectionUI();
    saveSelectedRunsToStorage();
    updateButtonStates();
    updateArchiveButtonState();
    updateHint();

    await loadSelectedRuns();
}

// Run numbers follow the order runs were driven (Run 1 = first run of the course)
function updateRunNumbers() {
    runNumbers = new Map();
    [...allRuns]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .forEach((run, i) => runNumbers.set(run.runId, i + 1));
}

// Resolve car names for a list of runs - sends unique IDs, gets back a name map
async function resolveCarNames(runs) {
    const uniqueCarIds = [...new Set(runs.map(r => r.carId).filter(Boolean))];
    if (uniqueCarIds.length === 0) return {};

    try {
        return await apiRequest('getCarNames', { carIds: uniqueCarIds });
    } catch (e) {
        return {};
    }
}

function getCarName(carId) {
    return carId ? (carNames[carId] || `Car ${carId}`) : 'Unknown car';
}

// Runs shown in the list: filtered by car
function getVisibleRuns() {
    return carFilter === 'all' ? allRuns : allRuns.filter(r => r.carId === carFilter);
}

// Show the car filter only when the course has runs from more than one car
function updateCarFilter() {
    const select = document.getElementById('carFilter');
    if (!select) return;

    const carIds = [...new Set(allRuns.map(r => r.carId).filter(Boolean))];
    if (carFilter !== 'all' && !carIds.includes(carFilter)) {
        carFilter = 'all';
    }

    select.innerHTML = '<option value="all">All cars</option>' + carIds
        .map(id => `<option value="${escapeHtml(id)}">${escapeHtml(getCarName(id))}</option>`)
        .join('');
    select.value = carFilter;
    select.classList.toggle('hidden', carIds.length < 2);
}

// Render Runs List
function renderRunsList() {
    const runs = getVisibleRuns();

    const countText = carFilter === 'all'
        ? `${allRuns.length} run${allRuns.length !== 1 ? 's' : ''}`
        : `${runs.length} of ${allRuns.length} runs`;
    if (runCount) {
        runCount.textContent = countText;
    }
    const runCountCollapsed = document.getElementById('runCountCollapsed');
    if (runCountCollapsed) {
        runCountCollapsed.textContent = countText;
    }

    renderTop10(runs);

    if (runs.length === 0) {
        runsList.innerHTML = allRuns.length === 0
            ? '<div class="empty-state">No runs recorded yet. Press Start, then drive. Each run saves when you cross the finish.</div>'
            : '<div class="empty-state">No runs with this car.</div>';
        return;
    }

    const byTime = sortByAdjustedTime(runs);
    const rankById = new Map(byTime.map((r, i) => [r.runId, i + 1]));
    const fastestTime = getAdjustedTime(byTime[0]);
    const bestSectors = computeBestSectorTimes(runs);
    const showCar = new Set(allRuns.map(r => r.carId)).size > 1;

    const ordered = runSortMode === 'recent'
        ? [...runs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        : byTime;

    runsList.innerHTML = '';
    const now = Date.now();

    ordered.forEach(run => {
        const card = document.createElement('div');
        card.className = 'run-card';
        card.dataset.runId = run.runId;
        const isNew = (newRunIds.get(run.runId) || 0) > now;
        if (isNew) card.classList.add('run-new');

        const date = new Date(run.timestamp);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toDateString() === new Date().toDateString() ? 'Today' : date.toLocaleDateString();

        const cones = run.cones || 0;
        const adjustedTime = getAdjustedTime(run);
        const isFastest = adjustedTime === fastestTime;
        const rank = rankById.get(run.runId);

        card.innerHTML = `
            <input type="checkbox" class="run-card-checkbox" data-run-id="${escapeHtml(run.runId)}">
            <div class="run-card-info">
                <div class="run-card-main">
                    <span class="run-number">Run ${runNumbers.get(run.runId)}</span>
                    <span class="run-time ${isFastest ? 'fastest' : ''}">${formatLapTime(adjustedTime)}</span>
                    <span class="run-rank" title="Position by time">P${rank}</span>
                    ${isNew ? '<span class="run-new-badge">NEW</span>' : ''}
                    ${run.name ? `<span class="run-name">📝 ${escapeHtml(run.name)}</span>` : ''}
                </div>
                <div class="run-card-details">
                    <span>${dateStr} ${timeStr}</span>
                    ${showCar ? `<span class="run-car">🚗 ${escapeHtml(getCarName(run.carId))}</span>` : ''}
                    ${cones > 0 ? `<span style="color: var(--accent-warning)">🚧 ${cones} cone${cones !== 1 ? 's' : ''} (+${cones * CONE_PENALTY}s)</span>` : ''}
                    ${run.isValid ? '' : '<span style="color: var(--accent-secondary)">❌ Invalid</span>'}
                </div>
                ${renderSectorTimesRow(run, bestSectors)}
            </div>
            <div class="run-card-actions">
                <div class="cone-controls">
                    <button class="btn-icon cone-minus" title="Remove cone">−</button>
                    <span class="cone-count">${cones}</span>
                    <button class="btn-icon cone-plus" title="Add cone">+</button>
                </div>
                <button class="btn btn-secondary btn-sm rename-run" title="Rename">✏️</button>
            </div>
        `;

        const checkbox = card.querySelector('.run-card-checkbox');
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            handleRunSelection(e);
        });

        const renameBtn = card.querySelector('.rename-run');
        renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showRenameModal(run.runId, run.name || '');
        });

        card.querySelector('.cone-plus').addEventListener('click', (e) => {
            e.stopPropagation();
            handleConeChange(run.runId, 1);
        });

        card.querySelector('.cone-minus').addEventListener('click', (e) => {
            e.stopPropagation();
            handleConeChange(run.runId, -1);
        });

        // Click card to toggle selection
        card.addEventListener('click', (e) => {
            const isControl = e.target === checkbox || e.target === renameBtn ||
                              e.target.closest('.cone-controls');
            if (!isControl) {
                checkbox.checked = !checkbox.checked;
                handleRunSelection({ target: checkbox });
            }
        });

        runsList.appendChild(card);
    });

    // Remove the NEW highlight when it expires
    if (newRunIds.size > 0) {
        clearTimeout(newRunTimer);
        const nextExpiry = Math.min(...newRunIds.values());
        newRunTimer = setTimeout(() => {
            const t = Date.now();
            newRunIds.forEach((expiry, id) => { if (expiry <= t) newRunIds.delete(id); });
            renderRunsList();
            syncSelectionUI();
        }, Math.max(0, nextExpiry - now) + 50);
    }
}

// Best time per sector across the given runs
function computeBestSectorTimes(runs) {
    const best = [];
    runs.forEach(run => {
        (run.sectorTimes || []).forEach((t, i) => {
            if (t !== null && (best[i] === undefined || t < best[i])) best[i] = t;
        });
    });
    return best;
}

// Compact sector times for a run card, best per sector in green
function renderSectorTimesRow(run, bestSectors) {
    const times = run.sectorTimes || [];
    if (times.length === 0) return '';

    const cells = times.map((t, i) => {
        if (t === null) return `<span class="run-sector">S${i + 1} —</span>`;
        const isBest = bestSectors[i] !== undefined && Math.abs(t - bestSectors[i]) < 0.001;
        const delta = isBest ? '' : `<span class="run-sector-delta">+${(t - bestSectors[i]).toFixed(2)}</span>`;
        return `<span class="run-sector${isBest ? ' best' : ''}">S${i + 1} ${t.toFixed(2)}${delta}</span>`;
    });
    return `<div class="run-card-sectors">${cells.join('')}</div>`;
}

// Render Top 10 (valid runs in the list, by adjusted time)
function renderTop10(runs) {
    const top10 = sortByAdjustedTime(runs.filter(r => r.isValid)).slice(0, 10);

    if (top10.length === 0) {
        top10Panel.classList.add('hidden');
        return;
    }

    top10Panel.classList.remove('hidden');
    top10List.innerHTML = '';

    top10.forEach((run, index) => {
        const item = document.createElement('div');
        item.className = 'top10-item';
        item.dataset.runId = run.runId;

        const cones = run.cones || 0;

        item.innerHTML = `
            <span class="rank">#${index + 1}</span>
            <span class="time">${formatLapTime(getAdjustedTime(run))}</span>
            <span class="top10-run">Run ${runNumbers.get(run.runId)}</span>
            ${cones > 0 ? `<span class="cone-badge">🚧${cones}</span>` : ''}
        `;

        item.addEventListener('click', () => {
            // Only scroll to the run, don't select it
            scrollToRun(run.runId);
        });

        top10List.appendChild(item);
    });
}

// Handle Run Selection
async function handleRunSelection(e) {
    const runId = e.target.dataset.runId;
    const isChecked = e.target.checked;

    // If trying to uncheck and this is the most recent run and toggle is on, prevent it
    if (!isChecked && mostRecentOnTop && isMostRecentRun(runId)) {
        e.target.checked = true;
        showToast('Cannot deselect most recent run while "Recent on top" is enabled', 'warning');
        return;
    }

    if (isChecked) {
        if (selectedRuns.length >= MAX_SELECTED_RUNS) {
            e.target.checked = false;
            showToast(`Maximum ${MAX_SELECTED_RUNS} runs can be selected`, 'warning');
            return;
        }
        if (!selectedRuns.includes(runId)) {
            selectedRuns.push(runId);
        }
    } else {
        selectedRuns = selectedRuns.filter(id => id !== runId);
    }

    syncSelectionUI();
    saveSelectedRunsToStorage();
    updateButtonStates();

    await loadSelectedRuns();
}

// Check if a run is the most recent run (by timestamp)
function isMostRecentRun(runId) {
    const mostRecent = findMostRecentRun(allRuns);
    return mostRecent !== null && mostRecent.runId === runId;
}

// Put the most recent run first in the selection.
// With deselectOldMostRecent, the previous most recent run (first in the list) is replaced.
function applyMostRecentSelection(deselectOldMostRecent) {
    const mostRecent = findMostRecentRun(allRuns);
    if (!mostRecent) return;
    const mostRecentId = mostRecent.runId;

    if (deselectOldMostRecent && selectedRuns.length > 0 && selectedRuns[0] !== mostRecentId) {
        selectedRuns = selectedRuns.slice(1);
    }

    selectedRuns = [mostRecentId, ...selectedRuns.filter(id => id !== mostRecentId)]
        .slice(0, MAX_SELECTED_RUNS);
}

// Make checkboxes and card highlights match selectedRuns.
// Selected cards are highlighted in the color the run has on the map and charts.
function syncSelectionUI() {
    const colors = computeRunColors();
    document.querySelectorAll('.run-card-checkbox').forEach(checkbox => {
        const runId = checkbox.dataset.runId;
        const isSelected = selectedRuns.includes(runId);
        checkbox.checked = isSelected;
        const card = checkbox.closest('.run-card');
        if (!card) return;
        card.classList.toggle('selected', isSelected);
        if (isSelected && colors[runId]) {
            card.style.setProperty('--run-color', colors[runId]);
        } else {
            card.style.removeProperty('--run-color');
        }
    });
}

// Color of each selected run: the most recent run (with "Recent on top") is purple,
// the others take palette colors from fastest to slowest
function computeRunColors() {
    const runsById = new Map(allRuns.map(r => [r.runId, r]));
    const selected = selectedRuns.map(id => runsById.get(id) || loadedRuns[id]).filter(Boolean);
    const mostRecentId = mostRecentOnTop ? selectedRuns[0] : null;

    const colors = {};
    sortByAdjustedTime(selected).forEach((run, i) => {
        colors[run.runId] = run.runId === mostRecentId ? RECENT_COLOR : RUN_COLORS[i % RUN_COLORS.length];
    });
    return colors;
}

// Save selected runs to localStorage
function saveSelectedRunsToStorage() {
    if (currentCourse) {
        localStorage.setItem(`selectedRuns_${currentCourse}`, JSON.stringify(selectedRuns));
    }
}

// Read the stored selection for a course
function readStoredSelection(courseId) {
    try {
        const stored = JSON.parse(localStorage.getItem(`selectedRuns_${courseId}`));
        return Array.isArray(stored) ? stored.slice(0, MAX_SELECTED_RUNS) : [];
    } catch (e) {
        return [];
    }
}

// Load Selected Runs into Visualizations
async function loadSelectedRuns() {
    const token = ++runsLoadToken;

    if (selectedRuns.length === 0) {
        lastLoadedSignature = '';
        if (window.AutocrossAlign) AutocrossAlign.setRuns([]);
        clearVisualization();
        updateHint();
        return;
    }

    const courseId = currentCourse;
    const missing = selectedRuns.filter(id => !loadedRuns[id]);

    if (missing.length > 0 && window.AutocrossMap) window.AutocrossMap.setLoading(true);

    try {
        // Fetch full telemetry for runs that are not cached
        const fetched = await Promise.all(
            missing.map(runId => apiRequest('getRun', { courseId, runId }))
        );
        fetched.forEach(runData => { loadedRuns[runData.runId] = runData; });

        // Ignore the result if a newer load started meanwhile
        if (token !== runsLoadToken) return;

        const colors = computeRunColors();
        const mostRecentRunId = selectedRuns[0];

        const runsToLoad = selectedRuns
            .filter(runId => loadedRuns[runId])
            .map(runId => {
                const runData = loadedRuns[runId];
                runData.runNumber = runNumbers.get(runId);
                runData.isMostRecent = (runId === mostRecentRunId) && mostRecentOnTop;
                runData.color = colors[runId];
                return runData;
            });

        // Fastest run first
        const sortedToLoad = sortByAdjustedTime(runsToLoad);

        // Skip the redraw when nothing visible changed, so playback position and zoom are kept
        const signature = sortedToLoad
            .map(r => `${r.runId}:${r.cones || 0}:${r.color}:${r.runNumber}`)
            .join('|');
        if (signature === lastLoadedSignature) return;
        lastLoadedSignature = signature;

        if (window.AutocrossAlign) AutocrossAlign.setRuns(sortedToLoad);
        pushToVisualizations(sortedToLoad, { keepTime: false });
        updateHint();
    } catch (error) {
        console.error('Failed to load selected runs:', error);
        showToast('Failed to load runs', 'error');
    } finally {
        if (window.AutocrossMap) window.AutocrossMap.setLoading(false);
    }
}

// Send runs to the charts, map and scrubber.
// With keepTime, the playback position and map view are kept (used when align mode changes).
function pushToVisualizations(runs, { keepTime }) {
    shownRuns = runs;
    if (window.AutocrossCharts) window.AutocrossCharts.compareRuns(runs, { keepTime });
    if (window.AutocrossMap) window.AutocrossMap.compareRuns(runs, { keepView: keepTime });
    if (window.AutocrossScrubber) window.AutocrossScrubber.setRuns(runs, { keepTime });
}

// Redraw everything when align mode starts, changes reference, or ends
function handleAlignChange(reference) {
    if (shownRuns.length === 0) return;
    pushToVisualizations(shownRuns, { keepTime: true });
    if (reference) {
        showToast(`Lined up with Run ${reference.runNumber}. Tap it again or press Reset to go back to time.`, 'info');
    }
    updateHint();
}

// Update Button States
function updateButtonStates() {
    const hasSelection = selectedRuns.length > 0;

    deleteRunBtn.disabled = !hasSelection;

    // Enable export button if runs are selected
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.disabled = !hasSelection;
    }
}

// Update Archive Button State
function updateArchiveButtonState() {
    const archiveBtn = document.getElementById('archiveBtn');
    if (!archiveBtn) return;

    // Disable if no course selected or if course is already archived
    const isArchived = currentCourseData && currentCourseData.isArchived;
    archiveBtn.disabled = !currentCourse || isArchived;

    // Update tooltip/title
    if (isArchived) {
        archiveBtn.title = 'This course is already archived';
    } else if (!currentCourse) {
        archiveBtn.title = 'Select a course to archive';
    } else {
        archiveBtn.title = 'Archive this course';
    }
}

// Scroll to Run in List
function scrollToRun(runId) {
    // Expand runs section if collapsed
    const runsSection = document.querySelector('.runs-section');
    if (runsSection && runsSection.classList.contains('collapsed')) {
        runsSection.classList.remove('collapsed');
        document.body.classList.remove('runs-collapsed');
    }

    // Find the run card
    const runCard = document.querySelector(`.run-card[data-run-id="${runId}"]`);
    if (runCard) {
        // Scroll into view
        runCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Highlight briefly
        runCard.style.transition = 'none';
        runCard.style.backgroundColor = 'rgba(74, 158, 255, 0.3)';
        setTimeout(() => {
            runCard.style.transition = 'all 0.2s';
            runCard.style.backgroundColor = '';
        }, 1000);
    }
}

// Handle Delete Run
async function handleDeleteRun() {
    if (selectedRuns.length === 0) return;

    const names = selectedRuns.map(id => `Run ${runNumbers.get(id)}`).join(', ');
    const confirmed = await confirmDialog({
        title: selectedRuns.length === 1 ? 'Delete run' : `Delete ${selectedRuns.length} runs`,
        message: `${names} will be deleted. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true
    });
    if (!confirmed) return;

    try {
        showLoading();

        const deletedIds = [...selectedRuns];
        await Promise.all(
            deletedIds.map(runId =>
                apiRequest('deleteRun', {
                    courseId: currentCourse,
                    runId
                })
            )
        );

        deletedIds.forEach(runId => delete loadedRuns[runId]);
        selectedRuns = [];

        await refreshRuns({ deselectOldMostRecent: false });

        showToast(`Deleted ${deletedIds.length} run${deletedIds.length !== 1 ? 's' : ''}`, 'success');
    } catch (error) {
        console.error('Failed to delete run:', error);
    } finally {
        hideLoading();
    }
}

// Handle Clear Selections
async function handleClearSelections() {
    selectedRuns = [];

    // The most recent run stays selected while "Recent on top" is enabled
    if (mostRecentOnTop) {
        applyMostRecentSelection(false);
    }

    syncSelectionUI();
    saveSelectedRunsToStorage();
    updateButtonStates();

    await loadSelectedRuns();

    showToast(mostRecentOnTop ? 'Selections cleared (most recent run kept)' : 'All selections cleared', 'success');
}

// Handle Export Runs
async function handleExportRuns() {
    if (selectedRuns.length === 0) {
        showToast('Select runs to export', 'error');
        return;
    }

    try {
        showLoading();

        // Get full run data for selected runs
        const exportData = await apiRequest('exportRuns', {
            courseId: currentCourse,
            runIds: selectedRuns
        });

        // Download as JSON file
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `autocross-runs-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);

        showToast(`Exported ${selectedRuns.length} run(s)`, 'success');
        hideLoading();
    } catch (error) {
        console.error('Failed to export runs:', error);
        hideLoading();
    }
}

// Handle Import Runs
async function handleImportRuns(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!currentCourse) {
        showToast('Please select a course first', 'error');
        e.target.value = '';
        return;
    }

    try {
        showLoading();

        // Read file
        const text = await file.text();
        const importData = JSON.parse(text);

        // Validate structure
        if (!importData.runs || !Array.isArray(importData.runs)) {
            throw new Error('Invalid import file format');
        }

        // Import runs
        const result = await apiRequest('importRuns', {
            courseId: currentCourse,
            runs: importData.runs
        });

        await refreshRuns({ deselectOldMostRecent: false });

        let message = `Imported ${result.imported} run(s)`;
        if (result.errors && result.errors.length > 0) {
            message += ` (${result.errors.length} error(s))`;
            console.error('Import errors:', result.errors);
        }

        showToast(message, result.errors.length > 0 ? 'warning' : 'success');
    } catch (error) {
        console.error('Failed to import runs:', error);
        showToast('Failed to import: ' + error.message, 'error');
    } finally {
        hideLoading();
        e.target.value = '';
    }
}

// Handle Archive Click
function handleArchiveClick() {
    if (!currentCourse) {
        showToast('Please select a course to archive', 'error');
        return;
    }

    // Check if course is already archived
    if (currentCourseData && currentCourseData.isArchived) {
        showToast('This course is already archived', 'warning');
        return;
    }

    // Show archive modal
    const archiveModal = document.getElementById('archiveModal');
    const archiveCarName = document.getElementById('archiveCarName');
    const archiveEventName = document.getElementById('archiveEventName');

    if (archiveModal) {
        // Clear previous values
        if (archiveCarName) archiveCarName.value = '';
        if (archiveEventName) archiveEventName.value = '';

        archiveModal.classList.remove('hidden');
        setTimeout(() => archiveCarName?.focus(), 100);
    }
}

// Handle Archive Submit
async function handleArchiveSubmit(e) {
    e.preventDefault();

    const archiveCarName = document.getElementById('archiveCarName');
    const archiveEventName = document.getElementById('archiveEventName');

    const carName = archiveCarName?.value.trim() || '';
    const eventName = archiveEventName?.value.trim() || '';

    if (!currentCourse || !carName || !eventName) {
        showToast('Please fill in all fields', 'error');
        return;
    }

    try {
        showLoading();

        // Archive the course
        await apiRequest('archiveCourse', {
            courseId: currentCourse,
            carName,
            eventName
        });

        // Close modal
        const archiveModal = document.getElementById('archiveModal');
        const archiveForm = document.getElementById('archiveForm');
        if (archiveModal) archiveModal.classList.add('hidden');
        if (archiveForm) archiveForm.reset();

        // Deselect the course so the next recording starts a new course for this track
        courseSelector.value = '';
        await handleCourseChange();
        renderCourseOptions(await apiRequest('getCourses'));

        showToast('Course archived. The next recording starts a new course.', 'success');
    } catch (error) {
        console.error('Failed to archive course:', error);
    } finally {
        hideLoading();
    }
}

// Show Rename Modal
let currentRenameRunId = null;
function showRenameModal(runId, currentName) {
    currentRenameRunId = runId;
    const renameModal = document.getElementById('renameModal');
    const runNameInput = document.getElementById('runName');

    if (runNameInput) {
        runNameInput.value = currentName;
    }

    if (renameModal) {
        renameModal.classList.remove('hidden');
        setTimeout(() => runNameInput?.focus(), 100);
    }
}

// Handle Rename Submit
async function handleRenameSubmit(e) {
    e.preventDefault();

    const runNameInput = document.getElementById('runName');
    const newName = runNameInput?.value.trim() || '';

    if (!currentRenameRunId || !currentCourse) return;

    try {
        showLoading();

        await apiRequest('renameRun', {
            courseId: currentCourse,
            runId: currentRenameRunId,
            name: newName
        });

        // Close modal
        const renameModal = document.getElementById('renameModal');
        const renameRunForm = document.getElementById('renameRunForm');
        if (renameModal) renameModal.classList.add('hidden');
        if (renameRunForm) renameRunForm.reset();

        if (loadedRuns[currentRenameRunId]) {
            loadedRuns[currentRenameRunId].name = newName || null;
        }

        await refreshRuns();

        showToast(newName ? 'Run renamed successfully' : 'Run name cleared', 'success');
    } catch (error) {
        console.error('Failed to rename run:', error);
    } finally {
        hideLoading();
        currentRenameRunId = null;
    }
}

// Handle Cone Penalty Change
async function handleConeChange(runId, change) {
    if (!currentCourse) return;

    // Use the latest local count so quick repeated clicks all count
    const run = allRuns.find(r => r.runId === runId);
    if (!run) return;
    const newConeCount = Math.max(0, (run.cones || 0) + change);
    if (newConeCount === (run.cones || 0)) return;
    run.cones = newConeCount;
    if (loadedRuns[runId]) loadedRuns[runId].cones = newConeCount;

    try {
        await apiRequest('updateCones', {
            courseId: currentCourse,
            runId: runId,
            cones: newConeCount
        });

        await refreshRuns();
    } catch (error) {
        console.error('Failed to update cone count:', error);
        showToast('Failed to update cone count', 'error');
    }
}

// Clear Runs List
function clearRunsList() {
    runsList.innerHTML = '<div class="empty-state">Select a course to view runs.</div>';
    top10Panel.classList.add('hidden');
    if (runCount) {
        runCount.textContent = '0 runs';
    }
    const runCountCollapsed = document.getElementById('runCountCollapsed');
    if (runCountCollapsed) {
        runCountCollapsed.textContent = '0 runs';
    }
}

// Clear Visualization
function clearVisualization() {
    shownRuns = [];
    if (window.AutocrossAlign) AutocrossAlign.setRuns([]);

    if (window.AutocrossCharts) {
        window.AutocrossCharts.clear();
    }

    if (window.AutocrossMap) {
        window.AutocrossMap.clear();
    }

    if (window.AutocrossScrubber) {
        window.AutocrossScrubber.clear();
    }
}

// Format Lap Time
function formatLapTime(seconds) {
    // Round to whole milliseconds first so 59.9996 shows as 1:00.000
    const totalMs = Math.round(seconds * 1000);
    const mins = Math.floor(totalMs / 60000);
    const secs = ((totalMs % 60000) / 1000).toFixed(3);
    return `${mins}:${secs.padStart(6, '0')}`;
}

// Handle Run Saved (called by recorder)
async function onRunSaved() {
    if (currentCourse) {
        await refreshRuns();
    }

    showToast('Run saved successfully', 'success');
}

// Show a course chosen by the recorder (found or created for the current track)
async function onCourseAutoSelected(courseId, message) {
    if (courseId !== currentCourse) {
        localStorage.setItem('selectedCourse', courseId);
        renderCourseOptions(await apiRequest('getCourses'));
        courseSelector.value = courseId;
        await handleCourseChange();
    }

    if (message) {
        showToast(message, 'success');
    }
}

// Export global functions
window.AutocrossApp = {
    init,
    onRunSaved,
    onCourseAutoSelected,
    getCurrentCourse: () => currentCourse,
    getCurrentCourseData: () => currentCourseData,
    getAllRuns: () => allRuns,
    getCarName,
    getRunNumber: (runId) => runNumbers.get(runId),
    refreshRuns,
    updateHint,
    confirmDialog,
    // Full run data with telemetry (loaded once, then cached)
    getRunData: async (runId) => {
        if (!loadedRuns[runId]) {
            loadedRuns[runId] = await apiRequest('getRun', { courseId: currentCourse, runId });
        }
        return loadedRuns[runId];
    },
    getLoadedRunObjects: () => {
        // Return full run objects for currently selected runs (sorted fastest first)
        return sortByAdjustedTime(selectedRuns
            .filter(id => loadedRuns[id])
            .map(id => loadedRuns[id]));
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
