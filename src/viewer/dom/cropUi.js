export function updateCropControls({
  activeScreenSelectionId,
  elements,
  onScreenSelectionRemove,
  onScreenSelectionSelect,
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
  const hasPendingScreenSelection = pendingScreenSelections.length > 0;

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
