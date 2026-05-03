const fs = require('fs');
const path = require('path');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createTempPath(filePath) {
  const suffix = Math.random().toString(36).slice(2);
  return `${filePath}.${process.pid}.${Date.now()}.${suffix}.tmp`;
}

function isRetryableRenameError(err) {
  return (
    err &&
    (err.code === 'EACCES' || err.code === 'EBUSY' || err.code === 'EPERM')
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function renameWithRetry(tempPath, filePath) {
  let delayMs = 25;
  for (let attempt = 1; attempt <= 80; attempt++) {
    try {
      await fs.promises.rename(tempPath, filePath);
      return;
    } catch (err) {
      if (!isRetryableRenameError(err) || attempt === 80) {
        throw err;
      }
      await delay(delayMs);
      delayMs = Math.min(delayMs * 2, 250);
    }
  }
}

async function writeFileAtomic(filePath, value) {
  const tempPath = createTempPath(filePath);
  try {
    await fs.promises.writeFile(tempPath, value);
    await renameWithRetry(tempPath, filePath);
  } catch (err) {
    try {
      await fs.promises.unlink(tempPath);
    } catch (unlinkErr) {
      if (!unlinkErr || unlinkErr.code !== 'ENOENT') {
        // Preserve the write failure; temp cleanup is best effort.
      }
    }
    throw err;
  }
}

async function writeJsonAtomic(filePath, value) {
  await writeFileAtomic(filePath, JSON.stringify(value));
}

function copyDirectoryRecursive(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

module.exports = {
  copyDirectoryRecursive,
  readJsonFile,
  writeFileAtomic,
  writeJsonAtomic,
};
