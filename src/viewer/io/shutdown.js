export function createViewerShutdownRequester(shutdownUrl) {
  let shutdownRequested = false;

  return function requestViewerShutdown() {
    if (shutdownRequested) {
      return;
    }
    shutdownRequested = true;

    let sent = false;
    try {
      if (navigator.sendBeacon) {
        sent = navigator.sendBeacon(shutdownUrl, '');
      }
    } catch (err) {
      sent = false;
    }

    if (!sent) {
      fetch(shutdownUrl, {
        method: 'POST',
        body: '',
        keepalive: true,
      }).catch(() => {});
    }
  };
}
