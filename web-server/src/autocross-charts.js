// Autocross Charts - uPlot visualization

const AutocrossCharts = (function() {
    // Chart instances
    let speedChart = null;
    let throttleChart = null;
    let brakeChart = null;
    let gForceChart = null;

    // Current run data
    let currentRuns = [];
    let syncCursor = null;

    // Color palette for comparison (6 distinct colors)
    const COLORS = [
        '#4a9eff', // Blue
        '#ff4a4a', // Red
        '#4aff4a', // Green
        '#ffaa4a', // Orange
        '#ff4aff', // Magenta
        '#4affff'  // Cyan
    ];

    // Initialize charts
    function init() {
        console.log('Initializing charts...');

        // Create cursor sync plugin
        syncCursor = cursorSync();

        // Initialize all charts
        speedChart = createSpeedChart();
        throttleChart = createThrottleChart();
        brakeChart = createBrakeChart();
        gForceChart = createGForceChart();

        console.log('Charts initialized');
    }

    // Cursor sync plugin
    function cursorSync() {
        let syncKey = null;

        return {
            hooks: {
                setCursor: [
                    (u) => {
                        if (syncKey === null) {
                            syncKey = u;

                            // Update all other charts
                            [speedChart, throttleChart, brakeChart, gForceChart].forEach(chart => {
                                if (chart && chart !== u) {
                                    chart.setCursor({
                                        left: u.cursor.left,
                                        top: u.cursor.top
                                    });
                                }
                            });

                            // Update value displays for all charts
                            updateValueDisplays(u.cursor.idx);

                            // Notify scrubber (but not if scrubber initiated this update)
                            if (window.AutocrossScrubber && u.cursor.idx !== undefined && !window._scrubberSeeking) {
                                const time = u.data[0][u.cursor.idx];
                                window.AutocrossScrubber.seekTo(time);
                            }

                            syncKey = null;
                        }
                    }
                ]
            }
        };
    }

    // Create Speed Chart
    function createSpeedChart() {
        const container = document.getElementById('speedChart');
        const opts = {
            title: "Speed",
            width: container.parentElement.offsetWidth - 32, // Account for padding
            height: 200,
            padding: [null, null, 0, null], // top, right, bottom (0 to remove x-axis space), left
            scales: {
                x: { time: false },
                y: { range: [0, 120] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                }, // Hide x-axis completely
                { label: "Speed (mph)", stroke: "#888", grid: { stroke: "#333" } }
            ],
            series: [
                { label: "Time" }
            ],
            legend: {
                show: false
            },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                lock: false,
                drag: { x: false, y: false },
                sync: {
                    key: 'autocross-cursor'
                },
                points: {
                    show: true
                }
            }
        };

        return new uPlot(opts, [[0]], document.getElementById('speedChart'));
    }

    // Create Throttle Chart
    function createThrottleChart() {
        const container = document.getElementById('throttleChart');
        const opts = {
            title: "Throttle",
            width: container.parentElement.offsetWidth - 32,
            height: 200,
            padding: [null, null, 0, null], // top, right, bottom (0 to remove x-axis space), left
            scales: {
                x: { time: false },
                y: { range: [0, 100] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                }, // Hide x-axis completely
                { label: "%", stroke: "#888", grid: { stroke: "#333" } }
            ],
            series: [
                { label: "Time" }
            ],
            legend: {
                show: false
            },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                lock: false,
                drag: { x: false, y: false },
                sync: {
                    key: 'autocross-cursor'
                },
                points: {
                    show: true
                }
            }
        };

        return new uPlot(opts, [[0]], document.getElementById('throttleChart'));
    }

    // Create Brake Chart
    function createBrakeChart() {
        const container = document.getElementById('brakeChart');
        const opts = {
            title: "Brake",
            width: container.parentElement.offsetWidth - 32,
            height: 200,
            padding: [null, null, 0, null], // top, right, bottom (0 to remove x-axis space), left
            scales: {
                x: { time: false },
                y: { range: [0, 100] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                }, // Hide x-axis completely
                { label: "%", stroke: "#888", grid: { stroke: "#333" } }
            ],
            series: [
                { label: "Time" }
            ],
            legend: {
                show: false
            },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                lock: false,
                drag: { x: false, y: false },
                sync: {
                    key: 'autocross-cursor'
                },
                points: {
                    show: true
                }
            }
        };

        return new uPlot(opts, [[0]], document.getElementById('brakeChart'));
    }

    // Create Combined G-Force Chart (Lateral + Longitudinal)
    function createGForceChart() {
        const container = document.getElementById('gForceChart');
        const opts = {
            title: "G-Forces",
            width: container.parentElement.offsetWidth - 32,
            height: 200,
            padding: [null, null, 0, null], // top, right, bottom (0 to remove x-axis space), left
            scales: {
                x: { time: false },
                y: { range: [-2, 2] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                }, // Hide x-axis completely
                { label: "G", stroke: "#888", grid: { stroke: "#333", show: true, values: [[-2, -1, 0, 1, 2]] } }
            ],
            series: [
                { label: "Time" }
            ],
            legend: {
                show: false
            },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                lock: false,
                drag: { x: false, y: false },
                sync: {
                    key: 'autocross-cursor'
                },
                points: {
                    show: true
                }
            }
        };

        return new uPlot(opts, [[0]], document.getElementById('gForceChart'));
    }

    // Load single run
    function loadRun(run) {
        console.log('Loading run:', run.runId);
        currentRuns = [run];
        updateCharts();
    }

    // Compare multiple runs
    function compareRuns(runs) {
        console.log('Comparing runs:', runs.map(r => r.runId));
        currentRuns = runs.slice(0, 6); // Max 6 runs
        updateCharts();
    }

    // Update all charts with current runs
    function updateCharts() {
        if (currentRuns.length === 0) {
            clear();
            return;
        }

        // Prepare data for each chart
        updateSpeedChart();
        updateThrottleChart();
        updateBrakeChart();
        updateGForceChart();
    }

    // Update Speed Chart
    function updateSpeedChart() {
        console.log('Updating speed chart with', currentRuns.length, 'runs');

        // Find the longest run duration to set x-axis range
        const maxDuration = Math.max(...currentRuns.map(run =>
            run.telemetry.timestamps[run.telemetry.timestamps.length - 1]
        ));

        // Create a unified timeline based on the longest run
        const longestRun = currentRuns.reduce((longest, run) => {
            const currentDuration = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const longestDuration = longest.telemetry.timestamps[longest.telemetry.timestamps.length - 1];
            return currentDuration > longestDuration ? run : longest;
        }, currentRuns[0]);

        const data = [longestRun.telemetry.timestamps];
        const series = [{ label: "Time" }];

        // Reverse order so fastest (first) draws on top (matching canvas behavior)
        const reversedRuns = [...currentRuns].reverse();

        reversedRuns.forEach((run) => {
            // Pad data with null values to match the longest run's length
            const paddedSpeed = padDataToLength(
                run.telemetry.speed,
                run.telemetry.timestamps,
                longestRun.telemetry.timestamps
            );
            data.push(paddedSpeed);

            // Most recent run gets dark blue, others get their speed-based color
            const color = run.isMostRecent ? '#7d5aff' : COLORS[currentRuns.indexOf(run) % COLORS.length];
            series.push({
                label: `Run #${run.runNumber || (currentRuns.indexOf(run) + 1)}`,
                stroke: color,
                width: 1
            });
        });

        console.log('Speed chart data:', data.length, 'series, first timestamp array length:', data[0].length);

        // Always recreate chart to update colors
        const container = document.getElementById('speedChart');
        container.innerHTML = ''; // Clear old chart
        speedChart.destroy();
        const newOpts = {
            title: "Speed",
            width: container.parentElement.offsetWidth - 32,
            height: 200,
            padding: [null, null, 0, null],
            scales: {
                x: { time: false },
                y: { range: [0, 120] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                },
                { label: "Speed (mph)", stroke: "#888", grid: { stroke: "#333" } }
            ],
            series: series,
            legend: { show: false },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                drag: { x: false, y: false },
                sync: { key: 'autocross-cursor' },
                points: { show: true }
            }
        };
        speedChart = new uPlot(newOpts, data, container);
    }

    // Update Throttle Chart
    function updateThrottleChart() {
        // Find the longest run to use as base timeline
        const longestRun = currentRuns.reduce((longest, run) => {
            const currentDuration = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const longestDuration = longest.telemetry.timestamps[longest.telemetry.timestamps.length - 1];
            return currentDuration > longestDuration ? run : longest;
        }, currentRuns[0]);

        const data = [longestRun.telemetry.timestamps];
        const series = [{ label: "Time" }];

        // Reverse order so fastest (first) draws on top (matching canvas behavior)
        const reversedRuns = [...currentRuns].reverse();

        reversedRuns.forEach((run) => {
            const throttlePercent = run.telemetry.accel.map(v => v * 100);
            const paddedThrottle = padDataToLength(
                throttlePercent,
                run.telemetry.timestamps,
                longestRun.telemetry.timestamps
            );
            data.push(paddedThrottle);

            // Most recent run gets dark blue, others get their speed-based color
            const color = run.isMostRecent ? '#7d5aff' : COLORS[currentRuns.indexOf(run) % COLORS.length];
            series.push({
                label: `Run #${run.runNumber || (currentRuns.indexOf(run) + 1)}`,
                stroke: color,
                width: 1
            });
        });

        // Always recreate chart to update colors
        const container = document.getElementById('throttleChart');
        container.innerHTML = ''; // Clear old chart
        throttleChart.destroy();
        const newOpts = {
            title: "Throttle",
            width: container.parentElement.offsetWidth - 32,
            height: 200,
            padding: [null, null, 0, null],
            scales: {
                x: { time: false },
                y: { range: [0, 100] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                },
                { label: "%", stroke: "#888", grid: { stroke: "#333" } }
            ],
            series: series,
            legend: { show: false },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                drag: { x: false, y: false },
                sync: { key: 'autocross-cursor' },
                points: { show: true }
            }
        };
        throttleChart = new uPlot(newOpts, data, container);
    }

    // Update Brake Chart
    function updateBrakeChart() {
        // Find the longest run to use as base timeline
        const longestRun = currentRuns.reduce((longest, run) => {
            const currentDuration = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const longestDuration = longest.telemetry.timestamps[longest.telemetry.timestamps.length - 1];
            return currentDuration > longestDuration ? run : longest;
        }, currentRuns[0]);

        const data = [longestRun.telemetry.timestamps];
        const series = [{ label: "Time" }];

        // Reverse order so fastest (first) draws on top (matching canvas behavior)
        const reversedRuns = [...currentRuns].reverse();

        reversedRuns.forEach((run) => {
            const brakePercent = run.telemetry.brake.map(v => v * 100);
            const paddedBrake = padDataToLength(
                brakePercent,
                run.telemetry.timestamps,
                longestRun.telemetry.timestamps
            );
            data.push(paddedBrake);

            // Most recent run gets dark blue, others get their speed-based color
            const color = run.isMostRecent ? '#7d5aff' : COLORS[currentRuns.indexOf(run) % COLORS.length];
            series.push({
                label: `Run #${run.runNumber || (currentRuns.indexOf(run) + 1)}`,
                stroke: color,
                width: 1
            });
        });

        // Always recreate chart to update colors
        const container = document.getElementById('brakeChart');
        container.innerHTML = ''; // Clear old chart
        brakeChart.destroy();
        const newOpts = {
            title: "Brake",
            width: container.parentElement.offsetWidth - 32,
            height: 200,
            padding: [null, null, 0, null],
            scales: {
                x: { time: false },
                y: { range: [0, 100] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                },
                { label: "%", stroke: "#888", grid: { stroke: "#333" } }
            ],
            series: series,
            legend: { show: false },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                drag: { x: false, y: false },
                sync: { key: 'autocross-cursor' },
                points: { show: true }
            }
        };
        brakeChart = new uPlot(newOpts, data, container);
    }

    // Update Combined G-Force Chart (Lateral + Longitudinal)
    function updateGForceChart() {
        // Find the longest run to use as base timeline
        const longestRun = currentRuns.reduce((longest, run) => {
            const currentDuration = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const longestDuration = longest.telemetry.timestamps[longest.telemetry.timestamps.length - 1];
            return currentDuration > longestDuration ? run : longest;
        }, currentRuns[0]);

        const data = [longestRun.telemetry.timestamps];
        const series = [{ label: "Time" }];

        // Reverse order so fastest (first) draws on top (matching canvas behavior)
        const reversedRuns = [...currentRuns].reverse();

        reversedRuns.forEach((run) => {
            // Most recent run gets dark blue, others get their speed-based color
            const color = run.isMostRecent ? '#7d5aff' : COLORS[currentRuns.indexOf(run) % COLORS.length];

            // Add lateral G (solid line) with padding
            const paddedLateral = padDataToLength(
                run.telemetry.accelX,
                run.telemetry.timestamps,
                longestRun.telemetry.timestamps
            );
            data.push(paddedLateral);
            series.push({
                label: `Lateral #${run.runNumber || (currentRuns.indexOf(run) + 1)}`,
                stroke: color,
                width: 1
            });

            // Add longitudinal G (dashed line) with padding
            const paddedLongitudinal = padDataToLength(
                run.telemetry.accelY,
                run.telemetry.timestamps,
                longestRun.telemetry.timestamps
            );
            data.push(paddedLongitudinal);
            series.push({
                label: `Longitudinal #${run.runNumber || (currentRuns.indexOf(run) + 1)}`,
                stroke: color,
                width: 1,
                dash: [5, 5]
            });
        });

        // Always recreate chart to update colors
        const container = document.getElementById('gForceChart');
        container.innerHTML = ''; // Clear old chart
        gForceChart.destroy();
        const newOpts = {
            title: "G-Forces",
            width: container.parentElement.offsetWidth - 32,
            height: 200,
            padding: [null, null, 0, null],
            scales: {
                x: { time: false },
                y: { range: [-2, 2] }
            },
            axes: [
                {
                    show: false,
                    space: 0,
                    gap: 0,
                    values: () => []
                },
                { label: "G", stroke: "#888", grid: { stroke: "#333", show: true, values: [[-2, -1, 0, 1, 2]] } }
            ],
            series: series,
            legend: { show: false },
            plugins: [syncCursor],
            cursor: {
                show: true,
                x: true,
                y: false,
                drag: { x: false, y: false },
                sync: { key: 'autocross-cursor' },
                points: { show: true }
            }
        };
        gForceChart = new uPlot(newOpts, data, container);
    }

    // Seek to specific time
    function seekTo(time, fromScrubber = false) {
        if (!currentRuns.length || !currentRuns[0].telemetry) return;

        // Use the longest run's timestamps for seeking
        const longestRun = currentRuns.reduce((longest, run) => {
            const currentDuration = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const longestDuration = longest.telemetry.timestamps[longest.telemetry.timestamps.length - 1];
            return currentDuration > longestDuration ? run : longest;
        }, currentRuns[0]);

        const timestamps = longestRun.telemetry.timestamps;
        const index = findClosestIndex(timestamps, time);

        // Temporarily disable sync callback to scrubber
        if (fromScrubber) {
            window._scrubberSeeking = true;
        }

        // Update all charts' cursors
        [speedChart, throttleChart, brakeChart, gForceChart].forEach(chart => {
            if (chart) {
                // When seeking from scrubber, force cursor to be visible
                if (fromScrubber) {
                    // Set cursor with explicit left position to make it visible
                    const xVal = timestamps[index];
                    const plotLeft = chart.valToPos(xVal, 'x');
                    chart.setCursor({
                        idx: index,
                        left: plotLeft,
                        top: chart.bbox.height / 2
                    });
                } else {
                    chart.setCursor({ idx: index });
                }
            }
        });

        // Update value displays
        updateValueDisplays(index);

        // Re-enable sync callback
        if (fromScrubber) {
            setTimeout(() => {
                window._scrubberSeeking = false;
            }, 0);
        }
    }

    // Update value displays for all charts at cursor position
    function updateValueDisplays(idx) {
        if (!currentRuns || currentRuns.length === 0 || idx === undefined) {
            // Clear all displays
            ['speedValues', 'throttleValues', 'brakeValues', 'gForceValues'].forEach(id => {
                const elem = document.getElementById(id);
                if (elem) elem.innerHTML = '';
            });
            return;
        }

        // Update speed values
        updateChartValues('speedValues', speedChart, idx, (v) => v !== null && v !== undefined ? v.toFixed(1) : '--');

        // Update throttle values
        updateChartValues('throttleValues', throttleChart, idx, (v) => v !== null && v !== undefined ? v.toFixed(1) : '--');

        // Update brake values
        updateChartValues('brakeValues', brakeChart, idx, (v) => v !== null && v !== undefined ? v.toFixed(1) : '--');

        // Update g-force values (special handling for lateral/longitudinal pairs)
        updateGForceValues(idx);
    }

    // Update values for a specific chart
    function updateChartValues(containerId, chart, idx, formatter) {
        const container = document.getElementById(containerId);
        if (!container || !chart || !chart.data) return;

        let html = '';

        // Reverse runs to match display order (fastest on top)
        const reversedRuns = [...currentRuns].reverse();

        reversedRuns.forEach((run, i) => {
            const dataSeriesIndex = i + 1; // +1 because series[0] is time axis
            const value = chart.data[dataSeriesIndex] ? chart.data[dataSeriesIndex][idx] : null;
            const color = run.isMostRecent ? '#7d5aff' : COLORS[currentRuns.indexOf(run) % COLORS.length];

            if (value !== null && value !== undefined) {
                html += `<span class="chart-value-item" style="color: ${color};">${formatter(value)}</span>`;
            }
        });

        container.innerHTML = html;
    }

    // Update g-force values (lateral and longitudinal pairs)
    function updateGForceValues(idx) {
        const container = document.getElementById('gForceValues');
        if (!container || !gForceChart || !gForceChart.data) return;

        let html = '';

        // Reverse runs to match display order
        const reversedRuns = [...currentRuns].reverse();

        reversedRuns.forEach((run, i) => {
            // Each run has 2 series: lateral (solid) and longitudinal (dashed)
            const lateralIndex = (i * 2) + 1;
            const longitudinalIndex = (i * 2) + 2;

            const lateral = gForceChart.data[lateralIndex] ? gForceChart.data[lateralIndex][idx] : null;
            const longitudinal = gForceChart.data[longitudinalIndex] ? gForceChart.data[longitudinalIndex][idx] : null;
            const color = run.isMostRecent ? '#7d5aff' : COLORS[currentRuns.indexOf(run) % COLORS.length];

            if ((lateral !== null && lateral !== undefined) || (longitudinal !== null && longitudinal !== undefined)) {
                const latStr = lateral !== null && lateral !== undefined ? lateral.toFixed(2) : '--';
                const longStr = longitudinal !== null && longitudinal !== undefined ? longitudinal.toFixed(2) : '--';
                html += `<span class="chart-value-item" style="color: ${color};">${latStr}, ${longStr}</span>`;
            }
        });

        container.innerHTML = html;
    }

    // Find closest index in array
    function findClosestIndex(arr, value) {
        let closest = 0;
        let minDiff = Math.abs(arr[0] - value);

        for (let i = 1; i < arr.length; i++) {
            const diff = Math.abs(arr[i] - value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = i;
            }
        }

        return closest;
    }

    // Resample data array to match a unified timeline
    // This allows all runs to be compared at the same moments in time
    // Shorter runs will have null values after they finish
    function padDataToLength(dataArray, sourceTimestamps, targetTimestamps) {
        const resampledArray = [];
        const maxSourceTime = sourceTimestamps[sourceTimestamps.length - 1];

        for (let i = 0; i < targetTimestamps.length; i++) {
            const targetTime = targetTimestamps[i];

            // If this time is beyond when this run finished, use null
            if (targetTime > maxSourceTime) {
                resampledArray.push(null);
                continue;
            }

            // Find where this time falls in the source timestamps
            let value = dataArray[0]; // Default to first value

            if (targetTime <= sourceTimestamps[0]) {
                // Before or at start
                value = dataArray[0];
            } else if (targetTime >= sourceTimestamps[sourceTimestamps.length - 1]) {
                // At or after end
                value = dataArray[dataArray.length - 1];
            } else {
                // Interpolate between two points
                for (let j = 1; j < sourceTimestamps.length; j++) {
                    if (sourceTimestamps[j] >= targetTime) {
                        // Interpolate between j-1 and j
                        const t0 = sourceTimestamps[j - 1];
                        const t1 = sourceTimestamps[j];
                        const v0 = dataArray[j - 1];
                        const v1 = dataArray[j];
                        const ratio = (targetTime - t0) / (t1 - t0);
                        value = v0 + (v1 - v0) * ratio;
                        break;
                    }
                }
            }

            resampledArray.push(value);
        }

        return resampledArray;
    }

    // Adjust color brightness
    function adjustColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
        const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
        const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // Clear all charts
    function clear() {
        currentRuns = [];

        // Clear value displays
        ['speedValues', 'throttleValues', 'brakeValues', 'gForceValues'].forEach(id => {
            const elem = document.getElementById(id);
            if (elem) elem.innerHTML = '';
        });

        // Destroy and recreate charts to reset series
        if (speedChart) {
            speedChart.destroy();
            speedChart = createSpeedChart();
        }
        if (throttleChart) {
            throttleChart.destroy();
            throttleChart = createThrottleChart();
        }
        if (brakeChart) {
            brakeChart.destroy();
            brakeChart = createBrakeChart();
        }
        if (gForceChart) {
            gForceChart.destroy();
            gForceChart = createGForceChart();
        }
    }

    // Handle window resize
    window.addEventListener('resize', () => {
        const width = document.querySelector('.chart-wrapper')?.offsetWidth - 32 || 400;
        if (speedChart) speedChart.setSize({ width, height: 200 });
        if (throttleChart) throttleChart.setSize({ width, height: 200 });
        if (brakeChart) brakeChart.setSize({ width, height: 200 });
        if (gForceChart) gForceChart.setSize({ width, height: 200 });
    });

    // Public API
    return {
        init,
        loadRun,
        compareRuns,
        seekTo,
        clear
    };
})();

// Export to window
window.AutocrossCharts = AutocrossCharts;

// Initialize charts when page loads
document.addEventListener('DOMContentLoaded', () => {
    AutocrossCharts.init();
});
