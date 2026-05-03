export function createSetPositionPointerTracker({
  getActiveTarget,
  maxClickDistanceSq,
  onApply,
}) {
  let pointerStart = null;

  function clear() {
    pointerStart = null;
  }

  function shouldTrackPointer(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return false;
    }
    return event.isPrimary !== false;
  }

  function handlePointerDown(event) {
    const target = getActiveTarget();
    if (!target || !shouldTrackPointer(event)) {
      if (pointerStart && event.isPrimary === false) {
        pointerStart.moved = true;
      }
      return;
    }

    pointerStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      pointerId: event.pointerId,
      target,
    };
  }

  function updatePointerMovement(event) {
    if (!pointerStart || event.pointerId !== pointerStart.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointerStart.clientX;
    const deltaY = event.clientY - pointerStart.clientY;
    if (deltaX * deltaX + deltaY * deltaY > maxClickDistanceSq) {
      pointerStart.moved = true;
    }
  }

  function pointerMatchesStart(event) {
    if (!pointerStart) {
      return false;
    }
    if (event.pointerId !== pointerStart.pointerId) {
      return false;
    }
    if (pointerStart.moved) {
      return false;
    }
    if (getActiveTarget() !== pointerStart.target) {
      return false;
    }

    const deltaX = event.clientX - pointerStart.clientX;
    const deltaY = event.clientY - pointerStart.clientY;
    return deltaX * deltaX + deltaY * deltaY <= maxClickDistanceSq;
  }

  async function handlePointerUp(event) {
    if (!pointerStart) {
      return;
    }

    const target = pointerStart.target;
    const shouldApply = pointerMatchesStart(event);
    pointerStart = null;

    if (shouldApply) {
      await onApply(target, event);
    }
  }

  function handlePointerCancel(event) {
    if (pointerStart && event.pointerId === pointerStart.pointerId) {
      pointerStart = null;
    }
  }

  return {
    clear,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove: updatePointerMovement,
    handlePointerUp,
  };
}
