export async function postSaveTransform({
  incrementalMatrix,
  saveState,
  saveUrl,
  splatCropBoxes,
}) {
  const response = await fetch(saveUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      geometricErrorLayerScale: saveState.incrementalGeometricErrorLayerScale,
      geometricErrorScale: saveState.incrementalGeometricErrorScale,
      splatCropBoxes,
      transform: incrementalMatrix.toArray(),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Save failed.');
  }
  return payload;
}
