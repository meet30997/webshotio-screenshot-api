import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { BrowserManager } from './src/browser/browserManager.js';
import { config, publicConfigSnapshot } from './src/config.js';
import { createLogger } from './src/logger.js';
import { createRateLimitMiddleware } from './src/middleware/rateLimit.js';
import { QueueClosedError, QueueSaturatedError, TaskQueue } from './src/queue/taskQueue.js';
import { assertPublicHttpUrl, UrlPolicyError } from './src/security/urlPolicy.js';
import { ValidationError, validateScreenshotQuery } from './src/validation.js';

const logger = createLogger(config.logLevel, { service: 'webshotio' });
const app = express();

if (config.trustProxy) {
  app.set('trust proxy', true);
}

app.disable('x-powered-by');

const browserManager = new BrowserManager({
  logger,
  launchArgs: config.chromiumArgs,
  executablePath: config.puppeteerExecutablePath,
  headless: config.headless,
});

const screenshotQueue = new TaskQueue({
  concurrency: config.maxConcurrentJobs,
  maxQueueSize: config.maxQueueSize,
  taskTimeoutMs: config.jobTimeoutMs,
  logger,
});

const allowAllOrigins = config.corsOrigins.includes('*');

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);

app.use(
  cors({
    origin: allowAllOrigins ? true : config.corsOrigins,
    methods: ['GET', 'OPTIONS'],
    maxAge: 600,
  }),
);

app.use((req, res, next) => {
  req.setTimeout(config.requestTimeoutMs);
  res.setTimeout(config.requestTimeoutMs, () => {
    if (!res.headersSent) {
      res.status(504).json({
        error: 'REQUEST_TIMEOUT',
        message: 'Request timed out.',
      });
    }
  });

  next();
});

app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = performance.now();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    logger.info('request.completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      queue: screenshotQueue.getStats(),
    });
  });

  next();
});

const screenshotRateLimiter = createRateLimitMiddleware({
  windowMs: config.rateLimitWindowMs,
  maxRequests: config.rateLimitMax,
  logger,
  trustProxy: config.trustProxy,
});

let shuttingDown = false;
let server;

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    queue: screenshotQueue.getStats(),
    browser: browserManager.getStats(),
  });
});

app.get('/ready', (req, res) => {
  const isReady = !shuttingDown && screenshotQueue.getStats().accepting;

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'draining',
    queue: screenshotQueue.getStats(),
    browser: browserManager.getStats(),
  });
});

app.get('/screenshot', screenshotRateLimiter, async (req, res, next) => {
  const requestLogger = logger.child({ requestId: req.requestId });

  try {
    if (shuttingDown) {
      throw new QueueClosedError('Server is restarting. Please retry shortly.');
    }

    const screenshotRequest = validateScreenshotQuery(req.query, config);
    await assertPublicHttpUrl(screenshotRequest.url, {
      blockPrivateNetwork: config.blockPrivateNetwork,
    });

    const imageBuffer = await screenshotQueue.enqueue(() =>
      browserManager.captureScreenshot({
        targetUrl: screenshotRequest.url.toString(),
        width: screenshotRequest.width,
        height: screenshotRequest.height,
        waitMs: screenshotRequest.waitMs,
        navigationTimeoutMs: config.navigationTimeoutMs,
        screenshotTimeoutMs: config.screenshotTimeoutMs,
        userAgent: config.userAgent,
      }),
    );

    if (req.destroyed || res.headersSent) {
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (screenshotRequest.downloadFilename) {
      const encodedFileName = encodeURIComponent(screenshotRequest.downloadFilename);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${screenshotRequest.downloadFilename}"; filename*=UTF-8''${encodedFileName}`,
      );
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }

    res.send(imageBuffer);
  } catch (error) {
    requestLogger.warn('screenshot.failed', {
      message: error.message,
      code: error.code || 'UNKNOWN',
      statusCode: error.statusCode || 500,
    });

    next(error);
  }
});

function mapErrorToResponse(error) {
  if (
    error instanceof ValidationError
    || error instanceof UrlPolicyError
    || error instanceof QueueSaturatedError
    || error instanceof QueueClosedError
  ) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error?.name === 'TimeoutError') {
    return {
      statusCode: error.statusCode || 504,
      code: error.code || 'TIMEOUT',
      message: 'The target page took too long to process.',
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Failed to generate screenshot.',
  };
}

app.use((error, req, res, next) => {
  const mappedError = mapErrorToResponse(error);

  if (mappedError.statusCode >= 500) {
    logger.error('request.error', {
      requestId: req.requestId,
      path: req.originalUrl,
      method: req.method,
      code: mappedError.code,
      statusCode: mappedError.statusCode,
      message: error?.message,
    });
  }

  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(mappedError.statusCode).json({
    error: mappedError.code,
    message: mappedError.message,
  });
});

async function closeHttpServer() {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info('shutdown.started', { signal });
  screenshotQueue.stopAccepting();

  const hardExitTimer = setTimeout(() => {
    logger.error('shutdown.force_exit', { signal });
    process.exit(1);
  }, config.shutdownTimeoutMs + 2000);
  hardExitTimer.unref();

  try {
    await closeHttpServer();
    await screenshotQueue.drain(config.shutdownTimeoutMs);
    await browserManager.close();

    clearTimeout(hardExitTimer);
    logger.info('shutdown.completed', { signal });
    process.exit(0);
  } catch (error) {
    clearTimeout(hardExitTimer);
    logger.error('shutdown.failed', { signal, message: error.message });
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', {
    message: error.message,
  });
  void gracefulShutdown('UNCAUGHT_EXCEPTION');
});

server = app.listen(config.port, () => {
  logger.info('server.started', {
    port: config.port,
    config: publicConfigSnapshot(),
  });
});

server.requestTimeout = config.requestTimeoutMs;
server.headersTimeout = config.requestTimeoutMs + 5000;
server.keepAliveTimeout = 5000;

if (config.prewarmBrowser) {
  browserManager.getBrowser().catch((error) => {
    logger.warn('browser.prewarm_failed', {
      message: error.message,
    });
  });
}
