const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function parseIntegerEnv(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer.`);
  }

  if (min !== undefined && parsed < min) {
    throw new Error(`Environment variable ${name} must be >= ${min}.`);
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`Environment variable ${name} must be <= ${max}.`);
  }

  return parsed;
}

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const normalized = raw.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(`Environment variable ${name} must be a boolean.`);
}

function parseCsvEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return [...fallback];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseCorsOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (raw === undefined || raw.trim() === '' || raw.trim() === '*') {
    return ['*'];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const logLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase().trim();
if (!VALID_LOG_LEVELS.has(logLevel)) {
  throw new Error('Environment variable LOG_LEVEL must be one of: debug, info, warn, error.');
}

export const config = Object.freeze({
  port: parseIntegerEnv('PORT', 3000, { min: 1, max: 65535 }),
  logLevel,
  trustProxy: parseBooleanEnv('TRUST_PROXY', false),
  blockPrivateNetwork: parseBooleanEnv('BLOCK_PRIVATE_NETWORK', true),
  requestTimeoutMs: parseIntegerEnv('REQUEST_TIMEOUT_MS', 45000, { min: 2000, max: 180000 }),
  navigationTimeoutMs: parseIntegerEnv('NAVIGATION_TIMEOUT_MS', 30000, { min: 1000, max: 120000 }),
  screenshotTimeoutMs: parseIntegerEnv('SCREENSHOT_TIMEOUT_MS', 15000, { min: 1000, max: 60000 }),
  defaultWaitMs: parseIntegerEnv('DEFAULT_WAIT_MS', 0, { min: 0, max: 30000 }),
  maxWaitMs: parseIntegerEnv('MAX_WAIT_MS', 15000, { min: 0, max: 60000 }),
  jobTimeoutMs: parseIntegerEnv('JOB_TIMEOUT_MS', 40000, { min: 1000, max: 120000 }),
  shutdownTimeoutMs: parseIntegerEnv('SHUTDOWN_TIMEOUT_MS', 20000, { min: 1000, max: 120000 }),
  defaultWidth: parseIntegerEnv('DEFAULT_WIDTH', 1280, { min: 320, max: 7680 }),
  defaultHeight: parseIntegerEnv('DEFAULT_HEIGHT', 800, { min: 240, max: 7680 }),
  minWidth: parseIntegerEnv('MIN_WIDTH', 320, { min: 1, max: 7680 }),
  maxWidth: parseIntegerEnv('MAX_WIDTH', 2560, { min: 320, max: 7680 }),
  minHeight: parseIntegerEnv('MIN_HEIGHT', 240, { min: 1, max: 7680 }),
  maxHeight: parseIntegerEnv('MAX_HEIGHT', 1600, { min: 240, max: 7680 }),
  maxConcurrentJobs: parseIntegerEnv('MAX_CONCURRENT_JOBS', 8, { min: 1, max: 64 }),
  maxQueueSize: parseIntegerEnv('MAX_QUEUE_SIZE', 200, { min: 1, max: 10000 }),
  rateLimitWindowMs: parseIntegerEnv('RATE_LIMIT_WINDOW_MS', 60000, { min: 1000, max: 900000 }),
  rateLimitMax: parseIntegerEnv('RATE_LIMIT_MAX', 120, { min: 1, max: 100000 }),
  corsOrigins: parseCorsOrigins(),
  chromiumArgs: parseCsvEnv('CHROMIUM_ARGS', [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ]),
  headless: parseBooleanEnv('PUPPETEER_HEADLESS', true),
  userAgent: process.env.SCREENSHOT_USER_AGENT?.trim() || '',
  prewarmBrowser: parseBooleanEnv('PREWARM_BROWSER', true),
});

if (config.defaultWidth < config.minWidth || config.defaultWidth > config.maxWidth) {
  throw new Error('DEFAULT_WIDTH must be within MIN_WIDTH and MAX_WIDTH.');
}

if (config.defaultHeight < config.minHeight || config.defaultHeight > config.maxHeight) {
  throw new Error('DEFAULT_HEIGHT must be within MIN_HEIGHT and MAX_HEIGHT.');
}

if (config.defaultWaitMs > config.maxWaitMs) {
  throw new Error('DEFAULT_WAIT_MS must be less than or equal to MAX_WAIT_MS.');
}

export function publicConfigSnapshot() {
  return {
    port: config.port,
    logLevel: config.logLevel,
    trustProxy: config.trustProxy,
    blockPrivateNetwork: config.blockPrivateNetwork,
    requestTimeoutMs: config.requestTimeoutMs,
    navigationTimeoutMs: config.navigationTimeoutMs,
    screenshotTimeoutMs: config.screenshotTimeoutMs,
    defaultWaitMs: config.defaultWaitMs,
    maxWaitMs: config.maxWaitMs,
    jobTimeoutMs: config.jobTimeoutMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    minWidth: config.minWidth,
    maxWidth: config.maxWidth,
    minHeight: config.minHeight,
    maxHeight: config.maxHeight,
    maxConcurrentJobs: config.maxConcurrentJobs,
    maxQueueSize: config.maxQueueSize,
    rateLimitWindowMs: config.rateLimitWindowMs,
    rateLimitMax: config.rateLimitMax,
    corsOrigins: config.corsOrigins,
    prewarmBrowser: config.prewarmBrowser,
  };
}
