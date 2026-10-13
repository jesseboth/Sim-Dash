const fs = require('fs');
const path = require('path');
const track = require('../src/autocross-track');

// Base directory for autocross data (now in telemetry/data/autocross)
const DATA_DIR = path.join(__dirname, '../../telemetry/data/autocross');
const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const CONE_PENALTY = 2; // seconds per cone

// IDs are used as file and directory names, so only plain names are allowed
const VALID_ID = /^[A-Za-z0-9_-]+$/;

function isValidId(id) {
    return typeof id === 'string' && VALID_ID.test(id);
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Calculate adjusted lap time with cone penalties
 */
function getAdjustedTime(run) {
    const cones = run.cones || 0;
    return run.lapTime + (cones * CONE_PENALTY);
}

/**
 * Load all courses from courses.json
 */
function loadCourses() {
    try {
        if (!fs.existsSync(COURSES_FILE)) {
            return [];
        }
        const data = fs.readFileSync(COURSES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading courses:', err);
        return [];
    }
}

/**
 * Save courses array to courses.json
 */
function saveCourses(courses) {
    try {
        fs.writeFileSync(COURSES_FILE, JSON.stringify(courses, null, 2));
        return true;
    } catch (err) {
        console.error('Error saving courses:', err);
        return false;
    }
}

/**
 * Create a new course
 */
function createCourse(name, trackId = null) {
    const courses = loadCourses();

    // Generate unique course ID based on timestamp
    const timestamp = Date.now();
    const dateStr = new Date().toISOString().split('T')[0];
    const courseId = `course-${timestamp}`;

    const newCourse = {
        courseId,
        name,
        trackId: trackId || 'manual',
        dateCreated: new Date().toISOString(),
        runCount: 0,
        bestTime: null
    };

    courses.push(newCourse);
    saveCourses(courses);

    // Create course directory and runs subdirectory
    const courseDir = path.join(DATA_DIR, courseId);
    const runsDir = path.join(courseDir, 'runs');

    if (!fs.existsSync(courseDir)) {
        fs.mkdirSync(courseDir, { recursive: true });
    }

    if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
    }

    // Initialize empty top10 file
    fs.writeFileSync(path.join(courseDir, 'top10.json'), JSON.stringify([], null, 2));

    return newCourse;
}

/**
 * Get a specific course by ID
 */
function getCourse(courseId) {
    const courses = loadCourses();
    return courses.find(c => c.courseId === courseId);
}

/**
 * Delete a course and all its data
 */
function deleteCourse(courseId) {
    try {
        // Remove from courses list
        const courses = loadCourses();
        const filteredCourses = courses.filter(c => c.courseId !== courseId);
        saveCourses(filteredCourses);

        // Delete course directory
        const courseDir = path.join(DATA_DIR, courseId);
        if (fs.existsSync(courseDir)) {
            fs.rmSync(courseDir, { recursive: true, force: true });
        }

        return true;
    } catch (err) {
        console.error('Error deleting course:', err);
        return false;
    }
}

/**
 * Archive a course
 * Marks the course as archived, disassociates from trackId, and adds archive metadata
 */
function archiveCourse(courseId, carName, eventName) {
    try {
        const courses = loadCourses();
        const courseIndex = courses.findIndex(c => c.courseId === courseId);

        if (courseIndex === -1) {
            return null; // Course not found
        }

        // Update course with archive information
        courses[courseIndex].isArchived = true;
        courses[courseIndex].archivedDate = new Date().toISOString();
        courses[courseIndex].archivedCarName = carName;
        courses[courseIndex].archivedEventName = eventName;
        courses[courseIndex].trackId = null; // Disassociate from AC track ID

        // Update course name to include event name
        courses[courseIndex].name = `${eventName} (Archived)`;

        saveCourses(courses);

        return courses[courseIndex];
    } catch (err) {
        console.error('Error archiving course:', err);
        return null;
    }
}

/**
 * Rename a course
 */
function renameCourse(courseId, newName) {
    try {
        const courses = loadCourses();
        const courseIndex = courses.findIndex(c => c.courseId === courseId);

        if (courseIndex === -1) {
            return null; // Course not found
        }

        // Update name
        courses[courseIndex].name = newName;

        // Save updated courses list
        if (!saveCourses(courses)) {
            return null;
        }

        return courses[courseIndex];
    } catch (err) {
        console.error('Error renaming course:', err);
        return null;
    }
}

// Run summaries (run data without telemetry, plus sector times), keyed by file path.
// An entry is reused while the file and the course sectors are unchanged.
const summaryCache = new Map();

/**
 * Read the summary of one run file, using the cache when nothing changed
 */
function readRunSummary(filePath, sectors, sectorsKey) {
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    const cached = summaryCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs && cached.sectorsKey === sectorsKey) {
        return cached.summary;
    }

    const { telemetry, ...summary } = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Same samples as the page uses, so card and table sector times match
    summary.sectorTimes = telemetry && telemetry.timestamps && telemetry.timestamps.length > 1
        ? track.sectorTimes(reduceSampleRate(telemetry, DISPLAY_SAMPLE_RATE), sectors)
        : [];
    summaryCache.set(filePath, { mtimeMs, sectorsKey, summary });
    return summary;
}

