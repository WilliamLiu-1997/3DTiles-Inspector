const { InspectorError } = require('../../errors');

const MAX_SCREEN_SELECTIONS = 256;
const SCREEN_SELECTION_ACTION_EXCLUDE = 'exclude';

function normalizeMatrix4Array(value, name = 'matrix') {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new InspectorError(`${name} must be a 16-number matrix.`);
  }

  return value.map((entry, index) => {
    const number = Number(entry);
    if (!Number.isFinite(number)) {
      throw new InspectorError(`${name}[${index}] must be a finite number.`);
    }
    return number;
  });
}

function normalizeFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new InspectorError(`${name} must be a finite number.`);
  }
  return number;
}

function normalizeScreenSelectionRect(value, name) {
  if (!value || typeof value !== 'object') {
    throw new InspectorError(`${name} must be an object.`);
  }

  const rect = {
    maxX: normalizeFiniteNumber(value.maxX, `${name}.maxX`),
    maxY: normalizeFiniteNumber(value.maxY, `${name}.maxY`),
    minX: normalizeFiniteNumber(value.minX, `${name}.minX`),
    minY: normalizeFiniteNumber(value.minY, `${name}.minY`),
  };

  if (
    rect.minX < -1 ||
    rect.maxX > 1 ||
    rect.minY < -1 ||
    rect.maxY > 1
  ) {
    throw new InspectorError(`${name} values must be inside NDC range [-1, 1].`);
  }
  if (rect.minX > rect.maxX || rect.minY > rect.maxY) {
    throw new InspectorError(`${name} min values must be <= max values.`);
  }

  return rect;
}

function normalizeScreenSelectionAction(value, name) {
  if (value == null) {
    return SCREEN_SELECTION_ACTION_EXCLUDE;
  }
  if (value !== SCREEN_SELECTION_ACTION_EXCLUDE) {
    throw new InspectorError(`${name} must be "exclude".`);
  }
  return value;
}

function normalizeScreenSelectionPlaneMatrices(value, name) {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 6) {
    throw new InspectorError(`${name} must be an array of 6 plane matrices.`);
  }
  return value.map((matrix, index) =>
    normalizeMatrix4Array(matrix, `${name}[${index}]`),
  );
}

function normalizeSplatScreenSelections(value) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new InspectorError('splatScreenSelections must be an array.');
  }

  if (value.length > MAX_SCREEN_SELECTIONS) {
    throw new InspectorError(
      `splatScreenSelections cannot contain more than ${MAX_SCREEN_SELECTIONS} selections.`,
    );
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new InspectorError(
        `splatScreenSelections[${index}] must be an object.`,
      );
    }

    return {
      action: normalizeScreenSelectionAction(
        entry.action,
        `splatScreenSelections[${index}].action`,
      ),
      rect: normalizeScreenSelectionRect(
        entry.rect,
        `splatScreenSelections[${index}].rect`,
      ),
      planeMatrices: normalizeScreenSelectionPlaneMatrices(
        entry.planeMatrices,
        `splatScreenSelections[${index}].planeMatrices`,
      ),
      viewProjectionMatrix: normalizeMatrix4Array(
        entry.viewProjectionMatrix,
        `splatScreenSelections[${index}].viewProjectionMatrix`,
      ),
    };
  });
}

module.exports = {
  SCREEN_SELECTION_ACTION_EXCLUDE,
  normalizeMatrix4Array,
  normalizeSplatScreenSelections,
};
