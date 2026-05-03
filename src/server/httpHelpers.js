const { InspectorError } = require('../errors');

const MAX_SAVE_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.subtree': 'application/octet-stream',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function clientAcceptsNdjson(req) {
  return String(req.headers.accept || '')
    .toLowerCase()
    .split(',')
    .some((entry) => entry.trim().startsWith('application/x-ndjson'));
}

function sendJsonLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function sendText(res, statusCode, message, headers = {}) {
  const body = `${message}\n`;
  res.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SAVE_BODY_BYTES) {
        reject(new InspectorError('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function normalizeRequestTarget(rawTarget) {
  if (typeof rawTarget !== 'string' || rawTarget.length === 0) {
    return '/';
  }

  if (rawTarget.startsWith('//')) {
    return `/${rawTarget.replace(/^\/+/, '')}`;
  }

  return rawTarget;
}

module.exports = {
  MIME_TYPES,
  clientAcceptsNdjson,
  normalizeRequestTarget,
  readRequestBody,
  sendJson,
  sendJsonLine,
  sendText,
};
