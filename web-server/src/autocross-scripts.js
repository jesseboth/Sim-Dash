// Autocross Telemetry Analyzer - Main Script

// Global State
let currentCourse = null;
let currentCourseData = null; // Store full course data including archive status
let allRuns = [];
let selectedRuns = [];
let loadedRuns = {}; // Cache for full run data with telemetry
let mostRecentOnTop = true; // Track "Recent on top" toggle state

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

    // Load courses
    await loadCourses();

    // Setup event listeners
    setupEventListeners();

    // Initialize archive button state (disabled initially)
    updateArchiveButtonState();

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
}

// Handle "Recent on top" toggle changes
async function handleMostRecentToggle(e) {
    mostRecentOnTop = e.target.checked;

    // Save preference to localStorage
    localStorage.setItem('mostRecentOnTop', mostRecentOnTop.toString());

    if (mostRecentOnTop && allRuns.length > 0) {
        // Auto-select the most recent run (don't deselect old most recent when toggling on)
        await autoSelectMostRecentRun(false);
    }

    // Always reload visualizations to update colors when toggle changes
    if (selectedRuns.length > 0) {
        await loadSelectedRuns();
    }
}

// Handle New Course
// Handle Keyboard Shortcuts
function handleKeyboardShortcuts(e) {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
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

        case 'Escape': // Escape - Close modals
            // Could add modal closing logic here if needed
            break;

        case '?': // ? - Show help (could add help modal in future)
            e.preventDefault();
            showKeyboardHelp();
            break;
    }
}

// Show keyboard help
function showKeyboardHelp() {
    const helpText = `
Keyboard Shortcuts:
- Space: Play/Pause scrubber
- R: Arm/Disarm recording
- Delete/Backspace: Delete selected runs
- Escape: Close modal
- ?: Show this help
    `;
    showToast(helpText, 'info');
}

// Load Courses
async function loadCourses() {
    try {
        const courses = await apiRequest('getCourses');

        // Sort courses: active first (newest to oldest), then archived (newest to oldest)
        const sortedCourses = [...courses].sort((a, b) => {
            // First, separate by archived status
            const aArchived = a.isArchived || false;
            const bArchived = b.isArchived || false;

            if (aArchived !== bArchived) {
                return aArchived ? 1 : -1; // Active courses first
            }

            // Within same archive status, sort by date (newest first)
            const aDate = new Date(a.archivedDate || a.courseId);
            const bDate = new Date(b.archivedDate || b.courseId);
            return bDate - aDate;
        });

        // Clear existing options (except the first one)
        courseSelector.innerHTML = '<option value="">Select a course...</option>';

        // Add separator for archived courses if needed
        let archivedSeparatorAdded = false;

        // Add courses to selector
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

            // Format course name
            let displayName = course.name;
            if (course.isArchived && course.archivedEventName) {
                displayName = `📦 ${course.archivedEventName} - ${course.archivedCarName}`;
            }
            displayName += ` (${course.runCount} runs)`;

            option.textContent = displayName;
            courseSelector.appendChild(option);
        });

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

