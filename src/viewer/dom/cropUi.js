export function updateCropControls({
  activeScreenSelectionId,
  elements,
  keepSphere,
  onKeepSphereRemove,
  onKeepSphereSelect,
  onScreenSelectionRemove,
  onScreenSelectionSelect,
  pendingScreenSelectionMode,
  pendingScreenSelections,
  screenSelections,
  tilesetHasGaussianSplats,
  interactionLocked = false,
}) {
  const {
    cropCountValueEl,
    cropListEl,
    cropScreenCancelButton,
    cropScreenConfirmButton,
    cropScreenSelectButton,
    keepSphereCancelButton,
    keepSphereConfirmButton,
    keepSphereCreateButton,
    keepSphereListEl,
    keepSphereRadiusTrackEl,
    keepSphereSizeValueInput,
  } = elements;
  const hasPendingScreenSelection = pendingScreenSelections.length > 0;
  const hasKeepSphere = !!keepSphere;
  const hasPendingKeepSphere = hasKeepSphere && !keepSphere.confirmed;

  cropScreenSelectButton.disabled =
    interactionLocked || !tilesetHasGaussianSplats || hasPendingScreenSelection;
  cropScreenConfirmButton.disabled =
    interactionLocked || !tilesetHasGaussianSplats || !hasPendingScreenSelection;
  cropScreenCancelButton.disabled =
    interactionLocked ||
    !tilesetHasGaussianSplats ||
    (!pendingScreenSelectionMode && !hasPendingScreenSelection);
  cropScreenSelectButton.classList.toggle('active', pendingScreenSelectionMode);
  cropCountValueEl.textContent = String(
    screenSelections.length + pendingScreenSelections.length,
  );
  keepSphereCreateButton.disabled =
    interactionLocked || !tilesetHasGaussianSplats || hasKeepSphere;
  keepSphereConfirmButton.disabled =
    interactionLocked || !tilesetHasGaussianSplats || !hasPendingKeepSphere;
  keepSphereCancelButton.disabled =
    interactionLocked || !tilesetHasGaussianSplats || !hasPendingKeepSphere;
  const keepSphereEditingDisabled = !hasKeepSphere || interactionLocked;
  keepSphereRadiusTrackEl.classList.toggle(
    'disabled',
    keepSphereEditingDisabled,
  );
  keepSphereRadiusTrackEl.setAttribute(
    'aria-disabled',
    keepSphereEditingDisabled ? 'true' : 'false',
  );
  const keepSphereSize = hasKeepSphere ? formatSize(keepSphere.worldRadius) : '';
  keepSphereRadiusTrackEl.setAttribute(
    'aria-label',
    hasKeepSphere
      ? `Crop sphere size ${keepSphereSize}`
      : 'Crop sphere size',
  );
  keepSphereRadiusTrackEl.title = hasKeepSphere
    ? `Crop sphere size ${keepSphereSize}`
    : 'Crop sphere size';
  keepSphereSizeValueInput.disabled = keepSphereEditingDisabled;
  keepSphereSizeValueInput.value = keepSphereSize;

  keepSphereListEl.replaceChildren();
  if (hasKeepSphere) {
    keepSphereListEl.appendChild(
      createSelectionControl({
        active: keepSphere.id === activeScreenSelectionId,
        label: keepSphere.confirmed ? 'Crop Sphere' : 'Pending',
        onScreenSelectionRemove: onKeepSphereRemove,
        onScreenSelectionSelect: onKeepSphereSelect,
        selection: keepSphere,
      }),
    );
  }

  cropListEl.replaceChildren();
  pendingScreenSelections.forEach((selection) => {
    cropListEl.appendChild(
      createSelectionControl({
        active: selection.id === activeScreenSelectionId,
        label: 'Pending',
        onScreenSelectionRemove,
        onScreenSelectionSelect,
        selection,
      }),
    );
  });
  screenSelections
    .map((selection, index) => ({ label: `Region ${index + 1}`, selection }))
    .reverse()
    .forEach(({ label, selection }) => {
      cropListEl.appendChild(
        createSelectionControl({
          active: selection.id === activeScreenSelectionId,
          label,
          onScreenSelectionRemove,
          onScreenSelectionSelect,
          selection,
        }),
      );
    });
}

function formatSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value)) {
    return '';
  }
  const abs = Math.abs(value);
  if (abs > 0 && (abs < 0.001 || abs >= 1000000)) {
    return value.toExponential(3).replace(/\.?0+e/, 'e');
  }
  return (abs < 1 ? value.toFixed(3) : value.toFixed(2)).replace(/\.?0+$/, '');
}

function createSelectionControl({
  active,
  label,
  onScreenSelectionRemove,
  onScreenSelectionSelect,
  selection,
}) {
  const control = document.createElement('div');
  const header = document.createElement('div');
  const title = document.createElement('span');
  const removeButton = document.createElement('button');

  control.classList.add('screen-region');
  control.classList.toggle('selected', !!active);
  control.tabIndex = 0;
  header.classList.add('screen-region-header');
  title.textContent = label;
  removeButton.type = 'button';
  removeButton.textContent = 'Delete';
  removeButton.classList.add('screen-region-remove');
  removeButton.setAttribute('aria-label', `Remove ${label}`);
  removeButton.title = `Remove ${label}`;

  control.addEventListener('click', () => {
    onScreenSelectionSelect?.(selection.id);
  });
  control.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    onScreenSelectionSelect?.(selection.id);
  });
  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onScreenSelectionRemove?.(selection.id);
  });

  header.append(title, removeButton);
  control.append(header);
  return control;
}
