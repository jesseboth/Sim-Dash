// Autocross Kinetic Scroll - touch scrolling with a long, gradual glide after the finger lifts.
// Only touch is handled here; mouse wheel and trackpad scrolling stay native.

const KineticScroll = (function () {
    const DECELERATION = 0.998;   // velocity kept per millisecond of glide
    const MIN_VELOCITY = 0.02;    // px/ms; the glide stops below this
    const SLOP = 8;               // px moved before a touch counts as a drag
    const VELOCITY_WINDOW = 100;  // ms of recent movement used for the release velocity

    // ignore: selector for elements that handle their own touch drags
    function attach(el, { ignore } = {}) {
        if (!el) return;
        el.classList.add('kinetic-scroll');

        let drag = null;
        let glide = null;
        let suppressClick = false;

        function stopGlide() {
            if (glide) cancelAnimationFrame(glide);
            glide = null;
        }

        function startGlide(velocity) {
            let last = performance.now();
            const step = (now) => {
                const dt = now - last;
                last = now;
                velocity *= Math.pow(DECELERATION, dt);
                const before = el.scrollTop;
                el.scrollTop += velocity * dt;
                // Stop when slow or at either end of the list
                if (Math.abs(velocity) < MIN_VELOCITY || el.scrollTop === before) {
                    glide = null;
                    return;
                }
                glide = requestAnimationFrame(step);
            };
            glide = requestAnimationFrame(step);
        }

        el.addEventListener('pointerdown', (e) => {
            // A tap during a glide only stops it
            suppressClick = e.pointerType === 'touch' && Boolean(glide);
            if (e.pointerType !== 'touch') return;
            stopGlide();
            if (ignore && e.target.closest(ignore)) return;
            drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, top0: el.scrollTop, axis: null, samples: [] };
        });

        window.addEventListener('pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = e.clientX - drag.x0;
            const dy = e.clientY - drag.y0;
            if (!drag.axis && Math.hypot(dx, dy) > SLOP) {
                drag.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
            }
            if (drag.axis !== 'y') return;

            el.scrollTop = drag.top0 - dy;
            drag.samples.push({ t: e.timeStamp, y: e.clientY });
            while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > VELOCITY_WINDOW) drag.samples.shift();
        });

        const end = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            if (drag.axis === 'y') {
                suppressClick = true;
                const s = drag.samples;
                if (e.type === 'pointerup' && s.length > 1) {
                    const dt = s[s.length - 1].t - s[0].t;
                    // Release velocity in scroll direction (px/ms)
                    const velocity = dt > 0 ? -(s[s.length - 1].y - s[0].y) / dt : 0;
                    if (Math.abs(velocity) > MIN_VELOCITY && e.timeStamp - s[s.length - 1].t < 80) startGlide(velocity);
                }
            }
            drag = null;
        };
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);

        // A drag or a tap that stopped a glide is not a click
        el.addEventListener('click', (e) => {
            if (!suppressClick) return;
            suppressClick = false;
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    return { attach };
})();

window.KineticScroll = KineticScroll;
