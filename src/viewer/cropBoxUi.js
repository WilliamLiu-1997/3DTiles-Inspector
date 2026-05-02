export function updateCropBoxControls({
  activeCropTransformMode,
  activeTransformTarget,
  cropBoxes,
  elements,
  onBoxButtonClick,
  pendingCropSetPosition,
  selectedCropBoxId,
  tilesetHasGaussianSplats,
  undoDepth,
}) {
  const {
    cropAddButton,
    cropCountValueEl,
    cropDeleteButton,
    cropListEl,
    cropMoveButton,
    cropRotateButton,
    cropScaleButton,
    cropSetPositionButton,
    cropUndoButton,
  } = elements;

  const hasSelectedBox =
    tilesetHasGaussianSplats &&
    cropBoxes.some((box) => box.id === selectedCropBoxId);
  const cropActive = activeTransformTarget === 'crop';

  cropAddButton.disabled = !tilesetHasGaussianSplats;
  cropCountValueEl.textContent = String(cropBoxes.length);
  cropMoveButton.disabled = !hasSelectedBox;
  cropRotateButton.disabled = !hasSelectedBox;
  cropScaleButton.disabled = !hasSelectedBox;
  cropSetPositionButton.disabled = !hasSelectedBox;
  cropDeleteButton.disabled = !hasSelectedBox;
  cropUndoButton.disabled = !tilesetHasGaussianSplats || undoDepth === 0;
  cropMoveButton.classList.toggle(
    'active',
    cropActive && activeCropTransformMode === 'translate',
  );
  cropRotateButton.classList.toggle(
    'active',
    cropActive && activeCropTransformMode === 'rotate',
  );
  cropScaleButton.classList.toggle(
    'active',
    cropActive && activeCropTransformMode === 'scale',
  );
  cropSetPositionButton.classList.toggle('active', pendingCropSetPosition);

  cropListEl.replaceChildren();
  cropBoxes.forEach((box, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Box ${index + 1}`;
    button.classList.toggle('active', box.id === selectedCropBoxId);
    button.addEventListener('click', () => {
      onBoxButtonClick(box, index);
    });
    cropListEl.appendChild(button);
  });
}
