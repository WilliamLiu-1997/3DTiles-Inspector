const TRACK_PIXELS_PER_SCALE_EXPONENT = 90;

function exponentToUniformScale(exponent) {
  return 2 ** exponent;
}

function scaleToExponent(scale) {
  return Math.log2(scale);
}

function getFinitePositiveScale(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeUniformScale(value) {
  const scale = getFinitePositiveScale(value);
  if (scale === null) {
    return null;
  }
  return scale;
}

export function formatUniformScale(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value)) {
    return '1';
  }

  const absValue = Math.abs(value);
  if (absValue > 0 && (absValue < 0.00001 || absValue >= 1000000)) {
    return value.toExponential(3).replace(/\.?0+e/, 'e');
  }

  const formatted =
    absValue < 0.01
      ? value.toFixed(5)
      : absValue < 0.1
        ? value.toFixed(4)
        : absValue < 10
          ? value.toFixed(3)
          : absValue < 100
            ? value.toFixed(2)
            : value.toFixed(1);

  return formatted.replace(/\.?0+$/, '');
}

export function createUniformScaleController({
  applyScale,
  uniformScaleTrackEl,
  uniformScaleValueInput,
}) {
  let uniformScale = 1;
  let syncingInputs = false;
  let trackDragStartClientX = 0;
  let trackDragStartExponent = 0;

  function getScaleExponent() {
    return scaleToExponent(uniformScale);
  }

  function updateInputs() {
    syncingInputs = true;
    try {
      const formattedScale = formatUniformScale(uniformScale);
      uniformScaleTrackEl.setAttribute(
        'aria-label',
        `Scale x${formattedScale}`,
      );
      uniformScaleTrackEl.title = `Scale x${formattedScale}`;
      uniformScaleValueInput.value = formatUniformScale(uniformScale);
    } finally {
      syncingInputs = false;
    }
  }

  function applyUniformScale(nextScale) {
    uniformScale = nextScale;
    applyScale(nextScale);
    updateInputs();
  }

  function setScale(scale) {
    const nextScale = normalizeUniformScale(scale);
    if (nextScale === null) {
      return false;
    }

    applyUniformScale(nextScale);
    return true;
  }

  function setScaleExponent(exponent) {
    const exponentNumber = Number(exponent);
    if (!Number.isFinite(exponentNumber)) {
      updateInputs();
      return false;
    }

    const nextScale = exponentToUniformScale(exponentNumber);
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      updateInputs();
      return false;
    }

    applyUniformScale(nextScale);
    return true;
  }

  function beginTrackDrag(clientX) {
    trackDragStartClientX = clientX;
    trackDragStartExponent = getScaleExponent();
    uniformScaleTrackEl.style.setProperty('--scale-track-offset', '0px');
  }

  function setScaleFromTrackClientX(clientX) {
    const deltaX = clientX - trackDragStartClientX;
    uniformScaleTrackEl.style.setProperty(
      '--scale-track-offset',
      `${deltaX}px`,
    );
    return setScaleExponent(
      trackDragStartExponent + deltaX / TRACK_PIXELS_PER_SCALE_EXPONENT,
    );
  }

  function nudgeScaleExponent(delta) {
    return setScaleExponent(getScaleExponent() + delta);
  }

  function setScaleValue(value, { commit = false } = {}) {
    if (syncingInputs) {
      return true;
    }

    const rawValue = typeof value === 'string' ? value.trim() : value;
    if (rawValue === '' && !commit) {
      return false;
    }

    const scale = normalizeUniformScale(rawValue);
    if (scale === null) {
      if (commit) {
        updateInputs();
      }
      return false;
    }

    applyUniformScale(scale);
    return true;
  }

  function initializeInputs() {
    uniformScaleValueInput.removeAttribute('max');
    uniformScaleValueInput.removeAttribute('min');
    uniformScaleValueInput.step = 'any';
    updateInputs();
  }

  function syncFromRootScale(scale) {
    const nextScale = normalizeUniformScale(scale);
    uniformScale = nextScale === null ? 1 : nextScale;
    updateInputs();
  }

  return {
    beginTrackDrag,
    formatScale: formatUniformScale,
    getScale: () => uniformScale,
    initializeInputs,
    nudgeScaleExponent,
    setScale,
    setScaleExponent,
    setScaleFromTrackClientX,
    setScaleValue,
    syncFromRootScale,
  };
}
