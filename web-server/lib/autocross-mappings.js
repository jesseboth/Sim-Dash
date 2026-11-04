const fs = require('fs');
const path = require('path');

// Mappings files location
const MAPPINGS_DIR = path.join(__dirname, '../../telemetry/data/autocross');
const CAR_MAPPINGS_FILE = path.join(MAPPINGS_DIR, 'car-names.json');
const TRACK_MAPPINGS_FILE = path.join(MAPPINGS_DIR, 'track-names.json');
const DRIVERS_FILE = path.join(MAPPINGS_DIR, 'drivers.json');

// Ensure mappings directory exists
if (!fs.existsSync(MAPPINGS_DIR)) {
    fs.mkdirSync(MAPPINGS_DIR, { recursive: true });
}

/**
 * Load car name mappings
 */
function loadCarMappings() {
    try {
        if (!fs.existsSync(CAR_MAPPINGS_FILE)) {
            return {};
        }
        const data = fs.readFileSync(CAR_MAPPINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading car mappings:', err);
        return {};
    }
}

/**
 * Load track name mappings
 */
function loadTrackMappings() {
    try {
        if (!fs.existsSync(TRACK_MAPPINGS_FILE)) {
            return {};
        }
        const data = fs.readFileSync(TRACK_MAPPINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading track mappings:', err);
        return {};
    }
}

/**
 * Save car name mappings
 */
function saveCarMappings(mappings) {
    try {
        fs.writeFileSync(CAR_MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
        return true;
    } catch (err) {
        console.error('Error saving car mappings:', err);
        return false;
    }
}

/**
 * Save track name mappings
 */
function saveTrackMappings(mappings) {
    try {
        fs.writeFileSync(TRACK_MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
        return true;
    } catch (err) {
        console.error('Error saving track mappings:', err);
        return false;
    }
}

/**
 * Get friendly name for a car ID
 */
function getCarName(carId) {
    const mappings = loadCarMappings();
    return mappings[carId] || `Car ${carId}`;
}

/**
 * Get friendly name for a track ID
 */
function getTrackName(trackId) {
    const mappings = loadTrackMappings();
    return mappings[trackId] || `Track ${trackId}`;
}

/**
 * Set friendly name for a car ID
 */
function setCarName(carId, name) {
    const mappings = loadCarMappings();
    mappings[carId] = name;
    return saveCarMappings(mappings);
}

/**
 * Set friendly name for a track ID
 */
function setTrackName(trackId, name) {
    const mappings = loadTrackMappings();
    mappings[trackId] = name;
    return saveTrackMappings(mappings);
}

/**
 * Get all car mappings
 */
function getAllCarMappings() {
    return loadCarMappings();
}

/**
 * Get all track mappings
 */
function getAllTrackMappings() {
    return loadTrackMappings();
}

/**
 * Load the driver list. Returns null when the list was never saved.
 */
function loadDrivers() {
    try {
        if (!fs.existsSync(DRIVERS_FILE)) return null;
        const drivers = JSON.parse(fs.readFileSync(DRIVERS_FILE, 'utf8'));
        return Array.isArray(drivers) ? drivers : [];
    } catch (err) {
        console.error('Error loading drivers:', err);
        return [];
    }
}

/**
 * Save the driver list, sorted and without duplicates
 */
function saveDrivers(drivers) {
    try {
        const list = [...new Set(drivers.filter(Boolean).map(d => String(d).trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        fs.writeFileSync(DRIVERS_FILE, JSON.stringify(list, null, 2));
        return list;
    } catch (err) {
        console.error('Error saving drivers:', err);
        return null;
    }
}

module.exports = {
    loadDrivers,
    saveDrivers,
    getCarName,
    getTrackName,
    setCarName,
    setTrackName,
    getAllCarMappings,
    getAllTrackMappings
};
