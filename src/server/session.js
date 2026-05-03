const http = require('http');
const path = require('path');

const { InspectorError } = require('../errors');
const { resolveAndValidateTilesetPath } = require('../tileset-path');
const { sendJson, sendText, normalizeRequestTarget } = require('./httpHelpers');
const { handleViewerRequest } = require('./httpServer');
const { openBrowser } = require('./openBrowser');
const { createStaticFileReadGate } = require('./staticFileReadGate');
const {
  VIEWER_HTML_NAME,
  createViewerAssetsDir,
  getBrowserRelativePath,
  removeViewerAssetsDir,
} = require('./viewerAssets');

const SHUTDOWN_ENDPOINT_PATH = '/__inspector/shutdown';
const SHUTDOWN_DELAY_MS = 1000;

async function startInspectorSession(
  rawTilesetPath,
  { openBrowser: shouldOpenBrowser = true, handleSignals = true } = {},
) {
  const tilesetPath = resolveAndValidateTilesetPath(rawTilesetPath);
  const rootDir = path.dirname(tilesetPath);
  const viewerAssetsDir = createViewerAssetsDir({
    tilesetLabel: path.basename(tilesetPath),
    tilesetUrl: `./${getBrowserRelativePath(rootDir, tilesetPath)}`,
  });
  let sessionOrigin = null;
  const staticFileReadGate = createStaticFileReadGate();
  let closingPromise = null;
  let shutdownTimer = null;
  let cleanedUp = false;
  const signalHandlers = [];

  const removeSignalHandlers = () => {
    while (signalHandlers.length > 0) {
      const { event, handler } = signalHandlers.pop();
      process.off(event, handler);
    }
  };

  const cancelScheduledShutdown = () => {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  };

  let closeResolve;
  const closed = new Promise((resolve) => {
    closeResolve = resolve;
  });

  const close = () => {
    if (closingPromise) {
      return closingPromise;
    }

    closingPromise = new Promise((resolve, reject) => {
      cancelScheduledShutdown();
      removeSignalHandlers();
      server.close((err) => {
        try {
          if (err) {
            reject(err);
            return;
          }
          if (!cleanedUp) {
            removeViewerAssetsDir(viewerAssetsDir);
            cleanedUp = true;
          }
          resolve();
        } catch (cleanupErr) {
          reject(cleanupErr);
        } finally {
          closeResolve();
        }
      });
    });

    return closingPromise;
  };

  const scheduleShutdown = () => {
    cancelScheduledShutdown();
    shutdownTimer = setTimeout(() => {
      shutdownTimer = null;
      close().catch((err) => {
        console.error(
          `[warn] failed to close inspector server cleanly: ${err.message || err}`,
        );
      });
    }, SHUTDOWN_DELAY_MS);
    if (typeof shutdownTimer.unref === 'function') {
      shutdownTimer.unref();
    }
  };

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(
      normalizeRequestTarget(req.url),
      'http://127.0.0.1',
    );

    if (
      req.method === 'POST' &&
      requestUrl.pathname.startsWith('/__inspector/') &&
      req.headers.origin !== sessionOrigin
    ) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    if (requestUrl.pathname === SHUTDOWN_ENDPOINT_PATH) {
      if (req.method !== 'POST') {
        sendText(res, 405, 'Method Not Allowed', { Allow: 'POST' });
        return;
      }
      sendJson(res, 200, { ok: true });
      scheduleShutdown();
      return;
    }

    cancelScheduledShutdown();
    handleViewerRequest(
      rootDir,
      tilesetPath,
      viewerAssetsDir,
      req,
      res,
      requestUrl,
      staticFileReadGate,
    ).catch((err) => {
      sendJson(res, 500, {
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unexpected inspector server error.',
      });
    });
  });

  if (handleSignals) {
    for (const event of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        close().catch((err) => {
          console.error(
            `[warn] failed to close inspector server cleanly: ${err.message || err}`,
          );
        });
      };
      signalHandlers.push({ event, handler });
      process.on(event, handler);
    }
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close();
    throw new InspectorError('Inspector server failed to bind to a TCP port.');
  }

  sessionOrigin = `http://127.0.0.1:${address.port}`;
  const url = `${sessionOrigin}/${VIEWER_HTML_NAME}`;
  if (shouldOpenBrowser) {
    try {
      await openBrowser(url);
    } catch (err) {
      console.warn(
        `[warn] failed to open the browser automatically: ${err.message || err}`,
      );
    }
  }

  return {
    close,
    port: address.port,
    url,
    waitUntilClosed() {
      return closed;
    },
  };
}

module.exports = {
  startInspectorSession,
};
