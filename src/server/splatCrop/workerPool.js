const path = require('path');
const { Worker } = require('worker_threads');

const { InspectorError } = require('../../errors');

const SPLAT_CROP_WORKER_COUNT = 4;
const SPLAT_CROP_WORKER_PATH = path.join(__dirname, 'worker.js');

function deserializeWorkerError(error) {
  const message =
    error && typeof error.message === 'string'
      ? error.message
      : 'SPZ crop worker failed.';
  const next =
    error && error.name === 'InspectorError'
      ? new InspectorError(message)
      : new Error(message);
  if (error && typeof error.stack === 'string') {
    next.stack = error.stack;
  }
  return next;
}

class SplatCropWorkerPool {
  constructor(size = SPLAT_CROP_WORKER_COUNT) {
    this.callbacks = new Map();
    this.closed = false;
    this.idleWorkers = [];
    this.nextJobId = 1;
    this.queue = [];
    this.workers = [];

    const workerCount = Math.max(1, Math.floor(size));
    for (let index = 0; index < workerCount; index++) {
      const worker = this.createWorker();
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  createWorker() {
    const worker = new Worker(SPLAT_CROP_WORKER_PATH);
    worker.currentJobId = null;
    worker.failed = false;
    worker.on('message', (message) => {
      this.handleMessage(worker, message);
    });
    worker.on('error', (err) => {
      this.handleWorkerFailure(worker, err);
    });
    worker.on('exit', (code) => {
      if (!this.closed && code !== 0) {
        this.handleWorkerFailure(
          worker,
          new Error(`SPZ crop worker exited with code ${code}.`),
        );
      }
    });
    return worker;
  }

  handleMessage(worker, message) {
    const job = this.callbacks.get(message?.id);
    if (!job) {
      return;
    }

    this.callbacks.delete(job.id);
    worker.currentJobId = null;

    if (message.error) {
      job.reject(deserializeWorkerError(message.error));
    } else {
      const result = message.result || {};
      job.resolve({
        bounds: result.bounds || null,
        bytes: result.bytes ? Buffer.from(result.bytes) : null,
        deleted: Number(result.deleted || 0),
        empty: !!result.empty,
      });
    }

    if (!this.closed && !worker.failed) {
      this.idleWorkers.push(worker);
      this.dispatch();
    }
  }

  handleWorkerFailure(worker, err) {
    if (worker.failed) {
      return;
    }
    worker.failed = true;

    this.workers = this.workers.filter((entry) => entry !== worker);
    this.idleWorkers = this.idleWorkers.filter((entry) => entry !== worker);

    if (worker.currentJobId !== null) {
      const job = this.callbacks.get(worker.currentJobId);
      if (job) {
        this.callbacks.delete(job.id);
        job.reject(err);
      }
      worker.currentJobId = null;
    }

    if (!this.closed) {
      const replacement = this.createWorker();
      this.workers.push(replacement);
      this.idleWorkers.push(replacement);
      this.dispatch();
    }
  }

  dispatch() {
    while (!this.closed && this.queue.length > 0 && this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop();
      const job = this.queue.shift();
      this.callbacks.set(job.id, job);
      worker.currentJobId = job.id;
      try {
        worker.postMessage(
          {
            id: job.id,
            payload: job.payload,
            type: 'rewriteSpzBytes',
          },
          job.transferList,
        );
      } catch (err) {
        this.callbacks.delete(job.id);
        worker.currentJobId = null;
        job.reject(err);
        if (!worker.failed) {
          this.idleWorkers.push(worker);
        }
      }
    }
  }

  run(payload, transferList = []) {
    if (this.closed) {
      return Promise.reject(new Error('SPZ crop worker pool is closed.'));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextJobId++,
        payload,
        reject,
        resolve,
        transferList,
      });
      this.dispatch();
    });
  }

  async close() {
    this.closed = true;
    this.queue.forEach((job) => {
      job.reject(new Error('SPZ crop worker pool was closed.'));
    });
    this.queue = [];
    this.callbacks.forEach((job) => {
      job.reject(new Error('SPZ crop worker pool was closed.'));
    });
    this.callbacks.clear();

    await Promise.all(
      this.workers.map((worker) =>
        worker.terminate().catch(() => undefined),
      ),
    );
    this.idleWorkers = [];
    this.workers = [];
  }
}

module.exports = {
  SPLAT_CROP_WORKER_COUNT,
  SplatCropWorkerPool,
};
