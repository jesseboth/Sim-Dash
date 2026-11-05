// Keeps the screen on. Uses the Screen Wake Lock API on secure (HTTPS) pages. On plain HTTP the
// API is not available, so a hidden, muted, looping 16x16 black video keeps the screen on instead.

const KeepAwake = (function () {
    const MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMzbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAl10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHVbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABgG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUBzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDMgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMAEDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAApgAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAEAAAgAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAEAAAAAQAAACRzdHN6AAAAAAAAAAAAAAAEAAACewAAAAoAAAAKAAAACQAAABRzdGNvAAAAAAAAAAEAAANjAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDMAAAAIZnJlZQAAAqBtZGF0AAACaAYF//9k3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAALZYiEBTyYoAA/v4AAAAAGQZo4CnqAAAAABkGaVAKeoAAAAAVBmmAS9Q==';
    const WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIuEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggIY7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAzV0GNTGF2ZjYyLjEyLjEwM0SJiECfQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYgADtIEUuVufpyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhB3NZQDgkLCBELqBEJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAzc3PWY8CLY8WIAA7SBFLlbn5nyKFFo4dFTkNPREVSRIeUTGF2YzYyLjI4LjEwMyBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z17eeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiFhIgCAgAMDWAA/v+rUICjlYEB9ACxAQAFEKwAGAAYWC/0AAgAAKOVgQPoALEBAAUQrAAYABhYL/QACAAAo5WBBdwAsQEABRCsABgAGFgv9AAIAAAcU7trkbuPs4EAt4r3gQHxggGm8IED';

    let wanted = false;
    let lock = null;
    let video = null;

    function makeVideo() {
        const v = document.createElement('video');
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.setAttribute('aria-hidden', 'true');
        v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;';
        for (const [src, type] of [[WEBM, 'video/webm'], [MP4, 'video/mp4']]) {
            const source = document.createElement('source');
            source.src = src;
            source.type = type;
            v.appendChild(source);
        }
        document.body.appendChild(v);
        return v;
    }

    async function acquire() {
        if ('wakeLock' in navigator && window.isSecureContext) {
            try {
                lock = await navigator.wakeLock.request('screen');
                lock.addEventListener('release', () => { lock = null; });
                return;
            } catch (e) { /* not allowed now: use the video */ }
        }
        video = video || makeVideo();
        video.play().catch(() => { /* needs a tap first; the next tap tries again */ });
    }

    function release() {
        lock?.release().catch(() => {});
        lock = null;
        video?.pause();
    }

    // Turn on or off. Call it from a tap (for example Start) the first time.
    function set(on) {
        if (on === wanted) return;
        wanted = on;
        if (on) acquire(); else release();
    }

    // The browser drops the lock and pauses the video when the page is hidden
    document.addEventListener('visibilitychange', () => {
        if (wanted && document.visibilityState === 'visible') acquire();
    });
    // A page that loads armed has no tap yet: the first tap starts the video
    document.addEventListener('pointerdown', () => {
        if (wanted && !lock && video?.paused) acquire();
    });

    return { set, isOn: () => wanted };
})();

window.KeepAwake = KeepAwake;
