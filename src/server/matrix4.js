const { InspectorError } = require('../errors');

const IDENTITY_MATRIX4 = Object.freeze([
  1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
  1.0,
]);

function cloneIdentityMatrix4() {
  return IDENTITY_MATRIX4.slice();
}

function normalizeMatrix4Array(value, name = 'transform') {
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

function multiplyMatrix4(left, right) {
  const a = normalizeMatrix4Array(left, 'left');
  const b = normalizeMatrix4Array(right, 'right');
  const out = new Array(16);

  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0.0;
      for (let i = 0; i < 4; i++) {
        sum += a[i * 4 + row] * b[column * 4 + i];
      }
      out[column * 4 + row] = sum;
    }
  }

  return out;
}

module.exports = {
  IDENTITY_MATRIX4,
  cloneIdentityMatrix4,
  multiplyMatrix4,
  normalizeMatrix4Array,
};
