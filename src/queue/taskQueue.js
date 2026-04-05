function createTimeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  error.statusCode = 504;
  error.code = 'TASK_TIMEOUT';
  return error;
}

function withTimeout(promise, timeoutMs, message) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(createTimeoutError(message));
      }, timeoutMs);
      timer.unref();
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export class QueueSaturatedError extends Error {
  constructor(message = 'Server is busy. Please retry shortly.') {
    super(message);
    this.name = 'QueueSaturatedError';
    this.code = 'QUEUE_FULL';
    this.statusCode = 503;
  }
}

export class QueueClosedError extends Error {
  constructor(message = 'Server is shutting down and not accepting new jobs.') {
    super(message);
    this.name = 'QueueClosedError';
    this.code = 'QUEUE_CLOSED';
    this.statusCode = 503;
  }
}

export class TaskQueue {
  constructor({ concurrency, maxQueueSize, taskTimeoutMs, logger }) {
    this.concurrency = concurrency;
    this.maxQueueSize = maxQueueSize;
    this.taskTimeoutMs = taskTimeoutMs;
    this.logger = logger;

    this.pending = [];
    this.activeCount = 0;
    this.accepting = true;
    this.idleWaiters = [];
  }

  enqueue(taskFn) {
    if (!this.accepting) {
      throw new QueueClosedError();
    }

    if (this.pending.length >= this.maxQueueSize) {
      throw new QueueSaturatedError();
    }

    return new Promise((resolve, reject) => {
      this.pending.push({ taskFn, resolve, reject });
      this.#runNext();
    });
  }

  stopAccepting() {
    this.accepting = false;
  }

  async drain(timeoutMs = 0) {
    this.accepting = false;

    if (this.activeCount === 0 && this.pending.length === 0) {
      return;
    }

    const idlePromise = new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });

    if (!timeoutMs || timeoutMs <= 0) {
      await idlePromise;
      return;
    }

    await withTimeout(idlePromise, timeoutMs, 'Queue drain timed out.');
  }

  getStats() {
    return {
      accepting: this.accepting,
      active: this.activeCount,
      queued: this.pending.length,
      maxConcurrent: this.concurrency,
      maxQueueSize: this.maxQueueSize,
    };
  }

  #notifyIdleIfNeeded() {
    if (this.activeCount !== 0 || this.pending.length !== 0) {
      return;
    }

    if (this.idleWaiters.length === 0) {
      return;
    }

    const waiters = [...this.idleWaiters];
    this.idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  #runNext() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.activeCount += 1;

      const taskPromise = Promise.resolve().then(() => job.taskFn());

      const responsePromise = withTimeout(
        taskPromise,
        this.taskTimeoutMs,
        'Queued screenshot task timed out.',
      );

      responsePromise
        .then((result) => {
          job.resolve(result);
        })
        .catch((error) => {
          job.reject(error);
        });

      taskPromise
        .catch(() => {
          // The request promise has already been rejected by responsePromise.
          // Swallow to avoid unhandled rejections while we wait for true task completion.
        })
        .finally(() => {
          this.activeCount -= 1;
          this.#notifyIdleIfNeeded();
          this.#runNext();
        });
    }

    this.#notifyIdleIfNeeded();

    if (this.pending.length > 0 && this.activeCount >= this.concurrency) {
      this.logger.debug('queue.saturated', this.getStats());
    }
  }
}
