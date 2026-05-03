export function createStatusPanel({ statusEl, saveProgressEl }) {
  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', !!isError);
  }

  function setSaveProgress(percent) {
    if (!saveProgressEl) {
      return;
    }

    if (percent == null) {
      saveProgressEl.hidden = true;
      saveProgressEl.value = 0;
      return;
    }

    saveProgressEl.hidden = false;
    saveProgressEl.value = Math.min(100, Math.max(0, percent));
  }

  function handleSaveProgress(progress) {
    const percent = Number(progress?.percent);
    const hasPercent = Number.isFinite(percent);
    if (hasPercent) {
      setSaveProgress(percent);
    }

    if (typeof progress?.message === 'string' && progress.message.length > 0) {
      setStatus(
        hasPercent
          ? `${progress.message} ${Math.round(Math.min(100, Math.max(0, percent)))}%`
          : progress.message,
      );
    }
  }

  return { handleSaveProgress, setSaveProgress, setStatus };
}
