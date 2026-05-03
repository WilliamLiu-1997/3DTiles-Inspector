const { spawn } = require('child_process');

function escapeForSingleQuotedPowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function openBrowser(url) {
  return new Promise((resolve, reject) => {
    let child;

    if (process.platform === 'win32') {
      child = spawn(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Start-Process '${escapeForSingleQuotedPowerShell(url)}'`,
        ],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        },
      );
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      child = spawn('xdg-open', [url], {
        detached: true,
        stdio: 'ignore',
      });
    }

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = {
  openBrowser,
};
