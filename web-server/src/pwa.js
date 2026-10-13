// Register the service worker so the browser can install Sim Dash as an app
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}
