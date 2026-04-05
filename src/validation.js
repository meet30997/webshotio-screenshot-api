export class ValidationError extends Error {
  constructor(message, code = 'BAD_REQUEST') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.statusCode = 400;
  }
}

function readSingleQueryValue(query, key) {
  const value = query[key];
  if (Array.isArray(value)) {
    throw new ValidationError(`Query parameter ${key} must not be repeated.`, 'INVALID_QUERY');
  }

  return value;
}

function parseDimension(rawValue, {
  key,
  defaultValue,
  min,
  max,
  errorCode = 'INVALID_DIMENSION',
}) {
  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }

  if (typeof rawValue !== 'string' || !/^\d+$/.test(rawValue)) {
    throw new ValidationError(`${key} must be a whole number.`, errorCode);
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (parsed < min || parsed > max) {
    throw new ValidationError(`${key} must be between ${min} and ${max}.`, errorCode);
  }

  return parsed;
}

function sanitizeDownloadFilename(rawValue) {
  const normalizedInput = typeof rawValue === 'string' ? rawValue.trim() : '';
  const fallback = 'screenshot';

  let safeBase = normalizedInput
    .replace(/\.[pP][nN][gG]$/u, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!safeBase) {
    safeBase = fallback;
  }

  safeBase = safeBase.slice(0, 120);
  return `${safeBase}.png`;
}

export function validateScreenshotQuery(query, options) {
  const rawUrl = readSingleQueryValue(query, 'url');
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new ValidationError('Valid url parameter is required.', 'INVALID_URL');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new ValidationError('Invalid URL format.', 'INVALID_URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ValidationError('Only http and https URLs are supported.', 'INVALID_URL');
  }

  const width = parseDimension(readSingleQueryValue(query, 'width'), {
    key: 'width',
    defaultValue: options.defaultWidth,
    min: options.minWidth,
    max: options.maxWidth,
  });

  const height = parseDimension(readSingleQueryValue(query, 'height'), {
    key: 'height',
    defaultValue: options.defaultHeight,
    min: options.minHeight,
    max: options.maxHeight,
  });

  const hasWaitMs = Object.prototype.hasOwnProperty.call(query, 'waitMs');
  const hasWait = Object.prototype.hasOwnProperty.call(query, 'wait');
  if (hasWaitMs && hasWait) {
    throw new ValidationError('Use either waitMs or wait, not both.', 'INVALID_WAIT');
  }

  const rawWaitMs = hasWaitMs
    ? readSingleQueryValue(query, 'waitMs')
    : hasWait
      ? readSingleQueryValue(query, 'wait')
      : undefined;

  const waitMs = parseDimension(rawWaitMs, {
    key: 'waitMs',
    defaultValue: options.defaultWaitMs,
    min: 0,
    max: options.maxWaitMs,
    errorCode: 'INVALID_WAIT',
  });

  const hasDownload = Object.prototype.hasOwnProperty.call(query, 'download');
  const rawDownload = hasDownload ? readSingleQueryValue(query, 'download') : undefined;
  if (rawDownload !== undefined && typeof rawDownload !== 'string') {
    throw new ValidationError('download must be a string when provided.', 'INVALID_DOWNLOAD');
  }

  return {
    url: parsedUrl,
    width,
    height,
    waitMs,
    downloadFilename: hasDownload ? sanitizeDownloadFilename(rawDownload) : null,
  };
}
