export function createViewerToggles({
  boundingVolumeButton,
  cesiumIonTokenInput,
  globeController,
  setStatus,
  terrainButton,
  terrainLight,
  toolbarDockEl,
  toolbarEl,
  toolbarToggleButton,
}) {
  let showBoundingVolume = false;
  let toolbarVisible = true;
  let debugTilesPlugin = null;

  function syncTerrainButton() {
    const terrainEnabled = globeController.isTerrainEnabled();
    terrainButton.classList.toggle('active', terrainEnabled);
    terrainLight.visible = terrainEnabled;
  }

  function setTerrainEnabled(enabled) {
    try {
      const cesiumIonToken = cesiumIonTokenInput?.value?.trim() || '';
      if (enabled && !cesiumIonToken) {
        cesiumIonTokenInput?.focus();
        setStatus('Enter a Cesium ion token to enable terrain.', true);
        syncTerrainButton();
        return false;
      }

      globeController.setTerrainEnabled(enabled, { cesiumIonToken });
      syncTerrainButton();
      return true;
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), true);
      syncTerrainButton();
      return false;
    }
  }

  function syncBoundingVolumeButton() {
    boundingVolumeButton?.classList.toggle('active', showBoundingVolume);
  }

  function applyBoundingVolume() {
    if (!debugTilesPlugin) {
      return;
    }

    debugTilesPlugin.displayBoxBounds = showBoundingVolume;
    debugTilesPlugin.displaySphereBounds = showBoundingVolume;
    debugTilesPlugin.displayRegionBounds = showBoundingVolume;
    debugTilesPlugin.update();
  }

  function setBoundingVolumePlugin(plugin) {
    debugTilesPlugin = plugin;
    applyBoundingVolume();
  }

  function setBoundingVolumeVisible(visible) {
    showBoundingVolume = visible;
    syncBoundingVolumeButton();
    applyBoundingVolume();
  }

  function toggleBoundingVolume() {
    setBoundingVolumeVisible(!showBoundingVolume);
    setStatus(
      showBoundingVolume
        ? 'Bounding volumes enabled.'
        : 'Bounding volumes disabled.',
    );
  }

  function syncToolbarVisibility() {
    const sidebarLabel = toolbarVisible ? 'Hide Sidebar' : 'Show Sidebar';
    toolbarDockEl.classList.toggle('expanded', toolbarVisible);
    toolbarDockEl.classList.toggle('collapsed', !toolbarVisible);
    toolbarEl.classList.toggle('hidden', !toolbarVisible);
    toolbarToggleButton.textContent = sidebarLabel;
    toolbarToggleButton.setAttribute('aria-label', sidebarLabel);
    toolbarToggleButton.setAttribute('aria-expanded', String(toolbarVisible));
  }

  function toggleToolbarVisibility() {
    toolbarVisible = !toolbarVisible;
    syncToolbarVisibility();
  }

  setTerrainEnabled(globeController.isTerrainEnabled());
  syncBoundingVolumeButton();
  syncToolbarVisibility();

  return {
    getBoundingVolumeVisible: () => showBoundingVolume,
    setBoundingVolumePlugin,
    setTerrainEnabled,
    toggleBoundingVolume,
    toggleToolbarVisibility,
  };
}
