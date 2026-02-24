// Autocross Charts - Chart.js Implementation
// Manages charts for speed, throttle, brake, and g-forces

const AutocrossCharts = (() => {
    // State
    let charts = {};
    let currentRuns = [];
    let currentCursorIndex = null;

    // Color configuration
    const COLORS = [
        '#4a9eff', // Blue
        '#ff4a4a', // Red
        '#4aff4a', // Green
        '#ffaa4a', // Orange
        '#ff4aff', // Magenta
        '#4affff'  // Cyan
    ];
    const RECENT_COLOR = '#7d5aff'; // Purple

    // Vertical line plugin for cursor sync (draws behind data lines)
    const verticalLinePlugin = {
        id: 'verticalLine',
        beforeDatasetsDraw: (chart) => {
            if (currentCursorIndex !== null && chart.data.labels.length > 0) {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;

                const xValue = chart.data.labels[currentCursorIndex];
                const x = xAxis.getPixelForValue(xValue);

                // Clip to chart area
                ctx.save();
                ctx.beginPath();
                ctx.rect(xAxis.left, yAxis.top, xAxis.right - xAxis.left, yAxis.bottom - yAxis.top);
                ctx.clip();

                ctx.beginPath();
                ctx.moveTo(x, yAxis.top);
                ctx.lineTo(x, yAxis.bottom);
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#000';
                ctx.stroke();
                ctx.restore();
            }
        },
        afterDatasetsDraw: (chart) => {
            if (currentCursorIndex !== null && chart.data.labels.length > 0) {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;

                const xValue = chart.data.labels[currentCursorIndex];
                const x = xAxis.getPixelForValue(xValue);

                // Clip to chart area and draw dots
                ctx.save();
                ctx.beginPath();
                ctx.rect(xAxis.left, yAxis.top, xAxis.right - xAxis.left, yAxis.bottom - yAxis.top);
                ctx.clip();

                chart.data.datasets.forEach((dataset) => {
                    const value = dataset.data[currentCursorIndex];
                    if (value !== null && value !== undefined) {
                        const y = yAxis.getPixelForValue(value);
                        ctx.beginPath();
                        ctx.arc(x, y, 4, 0, 2 * Math.PI);
                        ctx.fillStyle = dataset.borderColor;
                        ctx.fill();
                    }
                });
                ctx.restore();
            }
        }
    };

    // Chart configuration
    const CHART_CONFIG = {
        speed: {
            canvasId: 'speedChart',
            valueId: 'speedValues',
            yLabel: 'Speed (mph)',
            yRange: { min: 0, max: 100 },
            dynamicMax: true, // Enable dynamic y-axis
            dataKey: 'speed',
            format: v => v?.toFixed(1) || '--'
        },
        throttle: {
            canvasId: 'throttleChart',
            valueId: 'throttleValues',
            yLabel: 'Throttle (%)',
            yRange: { min: -10, max: 100 },
            dataKey: 'accel',
            transform: v => v * 100,
            format: v => v?.toFixed(1) || '--'
        },
        brake: {
            canvasId: 'brakeChart',
            valueId: 'brakeValues',
            yLabel: 'Brake (%)',
            yRange: { min: -10, max: 100 },
            dataKey: 'brake',
            transform: v => v * 100,
            format: v => v?.toFixed(1) || '--'
        },
        gForce: {
            canvasId: 'gForceChart',
            valueId: 'gForceValues',
            yLabel: 'Lateral G',
            yRange: { min: -2, max: 2 },
            dynamicMax: true
        },
        timeDelta: {
            canvasId: 'timeDeltaChart',
            valueId: 'timeDeltaValues',
            yLabel: 'Delta (s)',
            yRange: { min: -1, max: 1 },
            dynamicMax: true
        }
    };

    // Initialize charts
    function init() {
        console.log('Initializing autocross charts (Chart.js)...');

        try {
            Object.keys(CHART_CONFIG).forEach(key => {
                charts[key] = createEmptyChart(key);
            });

            console.log('Charts initialized');
        } catch (error) {
            console.error('Failed to initialize charts:', error);
        }
    }

    // Create an empty chart
    function createEmptyChart(chartType) {
        const config = CHART_CONFIG[chartType];
        const canvas = document.getElementById(config.canvasId);

        if (!canvas) {
            console.error(`Canvas not found: ${config.canvasId}`);
            return null;
        }

        // Set canvas size to the inner content width (excluding parent padding)
        canvas.width = getInnerWidth(canvas.parentElement) || 800;
        canvas.height = 200;

        const chartConfig = {
            type: 'line',
            data: {
                labels: [0],
                datasets: []
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: false,
                clip: 0,
                events: [],
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                    verticalLine: {}
                },
                scales: {
                    x: {
                        display: false,
                        type: 'linear',
                        min: 0,
                        max: 5
                    },
                    y: {
                        display: true,
                        title: {
                            display: true,
                            text: config.yLabel,
                            color: '#888'
                        },
                        grid: {
                            color: '#333'
                        },
                        ...config.yRange
                    }
                },
            }
        };

        try {
            const chart = new Chart(canvas, chartConfig);
            // Register the vertical line plugin
            if (!Chart.registry.plugins.get('verticalLine')) {
                Chart.register(verticalLinePlugin);
            }
            return chart;
        } catch (error) {
            console.error(`Failed to create ${chartType} chart:`, error);
            return null;
        }
    }

    // Load a single run
    function loadRun(run) {
        console.log('Loading run:', run.runId);
        compareRuns([run]);
    }

    // Compare multiple runs
    function compareRuns(runs) {
        console.log('Comparing', runs.length, 'runs');

        currentRuns = runs.slice(0, 6);

        if (!validateRuns(currentRuns)) {
            console.error('Invalid run data');
            clear();
            return;
        }

        try {
            updateAllCharts();
        } catch (error) {
            console.error('Failed to update charts:', error);
            clear();
        }
    }

    // Validate run data
    function validateRuns(runs) {
        if (!runs || runs.length === 0) return false;

        for (const run of runs) {
            if (!run.telemetry?.timestamps?.length) {
                console.error('Missing telemetry timestamps:', run);
                return false;
            }
        }

        return true;
    }

    // Update all charts
    function updateAllCharts() {
        const longestRun = findLongestRun(currentRuns);
        const baseTimestamps = longestRun.telemetry.timestamps;

        updateChart('speed', baseTimestamps);
        updateChart('throttle', baseTimestamps);
        updateChart('brake', baseTimestamps);
        updateGForceChart(baseTimestamps);
        updateTimeDeltaChart(baseTimestamps);

        // Initialize cursor and window at start
        if (currentCursorIndex === null) {
            currentCursorIndex = 0;
        }
        updateChartWindow(baseTimestamps[currentCursorIndex] || 0);

        console.log('All charts updated');
    }

    // Find longest run
    function findLongestRun(runs) {
        return runs.reduce((longest, run) => {
            const longestTime = longest.telemetry.timestamps[longest.telemetry.timestamps.length - 1];
            const currentTime = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            return currentTime > longestTime ? run : longest;
        }, runs[0]);
    }

    // Update a standard chart
    function updateChart(chartType, baseTimestamps) {
        const config = CHART_CONFIG[chartType];
        const chart = charts[chartType];

        if (!chart) return;

        const datasets = [];
        const reversed = [...currentRuns].reverse();
        let maxValue = 0;

        reversed.forEach((run, i) => {
            let runData = run.telemetry[config.dataKey];

            if (config.transform) {
                runData = runData.map(config.transform);
            }

            const interpolated = interpolateData(runData, run.telemetry.timestamps, baseTimestamps);
            const color = run.isMostRecent ? RECENT_COLOR : COLORS[currentRuns.indexOf(run) % COLORS.length];

            // Track max value for dynamic y-axis
            if (config.dynamicMax) {
                const runMax = Math.max(...interpolated.filter(v => v !== null));
                if (runMax > maxValue) maxValue = runMax;
            }

            datasets.push({
                label: `Run ${run.runNumber || i + 1}`,
                data: interpolated,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 1,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1
            });
        });

        // Set dynamic y-axis max (round up to nearest 10)
        if (config.dynamicMax && maxValue > 0) {
            const dynamicMax = Math.ceil(maxValue / 10) * 10;
            chart.options.scales.y.max = dynamicMax;
        } else {
            chart.options.scales.y.max = config.yRange.max;
        }

        chart.data.labels = baseTimestamps;
        chart.data.datasets = datasets;
        chart.update('none');
    }

    // Update G-Force chart
    function updateGForceChart(baseTimestamps) {
        const chart = charts.gForce;
        const config = CHART_CONFIG.gForce;

        if (!chart) return;

        const datasets = [];
        const reversed = [...currentRuns].reverse();
        let maxAbsValue = 0; // Find actual max

        reversed.forEach((run, i) => {
            const color = run.isMostRecent ? RECENT_COLOR : COLORS[currentRuns.indexOf(run) % COLORS.length];

            const lateral = interpolateData(run.telemetry.accelX, run.telemetry.timestamps, baseTimestamps);
            datasets.push({
                label: `Lateral ${run.runNumber || i + 1}`,
                data: lateral,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 1,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1
            });

            if (config.dynamicMax) {
                const lateralMax = Math.max(...lateral.filter(v => v !== null).map(Math.abs));
                if (lateralMax > maxAbsValue) maxAbsValue = lateralMax;
            }
        });

        // Set symmetric dynamic y-axis (use exact max absolute value from data)
        if (config.dynamicMax && maxAbsValue > 0) {
            // Use exact peak from data, perfectly symmetric
            console.log('G-Force max absolute value:', maxAbsValue, 'Setting range:', -maxAbsValue, 'to', maxAbsValue);
            chart.options.scales.y.min = -maxAbsValue;
            chart.options.scales.y.max = maxAbsValue;
        } else {
            // Fallback to default range if no data or dynamic disabled
            console.log('G-Force using default range:', config.yRange.min, 'to', config.yRange.max);
            chart.options.scales.y.min = config.yRange.min;
            chart.options.scales.y.max = config.yRange.max;
        }

        chart.data.labels = baseTimestamps;
        chart.data.datasets = datasets;
        chart.update('none');
    }

    // Update time delta chart
    // The fastest run (by total lap time) is the reference — its delta is 0.
    // For each other run, delta[t] = (time elapsed in ref run at same track position) - (time elapsed in this run at same position)
    // Positive = this run is ahead (faster), negative = behind (slower).
    // We compute this by aligning runs on distance travelled rather than clock time.
    function updateTimeDeltaChart(baseTimestamps) {
        const chart = charts.timeDelta;
        const config = CHART_CONFIG.timeDelta;
        if (!chart || currentRuns.length < 2) {
            if (chart) {
                chart.data.labels = baseTimestamps;
                chart.data.datasets = [];
                chart.update('none');
            }
            return;
        }

        // Reference = fastest run (lowest adjusted lap time)
        const refRun = [...currentRuns].sort((a, b) => {
            return (a.lapTime + (a.cones || 0) * 2) - (b.lapTime + (b.cones || 0) * 2);
        })[0];

        // Build cumulative distance arrays for each run
        function cumulativeDist(run) {
            const { posX, posY } = run.telemetry;
            const dist = [0];
            for (let i = 1; i < posX.length; i++) {
                const dx = posX[i] - posX[i - 1];
                const dy = posY[i] - posY[i - 1];
                dist.push(dist[i - 1] + Math.sqrt(dx * dx + dy * dy));
            }
            return dist;
        }

        // For a given distance, find the time in a run using linear interpolation
        function timeAtDist(dist, cumDist, timestamps) {
            if (dist <= 0) return timestamps[0];
            const maxDist = cumDist[cumDist.length - 1];
            if (dist >= maxDist) return timestamps[timestamps.length - 1];
            for (let i = 1; i < cumDist.length; i++) {
                if (cumDist[i] >= dist) {
                    const t = (dist - cumDist[i - 1]) / (cumDist[i] - cumDist[i - 1]);
                    return timestamps[i - 1] + t * (timestamps[i] - timestamps[i - 1]);
                }
            }
            return timestamps[timestamps.length - 1];
        }

        const refDist = cumulativeDist(refRun);

        const datasets = [];
        const reversed = [...currentRuns].reverse();
        let maxAbsDelta = 0;

        reversed.forEach((run) => {
            if (run === refRun) return; // skip reference run
            const color = run.isMostRecent ? RECENT_COLOR : COLORS[currentRuns.indexOf(run) % COLORS.length];
            const runDist = cumulativeDist(run);

            // For each timestamp in the reference run, compute delta
            const deltas = refRun.telemetry.timestamps.map((refT, i) => {
                const dist = refDist[i];
                const runT = timeAtDist(dist, runDist, run.telemetry.timestamps);
                return runT - refT; // positive = this run is slower (more time), negative = faster
            });

            // Interpolate onto baseTimestamps, holding flat at final delta after run ends
            const runEndTime = run.telemetry.timestamps[run.telemetry.timestamps.length - 1];
            const interpolated = interpolateData(deltas, refRun.telemetry.timestamps, baseTimestamps);
            // Find the last non-null value to use as the flat tail
            let lastVal = null;
            for (let i = interpolated.length - 1; i >= 0; i--) {
                if (interpolated[i] !== null) { lastVal = interpolated[i]; break; }
            }
            interpolated.forEach((v, i) => {
                if (baseTimestamps[i] > runEndTime) interpolated[i] = null;
                else if (v === null && lastVal !== null) interpolated[i] = lastVal;
            });

            const absMax = Math.max(...interpolated.filter(v => v !== null).map(Math.abs));
            if (absMax > maxAbsDelta) maxAbsDelta = absMax;

            datasets.push({
                label: `Delta Run ${run.runNumber}`,
                data: interpolated,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 1,
                pointRadius: 0,
                tension: 0.1
            });
        });

        // Zero line for reference run — stops at ref run's end time
        const refEndTime = refRun.telemetry.timestamps[refRun.telemetry.timestamps.length - 1];
        const refColor = refRun.isMostRecent ? RECENT_COLOR : COLORS[currentRuns.indexOf(refRun) % COLORS.length];
        datasets.push({
            label: `Ref Run ${refRun.runNumber}`,
            data: baseTimestamps.map(t => t <= refEndTime ? 0 : null),
            borderColor: refColor,
            backgroundColor: refColor,
            borderWidth: 1,
            pointRadius: 0,
            tension: 0
        });

        // Symmetric y-axis
        const yMax = Math.ceil((maxAbsDelta || 1) * 10) / 10;
        chart.options.scales.y.min = -yMax;
        chart.options.scales.y.max = yMax;

        chart.data.labels = baseTimestamps;
        chart.data.datasets = datasets;
        chart.update('none');
    }

    // Update time delta value display
    function updateTimeDeltaValueDisplay(idx) {
        const container = document.getElementById('timeDeltaValues');
        const chart = charts.timeDelta;
        if (!container || !chart) return;

        let html = '';
        chart.data.datasets.forEach((dataset) => {
            const value = dataset.data[idx];
            if (value !== null && value !== undefined && value !== 0) {
                const sign = value > 0 ? '+' : '';
                html += `<span class="chart-value-item" style="color: ${dataset.borderColor};">${sign}${value.toFixed(3)}s</span>`;
            }
        });
        container.innerHTML = html;
    }

    // Interpolate data
    function interpolateData(sourceData, sourceTimestamps, targetTimestamps) {
        const result = [];
        const maxSourceTime = sourceTimestamps[sourceTimestamps.length - 1];

        for (let i = 0; i < targetTimestamps.length; i++) {
            const targetTime = targetTimestamps[i];

            if (targetTime > maxSourceTime) {
                result.push(null);
                continue;
            }

            if (targetTime <= sourceTimestamps[0]) {
                result.push(sourceData[0]);
                continue;
            }

            if (targetTime >= maxSourceTime) {
                result.push(sourceData[sourceData.length - 1]);
                continue;
            }

            for (let j = 1; j < sourceTimestamps.length; j++) {
                if (sourceTimestamps[j] >= targetTime) {
                    const t0 = sourceTimestamps[j - 1];
                    const t1 = sourceTimestamps[j];
                    const v0 = sourceData[j - 1];
                    const v1 = sourceData[j];
                    const ratio = (targetTime - t0) / (t1 - t0);
                    result.push(v0 + (v1 - v0) * ratio);
                    break;
                }
            }
        }

        return result;
    }

    // Update 5-second sliding window on all charts
    function updateChartWindow(time) {
        const half = 2.5;
        const runMax = currentRuns.length
            ? findLongestRun(currentRuns).telemetry.timestamps.at(-1)
            : 5;

        // Clamp window to [0, runMax], keeping it exactly 5 seconds wide
        let windowMin = Math.max(0, time - half);
        let windowMax = windowMin + 5;
        if (windowMax > runMax) {
            windowMax = runMax;
            windowMin = Math.max(0, windowMax - 5);
        }

        Object.values(charts).forEach(chart => {
            if (chart) {
                chart.options.scales.x.min = windowMin;
                chart.options.scales.x.max = windowMax;
            }
        });
    }

    // Seek to specific time
    function seekTo(time, fromScrubber = false) {
        if (!currentRuns.length) return;

        const longestRun = findLongestRun(currentRuns);
        const timestamps = longestRun.telemetry.timestamps;
        const idx = findClosestIndex(timestamps, time);

        if (fromScrubber) {
            window._scrubberSeeking = true;
        }

        // Update cursor position
        currentCursorIndex = idx;

        // Update value displays
        updateValueDisplays(idx);

        // Update 5-second window and redraw all charts
        updateChartWindow(time);
        Object.values(charts).forEach(chart => {
            if (chart) {
                chart.update('none');
            }
        });

        if (fromScrubber) {
            setTimeout(() => {
                window._scrubberSeeking = false;
            }, 0);
        }
    }

    // Find closest index
    function findClosestIndex(timestamps, targetTime) {
        let closest = 0;
        let minDiff = Math.abs(timestamps[0] - targetTime);

        for (let i = 1; i < timestamps.length; i++) {
            const diff = Math.abs(timestamps[i] - targetTime);
            if (diff < minDiff) {
                minDiff = diff;
                closest = i;
            }
        }

        return closest;
    }

    // Update value displays
    function updateValueDisplays(idx) {
        if (idx === undefined || !currentRuns.length) {
            clearValueDisplays();
            return;
        }

        ['speed', 'throttle', 'brake'].forEach(type => {
            updateChartValueDisplay(type, idx);
        });

        updateGForceValueDisplay(idx);
        updateTimeDeltaValueDisplay(idx);
    }

    // Update value display for single chart
    function updateChartValueDisplay(chartType, idx) {
        const config = CHART_CONFIG[chartType];
        const container = document.getElementById(config.valueId);
        const chart = charts[chartType];

        if (!container || !chart) return;

        let html = '';
        const reversed = [...currentRuns].reverse();

        reversed.forEach((run, i) => {
            const dataset = chart.data.datasets[i];
            if (!dataset) return;

            const value = dataset.data[idx];
            const color = run.isMostRecent ? RECENT_COLOR : COLORS[currentRuns.indexOf(run) % COLORS.length];

            if (value !== null && value !== undefined) {
                html += `<span class="chart-value-item" style="color: ${color};">${config.format(value)}</span>`;
            }
        });

        container.innerHTML = html;
    }

    // Update g-force value display
    function updateGForceValueDisplay(idx) {
        const container = document.getElementById('gForceValues');
        const chart = charts.gForce;

        if (!container || !chart) return;

        let html = '';
        const reversed = [...currentRuns].reverse();

        reversed.forEach((run, i) => {
            const dataset = chart.data.datasets[i];
            if (!dataset) return;

            const lateral = dataset.data[idx];
            const color = run.isMostRecent ? RECENT_COLOR : COLORS[currentRuns.indexOf(run) % COLORS.length];

            if (lateral !== null && lateral !== undefined) {
                html += `<span class="chart-value-item" style="color: ${color};">${lateral.toFixed(2)}g</span>`;
            }
        });

        container.innerHTML = html;
    }

    // Clear value displays
    function clearValueDisplays() {
        ['speedValues', 'throttleValues', 'brakeValues', 'gForceValues', 'timeDeltaValues'].forEach(id => {
            const elem = document.getElementById(id);
            if (elem) elem.innerHTML = '';
        });
    }

    // Clear all charts
    function clear() {
        console.log('Clearing charts');

        currentRuns = [];
        currentCursorIndex = null;
        clearValueDisplays();

        Object.values(charts).forEach(chart => {
            if (chart) {
                chart.data.labels = [0];
                chart.data.datasets = [];
                chart.update('none');
            }
        });
    }

    // Get inner content width of an element (excludes padding)
    function getInnerWidth(el) {
        const style = getComputedStyle(el);
        return el.offsetWidth
            - parseFloat(style.paddingLeft)
            - parseFloat(style.paddingRight);
    }

    // Handle window resize
    window.addEventListener('resize', () => {
        Object.entries(charts).forEach(([key, chart]) => {
            if (chart) {
                const config = CHART_CONFIG[key];
                const canvas = document.getElementById(config.canvasId);
                if (canvas && canvas.parentElement) {
                    const newWidth = getInnerWidth(canvas.parentElement);
                    canvas.width = newWidth;
                    canvas.height = 200;
                    chart.resize(newWidth, 200);
                }
            }
        });
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

// Export
window.AutocrossCharts = AutocrossCharts;

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    AutocrossCharts.init();
});