// Handle Course Change
async function handleCourseChange() {
    const courseId = courseSelector.value;

    if (!courseId) {
        currentCourse = null;
        currentCourseData = null;
        clearRunsList();
        clearVisualization();
        updateArchiveButtonState();
        return;
    }

    try {
        showLoading();

        // Save selection
        localStorage.setItem('selectedCourse', courseId);

        // Load course data to check archive status
        const courses = await apiRequest('getCourses');
        currentCourseData = courses.find(c => c.courseId === courseId);

        // Load course runs
        const runs = await apiRequest('getRuns', { courseId });
        allRuns = runs;

        // Load top 10
        const top10 = await apiRequest('getTop10', { courseId });

        // Update UI
        renderRunsList(runs);
        renderTop10(top10);

        // Update current course
        currentCourse = courseId;

        // Update archive button state based on course data
        updateArchiveButtonState();

        // Restore selected runs from localStorage
        restoreSelectedRunsFromStorage();

        // Notify recorder of course change
        if (window.AutocrossRecorder) {
            window.AutocrossRecorder.setCourse(courseId);
        }

        hideLoading();
    } catch (error) {
        console.error('Failed to load course:', error);
        hideLoading();
    }
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

// Render Runs List
async function renderRunsList(runs) {
    // Update run count
    const countText = `${runs.length} run${runs.length !== 1 ? 's' : ''}`;
    if (runCount) {
        runCount.textContent = countText;
    }
    const runCountCollapsed = document.getElementById('runCountCollapsed');
    if (runCountCollapsed) {
        runCountCollapsed.textContent = countText;
    }

    if (runs.length === 0) {
        runsList.innerHTML = '<div class="empty-state">No runs recorded yet. Click Start to begin recording.</div>';
        return;
    }

    // Fetch car name mappings for runs in this list
    const carNames = await resolveCarNames(runs);

    // Sort runs by adjusted time (fastest first)
    const sortedRuns = [...runs].sort((a, b) => {
        const aTime = a.lapTime + ((a.cones || 0) * 2);
        const bTime = b.lapTime + ((b.cones || 0) * 2);
        return aTime - bTime;
    });
    const fastestTime = sortedRuns[0].lapTime + ((sortedRuns[0].cones || 0) * 2);

    runsList.innerHTML = '';

    sortedRuns.forEach((run, index) => {
        const card = document.createElement('div');
        card.className = 'run-card';
        card.dataset.runId = run.runId;

        const date = new Date(run.timestamp);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const cones = run.cones || 0;
        const adjustedTime = run.lapTime + (cones * 2);
        const isFastest = adjustedTime === fastestTime;

        card.innerHTML = `
            <input type="checkbox" class="run-card-checkbox" data-run-id="${run.runId}">
            <div class="run-card-info">
                <div class="run-card-main">
                    <span class="run-number">#${index + 1}</span>
                    <span class="run-time ${isFastest ? 'fastest' : ''}">${formatLapTime(adjustedTime)}</span>
                    ${run.name ? `<span class="run-name">📝 ${run.name}</span>` : ''}
                </div>
                <div class="run-card-details">
                    <span>📅 ${dateStr} ${timeStr}</span>
                    <span>🚗 ${run.carId ? (carNames[run.carId] || run.carId) : 'Unknown'}</span>
                    ${cones > 0 ? `<span style="color: var(--accent-warning)">🚧 ${cones} cone${cones !== 1 ? 's' : ''} (+${cones * 2}s)</span>` : ''}
                    ${run.isValid ? '' : '<span style="color: var(--accent-secondary)">❌ Invalid</span>'}
                </div>
            </div>
            <div class="run-card-actions">
                <div class="cone-controls">
                    <button class="btn-icon cone-minus" data-run-id="${run.runId}" title="Remove cone">−</button>
                    <span class="cone-count">${cones}</span>
                    <button class="btn-icon cone-plus" data-run-id="${run.runId}" title="Add cone">+</button>
                </div>
                <button class="btn btn-secondary btn-sm rename-run" data-run-id="${run.runId}" title="Rename">✏️</button>
            </div>
        `;

        // Add event listeners
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

        const conePlusBtn = card.querySelector('.cone-plus');
        conePlusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleConeChange(run.runId, (run.cones || 0) + 1);
        });

        const coneMinusBtn = card.querySelector('.cone-minus');
        coneMinusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newCount = Math.max(0, (run.cones || 0) - 1);
            handleConeChange(run.runId, newCount);
        });

        // Click card to toggle selection
        card.addEventListener('click', (e) => {
            const isControl = e.target === checkbox ||
                             e.target === renameBtn || e.target === conePlusBtn ||
                             e.target === coneMinusBtn || e.target.closest('.cone-controls');
            if (!isControl) {
                checkbox.checked = !checkbox.checked;
                handleRunSelection({ target: checkbox });
            }
        });

        runsList.appendChild(card);
    });

    // Update button states
    updateButtonStates();

    // Auto-select most recent run if "Recent on top" is enabled
    if (mostRecentOnTop) {
        // Use setTimeout to ensure DOM is ready
        // Pass true to deselect old most recent run when a new one arrives
        setTimeout(() => autoSelectMostRecentRun(true), 0);
    }
}

