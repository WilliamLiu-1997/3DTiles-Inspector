export const CAMERA_MOVEMENT_QUEUE_MAX_JOBS = 1;
export const CAMERA_MOVEMENT_QUEUE_RESTORE_DELAY_MS = 250;

export function createCameraMovementTileQueueController({
  cameraController,
  maxJobs = CAMERA_MOVEMENT_QUEUE_MAX_JOBS,
  restoreDelayMs = CAMERA_MOVEMENT_QUEUE_RESTORE_DELAY_MS,
}) {
  let tiles = null;
  let savedMaxJobs = null;
  let restoreTimeout = null;
  let throttled = false;

  function clearRestoreTimeout() {
    if (restoreTimeout !== null) {
      clearTimeout(restoreTimeout);
      restoreTimeout = null;
    }
  }

  function restoreQueues() {
    savedMaxJobs?.forEach(([queue, property, value]) => {
      queue[property] = value;
    });
    savedMaxJobs = null;
  }

  function throttleQueues() {
    const queues = [
      [tiles?.downloadQueue, 'maxJobsPerOrigin'],
      [tiles?.parseQueue, 'maxJobs'],
    ].filter(([queue]) => Boolean(queue));
    savedMaxJobs = queues.map(([queue, property]) =>
      [queue, property, queue[property]],
    );
    queues.forEach(([queue, property]) => {
      queue[property] = maxJobs;
    });
  }

  function setThrottled(nextThrottled) {
    if (throttled === nextThrottled) {
      return;
    }

    throttled = nextThrottled;
    if (throttled) {
      throttleQueues();
    } else {
      restoreQueues();
    }
  }

  function handleCameraStart() {
    clearRestoreTimeout();
    setThrottled(true);
  }

  function handleCameraFinish() {
    clearRestoreTimeout();
    restoreTimeout = setTimeout(() => {
      restoreTimeout = null;
      setThrottled(false);
    }, restoreDelayMs);
  }

  cameraController.addEventListener('start', handleCameraStart);
  cameraController.addEventListener('finish', handleCameraFinish);

  return {
    dispose() {
      clearRestoreTimeout();
      setThrottled(false);
      tiles = null;
      cameraController.removeEventListener('start', handleCameraStart);
      cameraController.removeEventListener('finish', handleCameraFinish);
    },
    setTiles(nextTiles) {
      if (tiles === nextTiles) {
        return;
      }

      if (throttled) {
        restoreQueues();
      }
      tiles = nextTiles;
      if (throttled) {
        throttleQueues();
      }
    },
  };
}
