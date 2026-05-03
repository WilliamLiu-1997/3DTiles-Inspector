export function updateCropControls({
  activeScreenSelectionId,
  elements,
  onScreenSelectionRemove,
  onScreenSelectionSelect,
  pendingScreenSelectionCount,
  pendingScreenSelectionMode,
  pendingScreenSelections,
  screenSelections,
  tilesetHasGaussianSplats,
}) {
  const {
    cropCountValueEl,
    cropListEl,
    cropScreenCancelButton,
    cropScreenConfirmButton,
    cropScreenSelectButton,
  } = elements;
  const hasPendingScreenSelection = pendingScreenSelectionCount > 0;

  cropScreenSelectButton.disabled =
    !tilesetHasGaussianSplats || hasPendingScreenSelection;
  cropScreenConfirmButton.disabled =
    !tilesetHasGaussianSplats || !hasPendingScreenSelection;
  cropScreenCancelButton.disabled =
    !tilesetHasGaussianSplats ||
    (!pendingScreenSelectionMode && !hasPendingScreenSelection);
  cropScreenSelectButton.classList.toggle('active', pendingScreenSelectionMode);
  cropCountValueEl.textContent = String(
    screenSelections.length + pendingScreenSelections.length,
  );

  cropListEl.replaceChildren();
  screenSelections.forEach((selection, index) => {
    cropListEl.appendChild(
      createSelectionControl({
        active: selection.id === activeScreenSelectionId,
        label: `Screen ${index + 1}`,
        onScreenSelectionRemove,
        onScreenSelectionSelect,
        selection,
      }),
    );
  });
  pendingScreenSelections.forEach((selection) => {
    const control = createSelectionControl({
      active: selection.id === activeScreenSelectionId,
      label: 'Pending',
      onScreenSelectionRemove,
      onScreenSelectionSelect,
      selection,
    });
    control.classList.add('active');
    cropListEl.appendChild(control);
  });
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
  const farValue = document.createElement('span');
  const removeButton = document.createElement('button');

  control.classList.add('screen-region', 'exclude-region');
  control.classList.toggle('selected', !!active);
  control.tabIndex = 0;
  header.classList.add('screen-region-header');
  title.textContent = label;
  farValue.textContent = `Far ${formatFarDepth(selection.depthRange.farDepth)}`;
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

  header.append(title, farValue, removeButton);
  control.append(header);
  return control;
}

function formatFarDepth(value) {
  const absValue = Math.abs(value);
  if (absValue >= 1000) {
    return `${(value / 1000).toFixed(2)} km`;
  }
  if (absValue >= 10) {
    return `${value.toFixed(1)} m`;
  }
  return `${value.toFixed(2)} m`;
}