// Render Top 10
function renderTop10(top10) {
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

        const adjustedTime = run.adjustedTime || run.lapTime;
        const hasCones = (run.cones || 0) > 0;

        item.innerHTML = `
            <span class="rank">#${index + 1}</span>
            <span class="time">${formatLapTime(adjustedTime)}</span>
            ${hasCones ? `<span class="cone-badge">🚧${run.cones}</span>` : ''}
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
    const card = e.target.closest('.run-card');

    // If trying to uncheck and this is the most recent run and toggle is on, prevent it
    if (!isChecked && mostRecentOnTop && isMostRecentRun(runId)) {
        e.target.checked = true; // Force it back to checked
        showToast('Cannot deselect most recent run while "Recent on top" is enabled', 'warning');
        return;
    }

    if (isChecked) {
        // Limit to 6 runs
        if (selectedRuns.length >= 6) {
            e.target.checked = false;
            showToast('Maximum 6 runs can be selected', 'warning');
            return;
        }
        if (!selectedRuns.includes(runId)) {
            selectedRuns.push(runId);
        }
        if (card) card.classList.add('selected');
    } else {
        selectedRuns = selectedRuns.filter(id => id !== runId);
        if (card) card.classList.remove('selected');
    }

    // Save to localStorage
    saveSelectedRunsToStorage();

    updateButtonStates();

    // Auto-load runs into visualizations
    await loadSelectedRuns();
}

// Check if a run is the most recent run (by timestamp)
function isMostRecentRun(runId) {
    if (allRuns.length === 0) return false;

    // Find the most recent run by timestamp (highest timestamp)
    const mostRecent = allRuns.reduce((latest, run) => {
        return new Date(run.timestamp) > new Date(latest.timestamp) ? run : latest;
    }, allRuns[0]);

    return mostRecent.runId === runId;
}

// Auto-select the most recent run
async function autoSelectMostRecentRun(deselectOldMostRecent = false) {
    if (allRuns.length === 0) return false;

    // Find the most recent run by timestamp
    const mostRecent = allRuns.reduce((latest, run) => {
        return new Date(run.timestamp) > new Date(latest.timestamp) ? run : latest;
    }, allRuns[0]);

    const mostRecentId = mostRecent.runId;

    // If deselecting old most recent, find and remove it (but keep other selections)
    if (deselectOldMostRecent && selectedRuns.length > 0) {
        const oldMostRecentId = selectedRuns[0]; // First item is always most recent

        // Only deselect if it's different from the new most recent
        if (oldMostRecentId !== mostRecentId) {
            // Remove old most recent from selection
            selectedRuns = selectedRuns.filter(id => id !== oldMostRecentId);

            // Update UI for old most recent
            const oldCheckbox = document.querySelector(`.run-card-checkbox[data-run-id="${oldMostRecentId}"]`);
            if (oldCheckbox) {
                oldCheckbox.checked = false;
                const card = oldCheckbox.closest('.run-card');
                if (card) card.classList.remove('selected');
            }
        }
    }

    // Check if new most recent is already selected
    if (selectedRuns.includes(mostRecentId)) {
        // Even if already selected, make sure it's first (most recent position)
        selectedRuns = selectedRuns.filter(id => id !== mostRecentId);
        selectedRuns.unshift(mostRecentId);
        saveSelectedRunsToStorage();
        updateButtonStates();
        await loadSelectedRuns();
        return false; // Return false to indicate no new selection
    }

    // Add to selection (at the beginning so it's the "most recent selection")
    selectedRuns.unshift(mostRecentId);

    // Limit to 6 runs
    if (selectedRuns.length > 6) {
        selectedRuns = selectedRuns.slice(0, 6);
    }

    // Update UI
    const checkbox = document.querySelector(`.run-card-checkbox[data-run-id="${mostRecentId}"]`);
    if (checkbox) {
        checkbox.checked = true;
        const card = checkbox.closest('.run-card');
        if (card) card.classList.add('selected');
    }

    // Save and reload
    saveSelectedRunsToStorage();
    updateButtonStates();
    await loadSelectedRuns();

    return true; // Return true to indicate selection was changed
}

// Save selected runs to localStorage
function saveSelectedRunsToStorage() {
    if (currentCourse) {
        const storageKey = `selectedRuns_${currentCourse}`;
        localStorage.setItem(storageKey, JSON.stringify(selectedRuns));
    }
}

// Restore selected runs from localStorage
function restoreSelectedRunsFromStorage() {
    if (!currentCourse) return;

    const storageKey = `selectedRuns_${currentCourse}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
        try {
            const runIds = JSON.parse(stored);
            selectedRuns = [];

            // Check each stored run ID and restore selection
            runIds.forEach(runId => {
                const checkbox = document.querySelector(`.run-card-checkbox[data-run-id="${runId}"]`);
                if (checkbox) {
                    checkbox.checked = true;
                    selectedRuns.push(runId);
                    const card = checkbox.closest('.run-card');
                    if (card) card.classList.add('selected');
                }
            });

            // If "Recent on top" is enabled, ensure most recent run is first in selectedRuns
            if (mostRecentOnTop && allRuns.length > 0 && selectedRuns.length > 0) {
                const mostRecent = allRuns.reduce((latest, run) =>
                    new Date(run.timestamp) > new Date(latest.timestamp) ? run : latest, allRuns[0]);
                const mostRecentId = mostRecent.runId;
                if (selectedRuns.includes(mostRecentId) && selectedRuns[0] !== mostRecentId) {
                    selectedRuns = [mostRecentId, ...selectedRuns.filter(id => id !== mostRecentId)];
                }
            }

            updateButtonStates();

            // Auto-load the restored selection
            if (selectedRuns.length > 0) {
                loadSelectedRuns();
            }
        } catch (e) {
            console.error('Failed to restore selected runs:', e);
        }
    }
}