/**
 * Load run summaries for a course (no telemetry), newest first
 */
function loadRuns(courseId, limit = null, offset = 0) {
    const runsDir = path.join(DATA_DIR, courseId, 'runs');
    if (!fs.existsSync(runsDir)) {
        return [];
    }

    const sectors = loadSectors(courseId);
    const sectorsKey = JSON.stringify(sectors);

    let runs = [];
    for (const file of fs.readdirSync(runsDir)) {
        if (!file.endsWith('.json')) continue;
        try {
            runs.push(readRunSummary(path.join(runsDir, file), sectors, sectorsKey));
        } catch (err) {
            console.error(`Skipping unreadable run file ${file}:`, err.message);
        }
    }

    runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (limit !== null) {
        runs = runs.slice(offset, offset + limit);
    }

    return runs;
}

/**
 * Get a specific run by ID (reads individual file)
 */
function getRun(courseId, runId) {
    try {
        const runFile = path.join(DATA_DIR, courseId, 'runs', `${runId}.json`);
        if (!fs.existsSync(runFile)) {
            return null;
        }

        const data = fs.readFileSync(runFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading run:', err);
        return null;
    }
}

// Runs sent to the page keep at most DISPLAY_SAMPLE_RATE samples per second, and long runs
// (rally stages) at most MAX_DISPLAY_SAMPLES in total. More samples make the page slow
// without adding visible detail.
const DISPLAY_SAMPLE_RATE = 50;
const MAX_DISPLAY_SAMPLES = 15000;

/**
 * Load a run for display: same as getRun, with the telemetry reduced to DISPLAY_SAMPLE_RATE
 */
function getRunForDisplay(courseId, runId) {
    const run = getRun(courseId, runId);
    if (run && run.telemetry) run.telemetry = reduceSampleRate(run.telemetry, DISPLAY_SAMPLE_RATE);
    return run;
}

// Keep the first sample in each time slot of length 1/rate (or longer for long runs), plus
// the last sample. Every channel (also the per-wheel ones) keeps the same samples.
function reduceSampleRate(telemetry, rate) {
    const ts = telemetry.timestamps;
    if (!Array.isArray(ts) || ts.length < 3) return telemetry;
    const duration = ts[ts.length - 1] - ts[0];
    const step = Math.max(1 / rate, duration / MAX_DISPLAY_SAMPLES);
    // The small tolerance keeps exact grids (e.g. 0.02 s steps) from losing samples to rounding
    const slot = t => Math.floor((t - ts[0]) / step + 1e-6);
    const keep = [0];
    for (let i = 1; i < ts.length - 1; i++) {
        if (slot(ts[i]) > slot(ts[keep[keep.length - 1]])) keep.push(i);
    }
    keep.push(ts.length - 1);
    if (keep.length === ts.length) return telemetry;

    const n = ts.length;
    const pick = arr => keep.map(i => arr[i]);
    const reduced = {};
    for (const [key, value] of Object.entries(telemetry)) {
        if (Array.isArray(value) && value.length === n) {
            reduced[key] = pick(value);
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            reduced[key] = {};
            for (const [sub, arr] of Object.entries(value)) {
                reduced[key][sub] = Array.isArray(arr) && arr.length === n ? pick(arr) : arr;
            }
        } else {
            reduced[key] = value;
        }
    }
    return reduced;
}

/**
 * Save a new run to a course (writes individual file)
 */
function saveRun(courseId, runData) {
    try {
        const runsDir = path.join(DATA_DIR, courseId, 'runs');

        // Create runs directory if it doesn't exist
        if (!fs.existsSync(runsDir)) {
            fs.mkdirSync(runsDir, { recursive: true });
        }

        // Generate unique run ID if not provided
        if (!runData.runId) {
            runData.runId = `run-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
        }

        // Initialize cone penalty count if not provided
        if (runData.cones === undefined) {
            runData.cones = 0;
        }

        // Save individual run file
        const runFile = path.join(runsDir, `${runData.runId}.json`);
        fs.writeFileSync(runFile, JSON.stringify(runData));

        // Update course metadata
        updateCourseMetadata(courseId);

        rebuildTop10(courseId);

        return runData;
    } catch (err) {
        console.error('Error saving run:', err);
        return null;
    }
}

/**
 * Delete a run from a course (deletes individual file, checks top10 protection)
 */
function deleteRun(courseId, runId) {
    try {
        const runFile = path.join(DATA_DIR, courseId, 'runs', `${runId}.json`);

        // Check if file exists
        if (!fs.existsSync(runFile)) {
            return false; // Run not found
        }

        // Delete the run file
        fs.unlinkSync(runFile);

        // Update course metadata and rebuild top 10
        updateCourseMetadata(courseId);
        rebuildTop10(courseId);

        return true;
    } catch (err) {
        console.error('Error deleting run:', err);
        return false;
    }
}

/**
 * Rename a run (updates individual file)
 */
function renameRun(courseId, runId, name) {
    try {
        const runFile = path.join(DATA_DIR, courseId, 'runs', `${runId}.json`);

        // Check if file exists
        if (!fs.existsSync(runFile)) {
            return false; // Run not found
        }

        // Read run data
        const data = fs.readFileSync(runFile, 'utf8');
        const run = JSON.parse(data);

        // Update name
        run.name = name || null;

        // Save updated run
        fs.writeFileSync(runFile, JSON.stringify(run));

        return true;
    } catch (err) {
        console.error('Error renaming run:', err);
        return false;
    }
}

/**
 * Update cone penalty count for a run (updates individual file)
 */
function updateCones(courseId, runId, cones) {
    try {
        const runFile = path.join(DATA_DIR, courseId, 'runs', `${runId}.json`);

        // Check if file exists
        if (!fs.existsSync(runFile)) {
            return false; // Run not found
        }

        // Read run data
        const data = fs.readFileSync(runFile, 'utf8');
        const run = JSON.parse(data);

        // Update cone penalty count
        run.cones = cones;

        // Save updated run
        fs.writeFileSync(runFile, JSON.stringify(run));

        // Rebuild top 10 since adjusted times changed
        rebuildTop10(courseId);

        return true;
    } catch (err) {
        console.error('Error updating cone count:', err);
        return false;
    }
}

/**
 * Compute run count and best adjusted time from the run files
 */
function computeCourseStats(courseId) {
    const runs = loadRuns(courseId);
    const validRuns = runs.filter(r => r.isValid);
    return {
        runCount: runs.length,
        bestTime: validRuns.length > 0
            ? Math.min(...validRuns.map(r => getAdjustedTime(r)))
            : null
    };
}

/**
 * Update course metadata (run count, best time)
 */
function updateCourseMetadata(courseId) {
    const courses = loadCourses();
    const course = courses.find(c => c.courseId === courseId);
    if (!course) return;

    Object.assign(course, computeCourseStats(courseId));
    saveCourses(courses);
}

/**
 * Load all courses with run count and best time taken from the run files.
 * Runs saved by the recorder do not update courses.json, so this keeps it current.
 */
function loadCoursesWithStats() {
    const courses = loadCourses();
    let changed = false;

    for (const course of courses) {
        const stats = computeCourseStats(course.courseId);
        if (course.runCount !== stats.runCount || course.bestTime !== stats.bestTime) {
            Object.assign(course, stats);
            changed = true;
        }
    }

    if (changed) saveCourses(courses);
    return courses;
}

/**
 * Compute the top 10 valid runs by adjusted time
 */
function computeTop10(courseId) {
    return loadRuns(courseId)
        .filter(r => r.isValid)
        .sort((a, b) => getAdjustedTime(a) - getAdjustedTime(b))
        .slice(0, 10)
        .map(run => ({
            runId: run.runId,
            lapTime: run.lapTime,
            cones: run.cones || 0,
            adjustedTime: getAdjustedTime(run),
            timestamp: run.timestamp,
            carId: run.carId
        }));
}

/**
 * Load top 10 runs for a course (computed from the run files)
 */
function loadTop10(courseId) {
    try {
        return computeTop10(courseId);
    } catch (err) {
        console.error('Error loading top 10:', err);
        return [];
    }
}

/**
 * Rebuild top10.json from all runs
 */
function rebuildTop10(courseId) {
    try {
        const top10 = computeTop10(courseId);
        const top10File = path.join(DATA_DIR, courseId, 'top10.json');
        fs.writeFileSync(top10File, JSON.stringify(top10, null, 2));
        return top10;
    } catch (err) {
        console.error('Error rebuilding top 10:', err);
        return null;
    }
}

/**
 * Load sectors for a course
 */
function loadSectors(courseId) {
    try {
        const sectorsFile = path.join(DATA_DIR, courseId, 'sectors.json');
        if (!fs.existsSync(sectorsFile)) {
            return [];
        }
        const data = fs.readFileSync(sectorsFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading sectors:', err);
        return [];
    }
}

/**
 * Save sectors for a course
 */
function saveSectors(courseId, sectors) {
    try {
        const courseDir = path.join(DATA_DIR, courseId);
        if (!fs.existsSync(courseDir)) {
            return false;
        }
        const sectorsFile = path.join(courseDir, 'sectors.json');
        fs.writeFileSync(sectorsFile, JSON.stringify(sectors, null, 2));
        return true;
    } catch (err) {
        console.error('Error saving sectors:', err);
        return false;
    }
}

module.exports = {
    isValidId,
    loadCourses,
    loadCoursesWithStats,
    saveCourses,
    createCourse,
    getCourse,
    deleteCourse,
    archiveCourse,
    renameCourse,
    loadRuns,
    getRun,
    getRunForDisplay,
    saveRun,
    deleteRun,
    renameRun,
    updateCones,
    loadTop10,
    rebuildTop10,
    loadSectors,
    saveSectors
};
