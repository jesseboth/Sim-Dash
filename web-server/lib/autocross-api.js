const storage = require('./autocross-storage');
const mappings = require('./autocross-mappings');

/**
 * Handle autocross API requests
 * All requests come through a single endpoint with an 'action' field
 */
async function handleRequest(data) {
    const { action } = data;

    try {
        switch (action) {
            case 'getCourses':
                return handleGetCourses();

            case 'createCourse':
                return handleCreateCourse(data);

            case 'deleteCourse':
                return handleDeleteCourse(data);

            case 'getRuns':
                return handleGetRuns(data);

            case 'getRun':
                return handleGetRun(data);

            case 'saveRun':
                return handleSaveRun(data);

            case 'deleteRun':
                return handleDeleteRun(data);

            case 'getTop10':
                return handleGetTop10(data);

            case 'renameRun':
                return handleRenameRun(data);

            case 'exportRuns':
                return handleExportRuns(data);

            case 'importRuns':
                return handleImportRuns(data);

            case 'updateCones':
                return handleUpdateCones(data);

            case 'getCarNames':
                return handleGetCarNames(data);

            case 'getCarMappings':
                return handleGetCarMappings();

            case 'getTrackMappings':
                return handleGetTrackMappings();

            case 'setCarName':
                return handleSetCarName(data);

            case 'setTrackName':
                return handleSetTrackName(data);

            case 'archiveCourse':
                return handleArchiveCourse(data);

            default:
                return {
                    success: false,
                    error: `Unknown action: ${action}`
                };
        }
    } catch (error) {
        console.error('Autocross API error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get all courses
 */
function handleGetCourses() {
    const courses = storage.loadCourses();
    return {
        success: true,
        data: courses
    };
}

/**
 * Create a new course
 */
function handleCreateCourse(data) {
    const { name, trackId } = data;

    if (!name) {
        return {
            success: false,
            error: 'Name is required'
        };
    }

    const course = storage.createCourse(name, trackId);

    if (!course) {
        return {
            success: false,
            error: 'Failed to create course'
        };
    }

    return {
        success: true,
        data: course
    };
}

/**
 * Delete a course
 */
function handleDeleteCourse(data) {
    const { courseId } = data;

    if (!courseId) {
        return {
            success: false,
            error: 'courseId is required'
        };
    }

    const result = storage.deleteCourse(courseId);

    if (!result) {
        return {
            success: false,
            error: 'Failed to delete course'
        };
    }

    return {
        success: true,
        data: { courseId }
    };
}

/**
 * Archive a course
 */
function handleArchiveCourse(data) {
    const { courseId, carName, eventName } = data;

    if (!courseId || !carName || !eventName) {
        return {
            success: false,
            error: 'courseId, carName, and eventName are required'
        };
    }

    const result = storage.archiveCourse(courseId, carName, eventName);

    if (!result) {
        return {
            success: false,
            error: 'Failed to archive course'
        };
    }

    return {
        success: true,
        data: result
    };
}

/**
 * Get runs for a course with optional pagination
 */
function handleGetRuns(data) {
    const { courseId, limit, offset } = data;

    if (!courseId) {
        return {
            success: false,
            error: 'courseId is required'
        };
    }

    const runs = storage.loadRuns(courseId, limit, offset || 0);

    return {
        success: true,
        data: runs
    };
}

/**
 * Get a specific run with full telemetry
 */
function handleGetRun(data) {
    const { courseId, runId } = data;

    if (!courseId || !runId) {
        return {
            success: false,
            error: 'courseId and runId are required'
        };
    }

    const run = storage.getRun(courseId, runId);

    if (!run) {
        return {
            success: false,
            error: 'Run not found'
        };
    }

    return {
        success: true,
        data: run
    };
}

/**
 * Save a new run
 */
function handleSaveRun(data) {
    const { courseId, runData } = data;

    if (!courseId || !runData) {
        return {
            success: false,
            error: 'courseId and runData are required'
        };
    }

    // Validate run data
    if (!runData.lapTime || !runData.telemetry) {
        return {
            success: false,
            error: 'Run data must include lapTime and telemetry'
        };
    }

    const savedRun = storage.saveRun(courseId, runData);

    if (!savedRun) {
        return {
            success: false,
            error: 'Failed to save run'
        };
    }

    return {
        success: true,
        data: savedRun
    };
}

/**
 * Delete a run
 */
function handleDeleteRun(data) {
    const { courseId, runId } = data;

    if (!courseId || !runId) {
        return {
            success: false,
            error: 'courseId and runId are required'
        };
    }

    const result = storage.deleteRun(courseId, runId);

    if (!result) {
        return {
            success: false,
            error: 'Failed to delete run or run not found'
        };
    }

    return {
        success: true,
        data: { runId }
    };
}

/**
 * Get top 10 runs for a course
 */
function handleGetTop10(data) {
    const { courseId } = data;

    if (!courseId) {
        return {
            success: false,
            error: 'courseId is required'
        };
    }

    const top10 = storage.loadTop10(courseId);

    return {
        success: true,
        data: top10
    };
}

/**
 * Rename a run
 */
function handleRenameRun(data) {
    const { courseId, runId, name } = data;

    if (!courseId || !runId || name === undefined) {
        return {
            success: false,
            error: 'courseId, runId, and name are required'
        };
    }

    const result = storage.renameRun(courseId, runId, name);

    if (!result) {
        return {
            success: false,
            error: 'Failed to rename run or run not found'
        };
    }

    return {
        success: true,
        data: { runId, name }
    };
}

/**
 * Export runs (return run data for download)
 */
function handleExportRuns(data) {
    const { courseId, runIds } = data;

    if (!courseId || !runIds || !Array.isArray(runIds)) {
        return {
            success: false,
            error: 'courseId and runIds array are required'
        };
    }

    const runs = [];
    for (const runId of runIds) {
        const run = storage.getRun(courseId, runId);
        if (run) {
            runs.push(run);
        }
    }

    if (runs.length === 0) {
        return {
            success: false,
            error: 'No runs found to export'
        };
    }

    return {
        success: true,
        data: {
            exportDate: new Date().toISOString(),
            runs: runs
        }
    };
}

/**
 * Import runs from external source
 */
function handleImportRuns(data) {
    const { courseId, runs } = data;

    if (!courseId || !runs || !Array.isArray(runs)) {
        return {
            success: false,
            error: 'courseId and runs array are required'
        };
    }

    const importedRuns = [];
    const errors = [];

    for (const runData of runs) {
        try {
            // Validate basic run structure
            if (!runData.lapTime || !runData.telemetry) {
                errors.push(`Invalid run data: missing lapTime or telemetry`);
                continue;
            }

            // Generate new runId to avoid conflicts
            const timestamp = Date.now();
            const randomSuffix = Math.floor(Math.random() * 1000);
            const newRunId = `run-${timestamp}-${randomSuffix}`;

            // Preserve custom name if it exists
            const importedRun = {
                ...runData,
                runId: newRunId,
                courseId: courseId,
                timestamp: new Date().toISOString(),
                imported: true
            };

            const savedRun = storage.saveRun(courseId, importedRun);
            if (savedRun) {
                importedRuns.push(savedRun);
            } else {
                errors.push(`Failed to save run ${runData.runId || 'unknown'}`);
            }
        } catch (error) {
            errors.push(`Error importing run: ${error.message}`);
        }
    }

    return {
        success: true,
        data: {
            imported: importedRuns.length,
            runs: importedRuns,
            errors: errors
        }
    };
}

/**
 * Update cone penalty count for a run
 */
function handleUpdateCones(data) {
    const { courseId, runId, cones } = data;

    if (!courseId || !runId || cones === undefined) {
        return {
            success: false,
            error: 'courseId, runId, and cones are required'
        };
    }

    // Validate cones is a non-negative integer
    const conesNum = parseInt(cones, 10);
    if (isNaN(conesNum) || conesNum < 0) {
        return {
            success: false,
            error: 'cones must be a non-negative integer'
        };
    }

    const result = storage.updateCones(courseId, runId, conesNum);

    if (!result) {
        return {
            success: false,
            error: 'Failed to update cone count or run not found'
        };
    }

    return {
        success: true,
        data: { runId, cones: conesNum }
    };
}

/**
 * Get friendly names for a list of car ID hashes
 * Returns a map of { carId: name } for only the requested IDs
 */
function handleGetCarNames(data) {
    const { carIds } = data;

    if (!carIds || !Array.isArray(carIds)) {
        return { success: false, error: 'carIds array is required' };
    }

    const allMappings = mappings.getAllCarMappings();
    const result = {};
    for (const carId of carIds) {
        if (allMappings[carId]) {
            result[carId] = allMappings[carId];
        }
    }

    return { success: true, data: result };
}

/**
 * Get all car name mappings
 */
function handleGetCarMappings() {
    const carMappings = mappings.getAllCarMappings();
    return {
        success: true,
        data: carMappings
    };
}

/**
 * Get all track name mappings
 */
function handleGetTrackMappings() {
    const trackMappings = mappings.getAllTrackMappings();
    return {
        success: true,
        data: trackMappings
    };
}

/**
 * Set a car name mapping
 */
function handleSetCarName(data) {
    const { carId, name } = data;

    if (!carId || !name) {
        return {
            success: false,
            error: 'carId and name are required'
        };
    }

    const result = mappings.setCarName(carId, name);

    if (!result) {
        return {
            success: false,
            error: 'Failed to save car name'
        };
    }

    return {
        success: true,
        data: { carId, name }
    };
}

/**
 * Set a track name mapping
 */
function handleSetTrackName(data) {
    const { trackId, name } = data;

    if (!trackId || !name) {
        return {
            success: false,
            error: 'trackId and name are required'
        };
    }

    const result = mappings.setTrackName(trackId, name);

    if (!result) {
        return {
            success: false,
            error: 'Failed to save track name'
        };
    }

    return {
        success: true,
        data: { trackId, name }
    };
}

module.exports = {
    handleRequest
};
