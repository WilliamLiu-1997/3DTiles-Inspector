export function createRenderLoop({
  cancelAnimationFrame: cancelFrame = globalThis.cancelAnimationFrame?.bind(
    globalThis,
  ),
  onFrame,
  onIdle,
  renderOnDemand = false,
  requestAnimationFrame: requestFrame =
    globalThis.requestAnimationFrame?.bind(globalThis),
}) {
  if (typeof onFrame !== 'function') {
    throw new TypeError('onFrame must be a function.');
  }
  if (typeof requestFrame !== 'function') {
    throw new TypeError('requestAnimationFrame must be a function.');
  }

  let disposed = false;
  let frameHandle = null;
  let onDemand = !!renderOnDemand;

  function requestRender() {
    if (disposed || frameHandle !== null) {
      return false;
    }

    frameHandle = requestFrame(runFrame);
    return true;
  }

  function runFrame(time) {
    frameHandle = null;
    if (disposed) {
      return;
    }

    const animationActive = onFrame(time) === true;
    if (!onDemand || animationActive) {
      requestRender();
    }
    if (onDemand && frameHandle === null) {
      onIdle?.();
    }
  }

  return {
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      if (frameHandle !== null && typeof cancelFrame === 'function') {
        cancelFrame(frameHandle);
      }
      frameHandle = null;
    },
    isRenderOnDemand: () => onDemand,
    requestRender,
    setRenderOnDemand(enabled) {
      onDemand = !!enabled;
      requestRender();
    },
  };
}
