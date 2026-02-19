const fs = require('fs');
const path = require('path');

// Base directory for autocross data (now in telemetry/data/autocross)
const DATA_DIR = path.join(__dirname, '../../telemetry/data/autocross');
const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const CONE_PENALTY = 2; // seconds per cone

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

/**
 * Load all runs for a course (reads individual run files)
 */
function loadRuns(courseId, limit = null, offset = 0) {
    try {
        const runsDir = path.join(DATA_DIR, courseId, 'runs');
        if (!fs.existsSync(runsDir)) {
            return [];
        }

        // Read all .json files from runs directory
        const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.json'));

        let runs = files.map(file => {
            const filePath = path.join(runsDir, file);
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        });

        // Sort by timestamp (newest first)
        runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Apply pagination if specified
        if (limit !== null) {
            runs = runs.slice(offset, offset + limit);
        }

        return runs;
    } catch (err) {
        console.error('Error loading runs:', err);
        return [];
    }
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
        fs.writeFileSync(runFile, JSON.stringify(runData, null, 2));

        // Update course metadata
        updateCourseMetadata(courseId);

        // Update top 10 if this is a fast run
        updateTop10(courseId, runData);

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
        fs.writeFileSync(runFile, JSON.stringify(run, null, 2));

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
        fs.writeFileSync(runFile, JSON.stringify(run, null, 2));

        // Rebuild top 10 since adjusted times changed
        rebuildTop10(courseId);

        return true;
    } catch (err) {
        console.error('Error updating cone count:', err);
        return false;
    }
}

/**
 * Update course metadata (run count, best time)
 */
function updateCourseMetadata(courseId) {
    const courses = loadCourses();
    const courseIndex = courses.findIndex(c => c.courseId === courseId);

    if (courseIndex === -1) return;

    const runs = loadRuns(courseId);
    const validRuns = runs.filter(r => r.isValid);

    courses[courseIndex].runCount = runs.length;
    courses[courseIndex].bestTime = validRuns.length > 0
        ? Math.min(...validRuns.map(r => getAdjustedTime(r)))
        : null;

    saveCourses(courses);
}

/**
 * Load top 10 runs for a course
 */
function loadTop10(courseId) {
    try {
        const top10File = path.join(DATA_DIR, courseId, 'top10.json');
        if (!fs.existsSync(top10File)) {
            return [];
        }

        const data = fs.readFileSync(top10File, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading top 10:', err);
        return [];
    }
}

/**
 * Update top 10 list with a new run (if it qualifies)
 */
function updateTop10(courseId, newRun) {
    try {
        if (!newRun.isValid) return; // Only valid runs can be in top 10

        const top10File = path.join(DATA_DIR, courseId, 'top10.json');
        let top10 = loadTop10(courseId);

        // Add new run with adjusted time
        const adjustedTime = getAdjustedTime(newRun);
        top10.push({
            runId: newRun.runId,
            lapTime: newRun.lapTime,
            cones: newRun.cones || 0,
            adjustedTime: adjustedTime,
            timestamp: newRun.timestamp,
            carId: newRun.carId
        });

        // Sort by adjusted time (fastest first) and keep only top 10
        top10.sort((a, b) => a.adjustedTime - b.adjustedTime);
        top10 = top10.slice(0, 10);

        // Save updated top 10
        fs.writeFileSync(top10File, JSON.stringify(top10, null, 2));

        return top10;
    } catch (err) {
        console.error('Error updating top 10:', err);
        return null;
    }
}

/**
 * Rebuild top 10 list from all runs (used after deletion)
 */
function rebuildTop10(courseId) {
    try {
        const runs = loadRuns(courseId);
        const validRuns = runs.filter(r => r.isValid);

        // Sort by adjusted time and take top 10
        const top10 = validRuns
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

        const top10File = path.join(DATA_DIR, courseId, 'top10.json');
        fs.writeFileSync(top10File, JSON.stringify(top10, null, 2));

        return top10;
    } catch (err) {
        console.error('Error rebuilding top 10:', err);
        return null;
    }
}

module.exports = {
    loadCourses,
    saveCourses,
    createCourse,
    getCourse,
    deleteCourse,
    archiveCourse,
    loadRuns,
    getRun,
    saveRun,
    deleteRun,
    renameRun,
    updateCones,
    loadTop10,
    updateTop10,
    rebuildTop10
};
