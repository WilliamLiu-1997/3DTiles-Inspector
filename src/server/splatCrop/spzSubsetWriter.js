const zlib = require('zlib');

const SPZ_MAGIC = 0x5053474e;
const SPZ_VERSION_3 = 3;
const FLAG_ANTIALIASED = 0x01;
const FLAG_LOD = 0x80;
const SUPPORTED_FLAGS = FLAG_ANTIALIASED;

const SH_VECS_BY_DEGREE = {
  0: 0,
  1: 3,
  2: 8,
  3: 15,
};

const POSITION_STRIDE = 9;
const OPACITY_STRIDE = 1;
const COLOR_STRIDE = 3;
const SCALE_STRIDE = 3;
const QUAT_STRIDE = 4;

function throwInspectorError(message) {
  const err = new Error(message);
  err.name = 'InspectorError';
  throw err;
}

function makeSpzLayout(pointCount, shDegree) {
  const shVecs = SH_VECS_BY_DEGREE[shDegree];
  if (shVecs == null) {
    throw new Error(`Unsupported SPZ SH degree: ${shDegree}.`);
  }

  const positionsOffset = 16;
  const opacityOffset = positionsOffset + pointCount * POSITION_STRIDE;
  const colorOffset = opacityOffset + pointCount * OPACITY_STRIDE;
  const scaleOffset = colorOffset + pointCount * COLOR_STRIDE;
  const quatOffset = scaleOffset + pointCount * SCALE_STRIDE;
  const extraShOffset = quatOffset + pointCount * QUAT_STRIDE;
  const extraBytesPerPoint = shVecs * 3;
  const byteLength = extraShOffset + pointCount * extraBytesPerPoint;

  return {
    byteLength,
    colorOffset,
    extraBytesPerPoint,
    extraShOffset,
    opacityOffset,
    positionsOffset,
    quatOffset,
    scaleOffset,
  };
}

function parseSpzPacket(compressedBytes) {
  const raw = zlib.gunzipSync(compressedBytes);

  if (raw.length < 16 || raw.readUInt32LE(0) !== SPZ_MAGIC) {
    throw new Error('Invalid SPZ packet.');
  }

  const version = raw.readUInt32LE(4);
  if (version !== SPZ_VERSION_3) {
    throw new Error(`Only SPZ v3 raw-copy crop is supported, got v${version}.`);
  }

  const sourceCount = raw.readUInt32LE(8);
  const shDegree = raw.readUInt8(12);
  const fractionalBits = raw.readUInt8(13);
  const flags = raw.readUInt8(14);

  if ((flags & FLAG_LOD) !== 0) {
    throwInspectorError(
      'SPZ files with built-in LOD flags are not supported for crop deletion yet.',
    );
  }
  if ((flags & ~SUPPORTED_FLAGS) !== 0) {
    throw new Error(`Unsupported SPZ flags: 0x${flags.toString(16)}.`);
  }

  const layout = makeSpzLayout(sourceCount, shDegree);
  if (raw.length !== layout.byteLength) {
    throw new Error(
      `Unexpected SPZ packet length: expected ${layout.byteLength}, got ${raw.length}.`,
    );
  }

  return {
    fractionalBits,
    layout,
    raw,
    shDegree,
    sourceCount,
  };
}

function copyRun(raw, out, src, dst, sourceStart, targetStart, length) {
  const posBytes = length * POSITION_STRIDE;
  const posSrc = src.positionsOffset + sourceStart * POSITION_STRIDE;
  raw.copy(
    out,
    dst.positionsOffset + targetStart * POSITION_STRIDE,
    posSrc,
    posSrc + posBytes,
  );

  const opacityBytes = length * OPACITY_STRIDE;
  const opacitySrc = src.opacityOffset + sourceStart * OPACITY_STRIDE;
  raw.copy(
    out,
    dst.opacityOffset + targetStart * OPACITY_STRIDE,
    opacitySrc,
    opacitySrc + opacityBytes,
  );

  const colorBytes = length * COLOR_STRIDE;
  const colorSrc = src.colorOffset + sourceStart * COLOR_STRIDE;
  raw.copy(
    out,
    dst.colorOffset + targetStart * COLOR_STRIDE,
    colorSrc,
    colorSrc + colorBytes,
  );

  const scaleBytes = length * SCALE_STRIDE;
  const scaleSrc = src.scaleOffset + sourceStart * SCALE_STRIDE;
  raw.copy(
    out,
    dst.scaleOffset + targetStart * SCALE_STRIDE,
    scaleSrc,
    scaleSrc + scaleBytes,
  );

  const quatBytes = length * QUAT_STRIDE;
  const quatSrc = src.quatOffset + sourceStart * QUAT_STRIDE;
  raw.copy(
    out,
    dst.quatOffset + targetStart * QUAT_STRIDE,
    quatSrc,
    quatSrc + quatBytes,
  );

  const extraStride = dst.extraBytesPerPoint;
  if (extraStride > 0) {
    const extraBytes = length * extraStride;
    const extraSrc = src.extraShOffset + sourceStart * extraStride;
    raw.copy(
      out,
      dst.extraShOffset + targetStart * extraStride,
      extraSrc,
      extraSrc + extraBytes,
    );
  }
}

function writeSurvivingSpzBytes(
  parsed,
  survivors,
  { compressionLevel = 6 } = {},
) {
  const { raw, shDegree, sourceCount, layout: src } = parsed;
  if (survivors.length > sourceCount) {
    throw new Error('Too many SPZ survivor indices.');
  }

  const dst = makeSpzLayout(survivors.length, shDegree);
  const out = Buffer.allocUnsafe(dst.byteLength);

  raw.copy(out, 0, 0, 16);
  out.writeUInt32LE(survivors.length, 8);

  let previous = -1;
  let runStart = -1;
  let runTargetStart = 0;
  let runLength = 0;

  for (let i = 0; i < survivors.length; i++) {
    const sourceIndex = survivors[i];
    if (runLength === 0) {
      runStart = sourceIndex;
      runTargetStart = i;
      runLength = 1;
    } else if (sourceIndex === previous + 1) {
      runLength += 1;
    } else {
      copyRun(raw, out, src, dst, runStart, runTargetStart, runLength);
      runStart = sourceIndex;
      runTargetStart = i;
      runLength = 1;
    }

    previous = sourceIndex;
  }

  if (runLength > 0) {
    copyRun(raw, out, src, dst, runStart, runTargetStart, runLength);
  }

  return zlib.gzipSync(out, {
    level: compressionLevel,
    memLevel: 9,
  });
}

module.exports = {
  parseSpzPacket,
  writeSurvivingSpzBytes,
};