// Load Selected Runs into Visualizations
async function loadSelectedRuns() {
    if (selectedRuns.length === 0) {
        // Clear visualizations if nothing selected
        clearVisualization();
        return;
    }

    try {
        // Calculate run rankings (sort all runs by adjusted time)
        const sortedRuns = [...allRuns].sort((a, b) => {
            const aTime = a.lapTime + ((a.cones || 0) * 2);
            const bTime = b.lapTime + ((b.cones || 0) * 2);
            return aTime - bTime;
        });

        // Load full run data for all selected runs and track the most recent selection
        const mostRecentRunId = selectedRuns[0]; // First in selectedRuns is most recent
        const runsToLoad = [];

        for (const runId of selectedRuns) {
            if (!loadedRuns[runId]) {
                const runData = await apiRequest('getRun', {
                    courseId: currentCourse,
                    runId
                });
                loadedRuns[runId] = runData;
            }

            // Add run number based on position in sorted list
            const runData = loadedRuns[runId];
            const runRank = sortedRuns.findIndex(r => r.runId === runId) + 1;
            runData.runNumber = runRank;

            // Mark if this is the most recent selection AND toggle is on
            runData.isMostRecent = (runId === mostRecentRunId) && mostRecentOnTop;

            runsToLoad.push(runData);
        }

        // Sort runs by speed (fastest first) for consistent color assignment
        // Fastest run gets first color (blue), slowest gets last color
        runsToLoad.sort((a, b) => {
            const aTime = a.lapTime + ((a.cones || 0) * 2);
            const bTime = b.lapTime + ((b.cones || 0) * 2);
            return aTime - bTime; // Ascending: fastest first
        });

        // Update visualizations with all selected runs
        if (runsToLoad.length === 1) {
            // Single run
            const run = runsToLoad[0];
            if (window.AutocrossCharts) {
                window.AutocrossCharts.loadRun(run);
            }
            if (window.AutocrossMap) {
                window.AutocrossMap.loadRun(run);
            }
            if (window.AutocrossScrubber) {
                window.AutocrossScrubber.loadRun(run);
            }
        } else {
            // Multiple runs - compare mode
            if (window.AutocrossCharts) {
                window.AutocrossCharts.compareRuns(runsToLoad);
            }
            if (window.AutocrossMap) {
                window.AutocrossMap.compareRuns(runsToLoad);
            }
            if (window.AutocrossScrubber) {
                // Find the longest run for scrubber duration
                const longestRun = runsToLoad.reduce((longest, run) => {
                    const currentDuration = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
                    const longestDuration = longest.telemetry.timestamps[longest.telemetry.timestamps.length - 1];
                    return currentDuration > longestDuration ? run : longest;
                }, runsToLoad[0]);
                window.AutocrossScrubber.loadRun(longestRun);
            }
        }
    } catch (error) {
        console.error('Failed to load selected runs:', error);
        showToast('Failed to load runs', 'error');
    }
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

// Load and View Run
async function loadAndViewRun(runId) {
    try {
        showLoading();

        // Load full run data if not cached
        if (!loadedRuns[runId]) {
            const runData = await apiRequest('getRun', {
                courseId: currentCourse,
                runId
            });
            loadedRuns[runId] = runData;
        }

        const run = loadedRuns[runId];

        // Calculate run number based on position in sorted list
        const sortedRuns = [...allRuns].sort((a, b) => {
            const aTime = a.lapTime + ((a.cones || 0) * 2);
            const bTime = b.lapTime + ((b.cones || 0) * 2);
            return aTime - bTime;
        });
        const runRank = sortedRuns.findIndex(r => r.runId === runId) + 1;
        run.runNumber = runRank;

        // Mark as most recent (single run view) only if toggle is on
        run.isMostRecent = mostRecentOnTop;

        // Update visualizations
        if (window.AutocrossCharts) {
            window.AutocrossCharts.loadRun(run);
        }

        if (window.AutocrossMap) {
            window.AutocrossMap.loadRun(run);
        }

        if (window.AutocrossScrubber) {
            window.AutocrossScrubber.loadRun(run);
        }

        hideLoading();
    } catch (error) {
        console.error('Failed to load run:', error);
        hideLoading();
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

// Handle Compare Runs
// Handle Delete Run
async function handleDeleteRun() {
    if (selectedRuns.length === 0) return;

    const confirmMsg = selectedRuns.length === 1
        ? 'Delete this run?'
        : `Delete ${selectedRuns.length} runs?`;

    if (!confirm(confirmMsg)) return;

    try {
        showLoading();

        // Delete all selected runs
        await Promise.all(
            selectedRuns.map(runId =>
                apiRequest('deleteRun', {
                    courseId: currentCourse,
                    runId
                })
            )
        );

        // Clear selection
        selectedRuns = [];

        // Reload runs list
        await handleCourseChange();

        // Clear visualizations
        clearVisualization();

        showToast('Run(s) deleted successfully', 'success');
        hideLoading();
    } catch (error) {
        console.error('Failed to delete run:', error);
        hideLoading();
    }
}

// Handle Clear Selections
async function handleClearSelections() {
    // Uncheck all run checkboxes
    const checkboxes = document.querySelectorAll('.run-card-checkbox');
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            checkbox.checked = false;
            // Remove selected class from card
            const card = checkbox.closest('.run-card');
            if (card) card.classList.remove('selected');
        }
    });

    // Clear selectedRuns array
    selectedRuns = [];

    // Save to localStorage
    saveSelectedRunsToStorage();

    // Update button states
    updateButtonStates();

    // Reload visualizations (with empty selection)
    await loadSelectedRuns();

    showToast('All selections cleared', 'success');
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

        // Reload runs list
        await handleCourseChange();

        let message = `Imported ${result.imported} run(s)`;
        if (result.errors && result.errors.length > 0) {
            message += ` (${result.errors.length} error(s))`;
            console.error('Import errors:', result.errors);
        }

        showToast(message, result.errors.length > 0 ? 'warning' : 'success');
        hideLoading();
    } catch (error) {
        console.error('Failed to import runs:', error);
        showToast('Failed to import: ' + error.message, 'error');
        hideLoading();
    } finally {
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

        // Reload courses to show updated list
        await loadCourses();

        // Clear current course selection
        currentCourse = null;
        courseSelector.value = ''; // Reset dropdown to "Select a course..."
        clearRunsList();
        clearVisualization();

        showToast('Course archived successfully', 'success');
        hideLoading();
    } catch (error) {
        console.error('Failed to archive course:', error);
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

        // Reload runs list
        await handleCourseChange();

        showToast(newName ? 'Run renamed successfully' : 'Run name cleared', 'success');
        hideLoading();
    } catch (error) {
        console.error('Failed to rename run:', error);
        hideLoading();
    } finally {
        currentRenameRunId = null;
    }
}

