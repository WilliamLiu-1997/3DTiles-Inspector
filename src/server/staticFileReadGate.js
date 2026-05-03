function createStaticFileReadGate() {
  let saving = false;
  let activeReads = 0;
  let noActiveReadWaiters = [];
  let saveFinishedWaiters = [];

  function resolveWaiters(waiters) {
    waiters.forEach((resolve) => resolve());
  }

  function notifyNoActiveReads() {
    const waiters = noActiveReadWaiters;
    noActiveReadWaiters = [];
    resolveWaiters(waiters);
  }

  function notifySaveFinished() {
    const waiters = saveFinishedWaiters;
    saveFinishedWaiters = [];
    resolveWaiters(waiters);
  }

  function waitForSaveFinished() {
    return new Promise((resolve) => {
      saveFinishedWaiters.push(resolve);
    });
  }

  function waitForNoActiveReads() {
    return new Promise((resolve) => {
      noActiveReadWaiters.push(resolve);
    });
  }

  async function acquireRead() {
    while (saving) {
      await waitForSaveFinished();
    }

    activeReads += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      activeReads -= 1;
      if (activeReads === 0) {
        notifyNoActiveReads();
      }
    };
  }

  async function runExclusiveSave(task) {
    while (saving) {
      await waitForSaveFinished();
    }

    saving = true;
    try {
      while (activeReads > 0) {
        await waitForNoActiveReads();
      }
      return await task();
    } finally {
      saving = false;
      notifySaveFinished();
    }
  }

  return {
    acquireRead,
    runExclusiveSave,
  };
}

module.exports = {
  createStaticFileReadGate,
};
