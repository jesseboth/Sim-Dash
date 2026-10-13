// Autocross Charts - Chart.js Implementation
// One chart per enabled channel. Channels are chosen in the Channels dialog.

const AutocrossCharts = (() => {
    // State
    let charts = {};            // channel key -> Chart
    let currentRuns = [];
    let currentCursorIndex = null;
    let currentBase = [];       // x-axis timestamps shared by all charts
    let enabledKeys = [];
    let channelOrder = [];

    const CHART_HEIGHT = 160;
    const STORAGE_KEY = 'autocrossChannelSettings';

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

    // Channel list, in display order.
    // path: telemetry field ('a' or 'a.b'). axis: fixed {min,max} | 'max' | 'symmetric' | 'auto'.
    // stat: average shown in sector analysis, 'avg' or 'avgAbs' (average size, for signed values).
    // smooth: seconds of centred moving average applied to the trace (noisy or coarsely stored channels).
    const WHEELS = [['fl', 'FL'], ['fr', 'FR'], ['rl', 'RL'], ['rr', 'RR']];
    const WHEEL_CHANNELS = [
        { base: 'wheelSpeed', label: 'Wheel speed', unit: 'mph', decimals: 1, stat: 'avg' },
        { base: 'slipAngle', label: 'Slip angle', unit: '°', decimals: 2, stat: 'avgAbs' },
        { base: 'slipRatio', label: 'Slip ratio', unit: '', decimals: 3, stat: 'avgAbs' },
        { base: 'load', label: 'Load', unit: 'kg', decimals: 0, stat: 'avg' },
        { base: 'suspTravel', label: 'Suspension', unit: 'mm', decimals: 1, stat: 'avg' }
    ];

    const CHANNELS = [
        { key: 'timeDelta', group: 'Driver', label: 'Time Delta', unit: 's', delta: true, axis: 'symmetric', decimals: 3 },
        { key: 'speed', group: 'Driver', label: 'Speed', unit: 'mph', path: 'speed', axis: 'max', decimals: 1 },
        { key: 'throttle', group: 'Driver', label: 'Throttle', unit: '%', path: 'accel', scale: 100, axis: { min: -10, max: 100 }, decimals: 0, stat: 'avg' },
        { key: 'brake', group: 'Driver', label: 'Brake', unit: '%', path: 'brake', scale: 100, axis: { min: -10, max: 100 }, decimals: 0, stat: 'avg' },
        { key: 'steer', group: 'Driver', label: 'Steering', unit: '', path: 'steer', axis: 'symmetric', decimals: 2, stat: 'avgAbs' },
        { key: 'clutch', group: 'Driver', label: 'Clutch', unit: '%', path: 'clutch', scale: 100, axis: { min: -10, max: 100 }, decimals: 0, stat: 'avg' },
        { key: 'gear', group: 'Driver', label: 'Gear', unit: '', path: 'gear', axis: 'auto', stepped: true, decimals: 0 },
        { key: 'rpm', group: 'Driver', label: 'RPM', unit: '', path: 'rpm', axis: 'max', decimals: 0, stat: 'avg' },
        { key: 'latG', group: 'Car', label: 'Lateral G', unit: 'g', path: 'accelX', axis: 'symmetric', decimals: 2, stat: 'avgAbs', smooth: 0.15 },
        { key: 'longG', group: 'Car', label: 'Longitudinal G', unit: 'g', path: 'accelY', axis: 'symmetric', decimals: 2, smooth: 0.15 },
        { key: 'yawRate', group: 'Car', label: 'Yaw rate', unit: '°/s', path: 'yawRate', axis: 'symmetric', decimals: 1, stat: 'avgAbs' },
        { key: 'bodySlip', group: 'Car', label: 'Body slip', unit: '°', path: 'bodySlip', axis: 'symmetric', decimals: 1, stat: 'avgAbs' },
        ...WHEEL_CHANNELS.flatMap(w => WHEELS.map(([wheel, name]) => ({
            key: `${w.base}.${wheel}`, group: 'Tyres',
            label: `${w.label} ${name}`, unit: w.unit, path: `${w.base}.${wheel}`, axis: 'auto', decimals: w.decimals, stat: w.stat
        })))
    ];
    const DEFAULT_KEYS = ['timeDelta', 'speed', 'throttle', 'brake', 'steer', 'latG'];
    const channelByKey = new Map(CHANNELS.map(c => [c.key, c]));

    // Vertical line plugin for cursor sync (draws behind data lines)
    const verticalLinePlugin = {
        id: 'verticalLine',
        beforeDatasetsDraw: (chart) => {
            if (currentCursorIndex !== null && chart.data.labels.length > 0) {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;

                const x = (xAxis.left + xAxis.right) / 2;

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

                const x = (xAxis.left + xAxis.right) / 2;

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

    // Sector gate lines at the times the scrubber's run crosses each gate
    const sectorLinesPlugin = {
        id: 'sectorLines',
        beforeDatasetsDraw: (chart) => {
            if (!window.AutocrossSectors || !currentRuns.length) return;
            const run = (window.AutocrossAlign && AutocrossAlign.getReference()) || currentRuns[0];
            const times = AutocrossSectors.getSectorTimesForRun(run);
            if (!times.length) return;

            const { ctx, scales: { x: xAxis, y: yAxis } } = chart;
            ctx.save();
            ctx.beginPath();
            ctx.rect(xAxis.left, yAxis.top, xAxis.right - xAxis.left, yAxis.bottom - yAxis.top);
            ctx.clip();
            ctx.strokeStyle = '#ffffff';
            ctx.fillStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 2]);
            ctx.font = 'bold 9px Arial';
            // Labels at the bottom, clear of the chart title at the top
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            times.forEach((t, i) => {
                if (t === null || t === undefined || t < xAxis.min || t > xAxis.max) return;
                const x = xAxis.getPixelForValue(t);
                ctx.beginPath();
                ctx.moveTo(x, yAxis.top);
                ctx.lineTo(x, yAxis.bottom);
                ctx.stroke();
                ctx.fillText(`S${i + 1}`, x + 3, yAxis.bottom - 2);
            });
            ctx.restore();
        }
    };

    // Keeps the chart title at the top left of the plot, just after the y axis labels
    const titlePositionPlugin = {
        id: 'titlePosition',
        afterLayout: (chart) => {
            const title = chart.canvas.parentElement?.querySelector('h3');
            if (title) title.style.left = `${chart.canvas.offsetLeft + chart.chartArea.left + 6}px`;
        }
    };

    function init() {
        if (typeof Chart === 'undefined') {
            const container = document.getElementById('chartsContainer');
            if (container) container.innerHTML = '<p class="charts-empty">Charts could not load (Chart.js did not download). Reload the page.</p>';
            return;
        }
        if (!Chart.registry.plugins.get('verticalLine')) {
            Chart.register(verticalLinePlugin);
        }
        if (!Chart.registry.plugins.get('sectorLines')) {
            Chart.register(sectorLinesPlugin);
        }
        if (!Chart.registry.plugins.get('titlePosition')) {
            Chart.register(titlePositionPlugin);
        }
        loadChannelSettings();
        buildCharts();
        initChannelsDialog();
        if (window.KineticScroll) {
            KineticScroll.attach(document.getElementById('chartsContainer'));
            KineticScroll.attach(document.querySelector('.channels-modal-content'), { ignore: '.channel-handle' });
        }
    }

    // ---- Channel selection ----

    // Saved as { order: [all keys], enabled: [keys] }
    function loadChannelSettings() {
        const allKeys = CHANNELS.map(c => c.key);
        let order = allKeys, enabled = DEFAULT_KEYS;
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (Array.isArray(saved?.order)) {
                order = saved.order.filter(k => channelByKey.has(k));
                // Channels added since the order was saved go after their neighbour in the default order
                allKeys.forEach((k, i) => {
                    if (order.includes(k)) return;
                    const after = order.indexOf(allKeys[i - 1]);
                    order.splice(after + 1, 0, k);
                });
            }
            if (Array.isArray(saved?.enabled)) {
                enabled = saved.enabled.filter(k => channelByKey.has(k));
            }
        } catch (e) { /* storage unavailable */ }
        channelOrder = order;
        enabledKeys = [...enabled];
    }

    function saveChannelSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: channelOrder, enabled: enabledKeys }));
        } catch (e) { /* storage unavailable */ }
        buildCharts();
        if (currentRuns.length) updateAllCharts();
    }

    // Enabled channels in the chosen order
    function shownKeys() {
        return channelOrder.filter(k => enabledKeys.includes(k));
    }

    // The dialog edits a draft. Done applies it, Cancel throws it away.
    let draft = null; // { order, enabled }

    function initChannelsDialog() {
        document.getElementById('channelsBtn')?.addEventListener('click', openChannelsDialog);
        document.getElementById('channelsDoneBtn')?.addEventListener('click', () => {
            channelOrder = draft.order;
            enabledKeys = draft.enabled;
            closeChannelsDialog();
            saveChannelSettings();
        });
        document.getElementById('channelsCancelBtn')?.addEventListener('click', closeChannelsDialog);
        document.getElementById('channelsModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'channelsModal') closeChannelsDialog();
        });

        const list = document.getElementById('channelsList');
        list?.addEventListener('change', (e) => {
            const key = e.target.dataset.channel;
            if (!key) return;
            draft.enabled = e.target.checked ? [...draft.enabled, key] : draft.enabled.filter(k => k !== key);
        });
        list?.addEventListener('pointerdown', startRowDrag);

        // Ctrl or Cmd + click, or a long press, selects rows to move together
        let longPressed = false;
        list?.addEventListener('click', (e) => {
            const row = e.target.closest('.channel-row');
            if (!row || e.target.closest('.channel-handle')) return;
            if (longPressed) {
                longPressed = false;
                e.preventDefault();
            } else if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                row.classList.toggle('selected');
            }
        });
        list?.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.channel-row');
            if (!row || e.target.closest('.channel-handle')) return;
            longPressed = false;
            const timer = setTimeout(() => {
                longPressed = true;
                row.classList.toggle('selected');
                navigator.vibrate?.(20);
            }, 500);
            const cancel = (ev) => {
                if (ev.pointerId !== e.pointerId) return;
                if (ev.type === 'pointermove' && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 10) return;
                clearTimeout(timer);
                window.removeEventListener('pointermove', cancel);
                window.removeEventListener('pointerup', cancel);
                window.removeEventListener('pointercancel', cancel);
            };
            window.addEventListener('pointermove', cancel);
            window.addEventListener('pointerup', cancel);
            window.addEventListener('pointercancel', cancel);
        });
        list?.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.channel-row')) e.preventDefault();
        });

        document.getElementById('channelsDefaultBtn')?.addEventListener('click', () => {
            draft = { order: CHANNELS.map(c => c.key), enabled: [...DEFAULT_KEYS] };
            renderChannelsList();
        });
    }

    // Drag a row by its handle to move it, with any selected rows. Works with touch and mouse.
    function startRowDrag(e) {
        const handle = e.target.closest('.channel-handle');
        if (!handle) return;
        e.preventDefault();

        const list = document.getElementById('channelsList');
        const row = handle.closest('.channel-row');

        // Dragging a selected row moves all selected rows as one block, in list order
        const block = row.classList.contains('selected')
            ? [...list.querySelectorAll('.channel-row.selected')]
            : [row];
        const at = block.indexOf(row);
        block.slice(0, at).forEach(r => list.insertBefore(r, row));
        block.slice(at + 1).reverse().forEach(r => list.insertBefore(r, row.nextElementSibling));
        block.forEach(r => r.classList.add('dragging'));

        // Listen on the window: moving the row in the list ends pointer capture on the handle
        const onMove = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            ev.preventDefault();
            // Swap with a neighbour as soon as the pointer crosses the row's edge
            const first = block[0], last = block[block.length - 1];
            for (let i = 0; i < 50; i++) {
                const rect = row.getBoundingClientRect();
                if (ev.clientY < rect.top && first.previousElementSibling) {
                    list.insertBefore(first.previousElementSibling, last.nextElementSibling);
                } else if (ev.clientY > rect.bottom && last.nextElementSibling) {
                    list.insertBefore(last.nextElementSibling, first);
                } else {
                    break;
                }
            }

            // Scroll the dialog when dragging near its top or bottom edge
            const scroller = list.closest('.channels-modal-content');
            const box = scroller.getBoundingClientRect();
            if (ev.clientY < box.top + 40) scroller.scrollTop -= 10;
            else if (ev.clientY > box.bottom - 40) scroller.scrollTop += 10;
        };
        const onEnd = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
            block.forEach(r => r.classList.remove('dragging'));

            draft.order = [...list.querySelectorAll('.channel-row')].map(r => r.dataset.channel);
        };
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
    }

    function openChannelsDialog() {
        draft = { order: [...channelOrder], enabled: [...enabledKeys] };
        renderChannelsList();
        document.getElementById('channelsModal')?.classList.remove('hidden');
    }

    function closeChannelsDialog() {
        document.getElementById('channelsModal')?.classList.add('hidden');
    }

    // One row per channel. Channels the selected runs do not have are marked.
    function renderChannelsList() {
        const list = document.getElementById('channelsList');
        if (!list) return;

        list.innerHTML = draft.order.map(key => {
            const c = channelByKey.get(key);
            const missing = currentRuns.length && !c.delta && !currentRuns.some(r => getChannelData(r, c.path));
            return `<div class="channel-row${missing ? ' channel-missing' : ''}" data-channel="${key}">
                <label class="channel-check">
                    <input type="checkbox" data-channel="${key}" ${draft.enabled.includes(key) ? 'checked' : ''}>
                    <span class="channel-name">${c.label}${c.unit ? ` (${c.unit})` : ''}</span>
                    ${missing ? '<span class="channel-note">not in selected runs</span>' : ''}
                </label>
                <span class="channel-handle" title="Drag to reorder" aria-label="Drag to reorder">⠿</span>
            </div>`;
        }).join('');
    }

    // ---- Chart creation ----

    function buildCharts() {
        const container = document.getElementById('chartsContainer');
        if (!container) return;

        Object.values(charts).forEach(chart => chart.destroy());
        charts = {};
        container.innerHTML = '';

        if (!shownKeys().length) {
            container.innerHTML = '<p class="charts-empty">No channels selected. Press ☰ to add charts.</p>';
            return;
        }

        shownKeys().forEach(key => {
            const channel = channelByKey.get(key);
            const wrapper = document.createElement('div');
            wrapper.className = 'chart-wrapper';
            wrapper.dataset.channel = key;
            wrapper.innerHTML = `
                <h3>${channel.label}${channel.unit ? ` (${channel.unit})` : ''}</h3>
                <canvas class="chart"></canvas>
                <div class="chart-missing hidden">Not recorded in the selected runs</div>
                <div class="chart-values"></div>`;
            container.appendChild(wrapper);
            charts[key] = createEmptyChart(channel, wrapper.querySelector('canvas'));
            wrapper.querySelector('canvas').addEventListener('pointerdown', (e) => startChartScrub(e, charts[key]));
        });
    }

    // ---- Scrub by dragging on a chart ----
    // The cursor stays in the centre and dragging moves the traces under it.
    // On touch, scrubbing starts after a sideways move; a vertical swipe scrolls the list.
    const SCRUB_DECELERATION = 0.998;  // glide velocity kept per millisecond
    const SCRUB_MIN_VELOCITY = 0.0002; // s/ms; the glide stops below this
    let scrubFrame = null;             // pending redraw, at most one per frame
    let scrubPendingTime = null;
    let scrubGlide = null;

    // Seek on the next animation frame, to the latest requested time
    function requestScrub(time) {
        scrubPendingTime = time;
        if (scrubFrame) return;
        scrubFrame = requestAnimationFrame(() => {
            scrubFrame = null;
            if (window.AutocrossScrubber) AutocrossScrubber.seekTo(scrubPendingTime);
            else seekTo(scrubPendingTime);
        });
    }

    function stopScrubGlide() {
        if (scrubGlide) cancelAnimationFrame(scrubGlide);
        scrubGlide = null;
    }

    // After a touch flick, time keeps moving and slows down gradually
    function startScrubGlide(velocity) {
        let last = performance.now();
        let time = AutocrossScrubber.getCurrentTime();
        const step = (now) => {
            // Something else moved the time (scrubber, playback): stop
            if (Math.abs(AutocrossScrubber.getCurrentTime() - time) > 1e-6) { scrubGlide = null; return; }
            const dt = now - last;
            last = now;
            velocity *= Math.pow(SCRUB_DECELERATION, dt);
            AutocrossScrubber.seekTo(time + velocity * dt);
            const reached = AutocrossScrubber.getCurrentTime();
            // Stop when slow or at the start or end of the timeline
            if (Math.abs(velocity) < SCRUB_MIN_VELOCITY || Math.abs(reached - time) < 1e-9) { scrubGlide = null; return; }
            time = reached;
            scrubGlide = requestAnimationFrame(step);
        };
        scrubGlide = requestAnimationFrame(step);
    }

    function startChartScrub(e, chart) {
        if (!currentRuns.length || e.button !== 0) return;
        // A tap during a glide only stops it
        stopScrubGlide();
        const canvas = chart.canvas;
        const isTouch = e.pointerType === 'touch';
        // Touch is captured only once a sideways drag starts, so a vertical swipe scrolls the list
        if (!isTouch) {
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        }

        const startX = e.clientX, startY = e.clientY;
        const startTime = window.AutocrossScrubber ? AutocrossScrubber.getCurrentTime() : 0;
        // Seconds per screen pixel along the x axis
        const xAxis = chart.scales.x;
        const secPerPx = (xAxis.max - xAxis.min) / ((xAxis.right - xAxis.left) * canvas.getBoundingClientRect().width / chart.width);
        let started = !isTouch;
        const samples = []; // recent pointer positions, for the release velocity

        const onMove = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            const dx = ev.clientX - startX;
            if (!started && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(ev.clientY - startY)) {
                started = true;
                canvas.setPointerCapture(ev.pointerId);
            }
            if (!started) return;
            samples.push({ t: ev.timeStamp, x: ev.clientX });
            while (samples.length > 2 && ev.timeStamp - samples[0].t > 100) samples.shift();
            requestScrub(startTime - dx * secPerPx);
        };
        const onEnd = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerup', onEnd);
            canvas.removeEventListener('pointercancel', onEnd);

            const last = samples[samples.length - 1];
            if (!isTouch || !started || ev.type !== 'pointerup' || samples.length < 2 || !window.AutocrossScrubber) return;
            if (ev.timeStamp - last.t > 80) return; // finger stopped before lifting
            const dt = last.t - samples[0].t;
            const velocity = dt > 0 ? -(last.x - samples[0].x) / dt * secPerPx : 0;
            if (Math.abs(velocity) > SCRUB_MIN_VELOCITY) {
                // Let the last drag position land first
                requestAnimationFrame(() => startScrubGlide(velocity));
            }
        };
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onEnd);
        canvas.addEventListener('pointercancel', onEnd);
    }

    function createEmptyChart(channel, canvas) {
        canvas.width = getInnerWidth(canvas.parentElement) || 800;
        canvas.height = CHART_HEIGHT;

        const yRange = typeof channel.axis === 'object' ? channel.axis : {};
        return new Chart(canvas, {
            type: 'line',
            data: { labels: [0], datasets: [] },
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
                    x: { display: false, type: 'linear', min: 0, max: 5 },
                    y: {
                        display: true,
                        title: { display: false },
                        grid: { color: '#333' },
                        ticks: channel.stepped ? { stepSize: 1 } : {},
                        ...yRange
                    }
                }
            }
        });
    }

    // ---- Data ----

    function getChannelData(run, path) {
        if (!path) return null;
        let data = run.telemetry;
        for (const part of path.split('.')) {
            data = data?.[part];
        }
        return Array.isArray(data) && data.length ? data : null;
    }

    function runColor(run) {
        return run.color || (run.isMostRecent ? RECENT_COLOR : COLORS[currentRuns.indexOf(run) % COLORS.length]);
    }

    // Load a single run
    function loadRun(run) {
        compareRuns([run]);
    }

    // Compare multiple runs
    function compareRuns(runs, { keepTime = false } = {}) {
        currentRuns = runs.slice(0, 6);
        if (!keepTime) currentCursorIndex = null;

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

    function validateRuns(runs) {
        if (!runs || runs.length === 0) return false;
        return runs.every(run => run.telemetry?.timestamps?.length);
    }

    function updateAllCharts() {
        // Align mode: x-axis is the reference run's time. Time mode: from the earliest launch to the last finish.
        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        currentBase = alignRef ? alignModeBase(alignRef) : timeModeBase(currentRuns);

        Object.keys(charts).forEach(key => {
            const channel = channelByKey.get(key);
            if (channel.delta) updateTimeDeltaChart(currentBase);
            else updateChannelChart(channel, currentBase);
        });

        if (currentCursorIndex === null) currentCursorIndex = 0;
        updateChartWindow(currentBase[currentCursorIndex] || 0);
        updateValueDisplays(currentCursorIndex);
        Object.values(charts).forEach(chart => chart.update('none'));
    }

    // The reference run's timestamps, extended at 50 Hz to cover every shifted run
    function alignModeBase(ref) {
        const ts = ref.telemetry.timestamps;
        const { start, end } = AutocrossAlign.timeRange();
        const before = [], after = [];
        for (let t = ts[0] - 0.02; t >= start; t -= 0.02) before.unshift(t);
        for (let t = ts[ts.length - 1] + 0.02; t <= end; t += 0.02) after.push(t);
        return before.concat(ts, after);
    }

    // The longest run's timestamps, with the earliest launch added before them
    function timeModeBase(runs) {
        const longest = findLongestRun(runs).telemetry.timestamps;
        const earliest = runs.reduce((a, r) => r.telemetry.timestamps[0] < a.telemetry.timestamps[0] ? r : a, runs[0]);
        const launch = earliest.telemetry.timestamps.filter(t => t < longest[0]);
        return launch.length ? launch.concat(longest) : longest;
    }

    function findLongestRun(runs) {
        return runs.reduce((longest, run) =>
            run.telemetry.timestamps.at(-1) > longest.telemetry.timestamps.at(-1) ? run : longest, runs[0]);
    }

    function datasetFor(run, data, channel) {
        const color = runColor(run);
        return {
            label: `Run ${run.runNumber}`,
            data,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 1,
            pointRadius: 0,
            tension: channel.stepped ? 0 : 0.1,
            stepped: channel.stepped ? 'before' : false
        };
    }

    function updateChannelChart(channel, baseTimestamps) {
        const chart = charts[channel.key];
        if (!chart) return;

        const datasets = [];
        [...currentRuns].reverse().forEach(run => {
            let values = getChannelData(run, channel.path);
            if (!values) return;
            if (channel.smooth) values = smoothed(run, channel, values);
            if (channel.scale) values = values.map(v => v * channel.scale);
            datasets.push(datasetFor(run, sampleRun(run, values, baseTimestamps, channel.stepped), channel));
        });

        setYAxis(chart, channel, datasets);
        setMissing(channel.key, datasets.length === 0);

        chart.data.labels = baseTimestamps;
        chart.data.datasets = datasets;
        chart.update('none');
    }

    // Centred moving average over channel.smooth seconds, cached per run and channel
    const smoothCache = new WeakMap();
    function smoothed(run, channel, values) {
        let byKey = smoothCache.get(run);
        if (!byKey) smoothCache.set(run, byKey = new Map());
        if (byKey.has(channel.key)) return byKey.get(channel.key);

        const ts = run.telemetry.timestamps;
        const half = channel.smooth / 2;
        const out = new Array(values.length);
        let lo = 0, hi = 0, sum = 0;
        for (let i = 0; i < values.length; i++) {
            while (hi < values.length && ts[hi] <= ts[i] + half) sum += values[hi++];
            while (ts[lo] < ts[i] - half) sum -= values[lo++];
            out[i] = sum / (hi - lo);
        }
        byKey.set(channel.key, out);
        return out;
    }

    function setYAxis(chart, channel, datasets) {
        const y = chart.options.scales.y;
        if (typeof channel.axis === 'object') {
            y.min = channel.axis.min;
            y.max = channel.axis.max;
            return;
        }

        let min = Infinity, max = -Infinity;
        datasets.forEach(ds => ds.data.forEach(v => {
            if (v === null) return;
            if (v < min) min = v;
            if (v > max) max = v;
        }));
        if (min === Infinity) { y.min = undefined; y.max = undefined; return; }

        if (channel.axis === 'max') {
            y.min = 0;
            y.max = niceCeil(max);
        } else if (channel.axis === 'symmetric') {
            const m = Math.max(Math.abs(min), Math.abs(max)) || 1;
            y.min = -m;
            y.max = m;
        } else {
            const pad = channel.stepped ? 0.5 : (max - min) * 0.05 || 1;
            y.min = min - pad;
            y.max = max + pad;
        }
    }

    // Round up to 1, 2 or 5 times a power of ten
    function niceCeil(v) {
        if (v <= 0) return 1;
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        for (const m of [1, 2, 5, 10]) {
            if (v <= m * p) return m * p;
        }
        return 10 * p;
    }

    function setMissing(key, missing) {
        const wrapper = document.querySelector(`.chart-wrapper[data-channel="${key}"]`);
        wrapper?.querySelector('.chart-missing')?.classList.toggle('hidden', !missing);
    }

    // Time delta chart
    // The reference is the aligned run in align mode, else the fastest run (by adjusted lap time). Its delta is 0.
    // For each other run, delta = (time this run reached a point on the reference path) - (time the reference reached it).
    // Positive = this run is behind (slower), negative = ahead (faster).
    // Each run is aligned by projecting its positions onto the reference path, so a different line
    // through a corner does not show as time gained or lost.
    function updateTimeDeltaChart(baseTimestamps) {
        const chart = charts.timeDelta;
        const channel = channelByKey.get('timeDelta');
        if (!chart) return;
        if (currentRuns.length < 2) {
            chart.data.labels = baseTimestamps;
            chart.data.datasets = [];
            chart.update('none');
            return;
        }

        const alignRef = window.AutocrossAlign && AutocrossAlign.getReference();
        const refRun = alignRef || sortByAdjustedTime(currentRuns)[0];
        const refDist = AutocrossTrack.cumulativeDistance(refRun.telemetry.posX, refRun.telemetry.posY);

        const datasets = [];
        let maxAbsDelta = 0;

        [...currentRuns].reverse().forEach(run => {
            if (run === refRun) return;
            const runProgress = AutocrossTrack.progressAlongPath(refRun.telemetry, refDist, run.telemetry);

            // Align mode: time gained or lost since the anchor, so 0 where the runs line up
            const offset = alignRef ? AutocrossAlign.offsetOf(run) : 0;
            const deltas = refRun.telemetry.timestamps.map((refT, i) => {
                const runT = AutocrossTrack.timeAtProgress(refDist[i], runProgress, run.telemetry.timestamps);
                return runT === null ? null : runT - refT - offset;
            });

            // Hold the last known delta where this run did not reach the reference position
            let lastDelta = 0;
            for (let i = 0; i < deltas.length; i++) {
                if (deltas[i] === null) deltas[i] = lastDelta;
                else lastDelta = deltas[i];
            }

            // Interpolate onto baseTimestamps, holding flat at the final delta until this run ends
            // The run's own times on the x axis (shifted in align mode)
            const runEndTime = run.telemetry.timestamps.at(-1) - offset;
            const interpolated = interpolateData(deltas, refRun.telemetry.timestamps, baseTimestamps);
            let lastVal = null;
            for (let i = interpolated.length - 1; i >= 0; i--) {
                if (interpolated[i] !== null) { lastVal = interpolated[i]; break; }
            }
            const runStartTime = Math.max(0, run.telemetry.timestamps[0]) - offset;
            interpolated.forEach((v, i) => {
                // Deltas are measured from the start line (time 0)
                if (baseTimestamps[i] > runEndTime || baseTimestamps[i] < runStartTime) interpolated[i] = null;
                else if (v === null && lastVal !== null && baseTimestamps[i] > refRun.telemetry.timestamps.at(-1)) interpolated[i] = lastVal;
            });

            const absMax = Math.max(...interpolated.filter(v => v !== null).map(Math.abs));
            if (absMax > maxAbsDelta) maxAbsDelta = absMax;

            datasets.push(datasetFor(run, interpolated, channel));
        });

        // Zero line for the reference run, from the start line until it ends
        const refStartTime = Math.max(0, refRun.telemetry.timestamps[0]);
        const refEndTime = refRun.telemetry.timestamps.at(-1);
        const ref = datasetFor(refRun, baseTimestamps.map(t => t >= refStartTime && t <= refEndTime ? 0 : null), channel);
        ref.isReference = true;
        datasets.push(ref);

        const yMax = Math.ceil((maxAbsDelta || 1) * 10) / 10;
        chart.options.scales.y.min = -yMax;
        chart.options.scales.y.max = yMax;

        chart.data.labels = baseTimestamps;
        chart.data.datasets = datasets;
        chart.update('none');
    }

    // Values of a run at each base timestamp.
    // Time mode: same clock time, null after the run ends.
    // Align mode: the time this run reached the reference run's position.
    function sampleRun(run, values, baseTimestamps, stepped = false) {
        const timestamps = run.telemetry.timestamps;
        const alignActive = window.AutocrossAlign && AutocrossAlign.isActive();
        const runStart = timestamps[0];
        const runEnd = timestamps.at(-1);
        const valueAt = stepped
            ? t => values[findPreviousIndex(timestamps, t)]
            : t => AutocrossTrack.interpolate(timestamps, values, t);

        return baseTimestamps.map(t => {
            if (alignActive) {
                // The run's own time; nothing outside the run
                const rt = t + AutocrossAlign.offsetOf(run);
                return rt < runStart || rt > runEnd ? null : valueAt(rt);
            }
            return t < runStart || t > runEnd ? null : valueAt(t);
        });
    }

    // Interpolate data onto target timestamps, null outside the source times
    function interpolateData(sourceData, sourceTimestamps, targetTimestamps) {
        const minSourceTime = sourceTimestamps[0];
        const maxSourceTime = sourceTimestamps.at(-1);
        return targetTimestamps.map(t => t < minSourceTime || t > maxSourceTime
            ? null : AutocrossTrack.interpolate(sourceTimestamps, sourceData, t));
    }

    // 5-second window centred on the cursor. Before the start and after the end it shows empty space.
    function updateChartWindow(time) {
        Object.values(charts).forEach(chart => {
            chart.options.scales.x.min = time - 2.5;
            chart.options.scales.x.max = time + 2.5;
        });
    }

    // Seek to specific time
    function seekTo(time, fromScrubber = false) {
        if (!currentRuns.length) return;

        if (fromScrubber) window._scrubberSeeking = true;

        currentCursorIndex = findClosestIndex(currentBase, time);
        updateValueDisplays(currentCursorIndex);
        updateChartWindow(time);
        Object.values(charts).forEach(chart => chart.update('none'));

        if (fromScrubber) {
            setTimeout(() => { window._scrubberSeeking = false; }, 0);
        }
    }

    function findClosestIndex(timestamps, targetTime) {
        let lo = 0, hi = timestamps.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (timestamps[mid] < targetTime) lo = mid + 1; else hi = mid;
        }
        if (lo > 0 && Math.abs(timestamps[lo - 1] - targetTime) < Math.abs(timestamps[lo] - targetTime)) {
            return lo - 1;
        }
        return lo;
    }

    // Last index at or before targetTime
    function findPreviousIndex(timestamps, targetTime) {
        let lo = 0, hi = timestamps.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (timestamps[mid] <= targetTime) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

    // Values under the cursor, one per run, in the run's color
    function updateValueDisplays(idx) {
        Object.entries(charts).forEach(([key, chart]) => {
            const channel = channelByKey.get(key);
            const container = document.querySelector(`.chart-wrapper[data-channel="${key}"] .chart-values`);
            if (!container) return;
            if (idx === null || idx === undefined) { container.innerHTML = ''; return; }

            container.innerHTML = chart.data.datasets.map(ds => {
                const v = ds.data[idx];
                if (v === null || v === undefined || ds.isReference) return '';
                const sign = channel.delta && v > 0 ? '+' : '';
                return `<span class="chart-value-item" style="color: ${ds.borderColor};">${sign}${v.toFixed(channel.decimals)}${channel.unit}</span>`;
            }).join('');
        });
    }

    // Clear all charts
    function clear() {
        currentRuns = [];
        currentCursorIndex = null;
        currentBase = [];

        Object.entries(charts).forEach(([key, chart]) => {
            chart.data.labels = [0];
            chart.data.datasets = [];
            chart.update('none');
            setMissing(key, false);
        });
        updateValueDisplays(null);
    }

    // Get inner content width of an element (excludes padding)
    function getInnerWidth(el) {
        const style = getComputedStyle(el);
        return el.offsetWidth
            - parseFloat(style.paddingLeft)
            - parseFloat(style.paddingRight);
    }

    window.addEventListener('resize', () => {
        Object.values(charts).forEach(chart => {
            const width = getInnerWidth(chart.canvas.parentElement);
            if (width > 0) chart.resize(width, CHART_HEIGHT);
        });
    });

    // Public API
    return {
        init,
        loadRun,
        compareRuns,
        seekTo,
        clear,
        // Shown channels that have a sector average, in display order
        getStatChannels: () => shownKeys().map(k => channelByKey.get(k)).filter(c => c.stat),
        getChannelData,
        render: () => Object.values(charts).forEach(chart => chart.update('none'))
    };
})();

// Export
window.AutocrossCharts = AutocrossCharts;

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    AutocrossCharts.init();
});
