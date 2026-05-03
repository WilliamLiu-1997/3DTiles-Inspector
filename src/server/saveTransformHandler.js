const { normalizeMatrix4Array } = require('./matrix4');
const {
  clientAcceptsNdjson,
  readRequestBody,
  sendJson,
  sendJsonLine,
} = require('./httpHelpers');
const {
  normalizePositiveFinite,
  saveViewerTransform,
} = require('./saveTransform');
const { normalizeSplatScreenSelections } = require('./splatCrop');

const SAVE_ENDPOINT_PATH = '/__inspector/save-transform';

function createSaveTransformResponsePayload(
  saveResult,
  normalizedGeometricErrorLayerScale,
  normalizedGeometricErrorScale,
) {
  return {
    ok: true,
    transform: saveResult.transform,
    geometricErrorLayerScale: normalizedGeometricErrorLayerScale,
    geometricErrorScale: normalizedGeometricErrorScale,
    deletedSplats: saveResult.deletedSplats,
    processedSplatResources: saveResult.processedSplatResources,
  };
}

async function handleSaveTransformRequest(
  rootTilesetPath,
  req,
  res,
  staticFileReadGate = null,
) {
  let payload;
  try {
    const body = await readRequestBody(req);
    payload = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'Invalid JSON payload.',
    });
    return;
  }

  if (!payload || typeof payload !== 'object') {
    sendJson(res, 400, { error: 'Request payload must be a JSON object.' });
    return;
  }

  let normalizedEdit;
  try {
    normalizedEdit = normalizeMatrix4Array(payload.transform, 'transform');
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'transform must be a 16-number matrix.',
    });
    return;
  }

  let normalizedGeometricErrorScale;
  try {
    normalizedGeometricErrorScale = normalizePositiveFinite(
      payload.geometricErrorScale == null ? 1 : payload.geometricErrorScale,
      'geometricErrorScale',
    );
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'geometricErrorScale must be a finite number greater than 0.',
    });
    return;
  }

  let normalizedGeometricErrorLayerScale;
  try {
    normalizedGeometricErrorLayerScale = normalizePositiveFinite(
      payload.geometricErrorLayerScale == null
        ? 1
        : payload.geometricErrorLayerScale,
      'geometricErrorLayerScale',
    );
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'geometricErrorLayerScale must be a finite number greater than 0.',
    });
    return;
  }

  let normalizedSplatScreenSelections;
  try {
    normalizedSplatScreenSelections = normalizeSplatScreenSelections(
      payload.splatScreenSelections,
    );
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'splatScreenSelections must be an array of screen selection objects.',
    });
    return;
  }

  if (clientAcceptsNdjson(req)) {
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });

    try {
      const runSave = ({ tileReadStreamsClosed = false } = {}) =>
        saveViewerTransform(rootTilesetPath, normalizedEdit, {
          geometricErrorLayerScale: normalizedGeometricErrorLayerScale,
          geometricErrorScale: normalizedGeometricErrorScale,
          onProgress: (progress) => sendJsonLine(res, progress),
          splatScreenSelections: normalizedSplatScreenSelections,
          tileReadStreamsClosed,
        });
      const saveResult = staticFileReadGate
        ? await staticFileReadGate.runExclusiveSave(() =>
            runSave({ tileReadStreamsClosed: true }),
          )
        : await runSave();
      sendJsonLine(res, {
        type: 'complete',
        ...createSaveTransformResponsePayload(
          saveResult,
          normalizedGeometricErrorLayerScale,
          normalizedGeometricErrorScale,
        ),
      });
    } catch (err) {
      sendJsonLine(res, {
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Failed to save transform.',
        type: 'error',
      });
    } finally {
      res.end();
    }
    return;
  }

  let saveResult;
  try {
    const runSave = ({ tileReadStreamsClosed = false } = {}) =>
      saveViewerTransform(rootTilesetPath, normalizedEdit, {
        geometricErrorLayerScale: normalizedGeometricErrorLayerScale,
        geometricErrorScale: normalizedGeometricErrorScale,
        splatScreenSelections: normalizedSplatScreenSelections,
        tileReadStreamsClosed,
      });
    saveResult = staticFileReadGate
      ? await staticFileReadGate.runExclusiveSave(() =>
          runSave({ tileReadStreamsClosed: true }),
        )
      : await runSave();
  } catch (err) {
    sendJson(res, 500, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'Failed to save transform.',
    });
    return;
  }

  sendJson(
    res,
    200,
    createSaveTransformResponsePayload(
      saveResult,
      normalizedGeometricErrorLayerScale,
      normalizedGeometricErrorScale,
    ),
  );
}

module.exports = {
  SAVE_ENDPOINT_PATH,
  handleSaveTransformRequest,
};
