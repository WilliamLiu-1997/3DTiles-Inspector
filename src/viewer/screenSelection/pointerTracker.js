import { dragCurrent, dragStart } from './state.js';
import {
  createSelectionData,
  clearOverlay,
  getClampedClientPoint,
  getClientSelectionRect,
  updateOverlayRect,
} from './geometry.js';

export function createScreenSelectionPointerTracker({
  camera,
  domElement,
  getDepthRange,
  onOverlayClear,
  onOverlayUpdate,
  onSelectionCreated,
  overlayEl,
  rectEl,
}) {
  let active = false;
  let drag = null;

  function clearDrag() {
    drag = null;
    onOverlayClear?.();
    clearOverlay(overlayEl, rectEl);
  }

  function updateDragOverlay() {
    const clientRect = {
      ...getClientSelectionRect(drag.start, drag.current),
    };
    if (onOverlayUpdate?.(clientRect) === true) {
      return;
    }
    updateOverlayRect(overlayEl, rectEl, clientRect);
  }

  function setActive(nextActive) {
    active = !!nextActive;
    if (!active) {
      clearDrag();
    }
  }

  function handlePointerDown(event) {
    if (!active || event.button !== 0) {
      return false;
    }

    const domRect = domElement.getBoundingClientRect();
    getClampedClientPoint(event, domRect, dragStart);
    dragCurrent.copy(dragStart);
    drag = {
      pointerId: event.pointerId,
      start: dragStart.clone(),
      current: dragCurrent.clone(),
    };
    updateDragOverlay();
    domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePointerMove(event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) {
      return false;
    }

    const domRect = domElement.getBoundingClientRect();
    getClampedClientPoint(event, domRect, drag.current);
    updateDragOverlay();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePointerUp(event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) {
      return false;
    }

    const clientRect = {
      ...getClientSelectionRect(drag.start, drag.current),
    };
    const selection = createSelectionData({
      camera,
      domElement,
      end: drag.current,
      getDepthRange,
      start: drag.start,
    });
    domElement.releasePointerCapture?.(event.pointerId);
    clearDrag();
    onSelectionCreated(selection, clientRect);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePointerCancel(event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) {
      return false;
    }

    domElement.releasePointerCapture?.(event.pointerId);
    clearDrag();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  return {
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    setActive,
  };
}