// Handle Cone Penalty Change
async function handleConeChange(runId, newConeCount) {
    if (!currentCourse) return;

    try {
        await apiRequest('updateCones', {
            courseId: currentCourse,
            runId: runId,
            cones: newConeCount
        });

        // Update local run data
        const run = allRuns.find(r => r.runId === runId);
        if (run) {
            run.cones = newConeCount;
        }

        // Reload runs list to show updated times and rankings
        await handleCourseChange();
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
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3);
    return `${mins}:${secs.padStart(6, '0')}`;
}

// Handle Run Saved (called by recorder)
async function onRunSaved(runData) {
    console.log('Run saved:', runData);

    // Reload course to update run count
    if (currentCourse) {
        await handleCourseChange();
    }

    showToast('Run saved successfully', 'success');
}

// Handle Course Auto-Selected (called by recorder when creating quick course)
async function onCourseAutoSelected(courseId) {
    console.log('Course auto-created:', courseId);

    currentCourse = courseId;

    // Reload courses list to include new course
    await loadCourses();

    // Select the course in dropdown
    courseSelector.value = courseId;

    // Load course data
    await handleCourseChange();

    showToast('Course created for this session', 'success');
}

// Export global functions
window.AutocrossApp = {
    init,
    onRunSaved,
    onCourseAutoSelected,
    getCurrentCourse: () => currentCourse
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
