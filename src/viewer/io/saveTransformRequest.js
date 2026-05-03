export async function postSaveTransform({
  incrementalMatrix,
  onProgress = null,
  saveState,
  saveUrl,
  splatScreenSelections,
}) {
  const response = await fetch(saveUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson, application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      geometricErrorLayerScale: saveState.incrementalGeometricErrorLayerScale,
      geometricErrorScale: saveState.incrementalGeometricErrorScale,
      splatScreenSelections,
      transform: incrementalMatrix.toArray(),
    }),
  });

  const contentType = response.headers.get('Content-Type') || '';
  if (
    response.body &&
    contentType.toLowerCase().includes('application/x-ndjson')
  ) {
    return readSaveProgressStream(response, onProgress);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Save failed.');
  }
  return payload;
}

async function readSaveProgressStream(response, onProgress) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completePayload = null;

  const handleLine = (line) => {
    if (!line.trim()) {
      return;
    }

    const payload = JSON.parse(line);
    if (payload.type === 'progress') {
      if (typeof onProgress === 'function') {
        onProgress(payload);
      }
      return;
    }
    if (payload.type === 'error') {
      throw new Error(payload.error || 'Save failed.');
    }
    if (payload.type === 'complete') {
      completePayload = payload;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      handleLine(line);
    }
    if (done) {
      break;
    }
  }

  if (buffer.length > 0) {
    handleLine(buffer);
  }
  if (!response.ok) {
    throw new Error('Save failed.');
  }
  if (!completePayload) {
    throw new Error('Save finished without a completion payload.');
  }
  return completePayload;
}
