const DEFAULT_API_BASE = 'https://webshotio-screenshot-api.onrender.com';
const STORAGE_KEY_API_BASE = 'webshotio-api-base-v1';
const REQUEST_TIMEOUT_MS = 50000;

const LIMITS = Object.freeze({
  minWidth: 320,
  maxWidth: 2560,
  minHeight: 240,
  maxHeight: 1600,
  maxWaitMs: 15000,
});

const DEFAULTS = Object.freeze({
  width: 1280,
  height: 800,
  waitMs: 0,
});

const form = document.querySelector('#capture-form');
const apiBaseInput = document.querySelector('#api-base');
const targetUrlInput = document.querySelector('#target-url');
const widthInput = document.querySelector('#width');
const heightInput = document.querySelector('#height');
const waitInput = document.querySelector('#wait-ms');
const downloadInput = document.querySelector('#download');
const captureButton = document.querySelector('#capture-button');
const statusEl = document.querySelector('#status');
const rateLimitEl = document.querySelector('#rate-limit');
const errorEl = document.querySelector('#error');
const previewWrapEl = document.querySelector('#preview-wrap');
const previewEl = document.querySelector('#preview');
const previewMetaEl = document.querySelector('#preview-meta');
const emptyStateEl = document.querySelector('#empty-state');
const openLinkEl = document.querySelector('#open-link');
const downloadLinkEl = document.querySelector('#download-link');

let currentBlobUrl = null;

init();

function init() {
  const savedApiBase = loadApiBase();
  apiBaseInput.value = savedApiBase || DEFAULT_API_BASE;
  targetUrlInput.value = 'https://example.com';

  form.addEventListener('submit', onSubmit);
  form.addEventListener('reset', onReset);
  apiBaseInput.addEventListener('blur', persistCurrentApiBase);

  window.addEventListener('beforeunload', cleanupBlobUrl);
}

async function onSubmit(event) {
  event.preventDefault();
  clearError();

  const parsed = parseAndValidateForm();
  if (!parsed.ok) {
    setStatus('Validation failed.', 'error');
    showError(parsed.message);
    return;
  }

  const input = parsed.data;
  persistApiBase(input.apiBase);

  setBusy(true);
  setStatus('Capturing screenshot...', 'loading');

  const startedAt = performance.now();

  try {
    const result = await requestScreenshot(input);
    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));

    renderPreview(result, input.downloadName);
    updateRateLimit(result.headers);
    setStatus(`Capture complete in ${elapsedMs}ms.`, 'success');
  } catch (error) {
    renderRequestError(error);
  } finally {
    setBusy(false);
  }
}

function onReset() {
  setTimeout(() => {
    clearError();
    setStatus('Ready to capture.', '');
    rateLimitEl.textContent = '';
    cleanupBlobUrl();
    previewEl.removeAttribute('src');
    previewWrapEl.hidden = true;
    previewMetaEl.textContent = '';
    emptyStateEl.hidden = false;

    widthInput.value = String(DEFAULTS.width);
    heightInput.value = String(DEFAULTS.height);
    waitInput.value = String(DEFAULTS.waitMs);
  }, 0);
}

function parseAndValidateForm() {
  const apiBase = normalizeBaseUrl(apiBaseInput.value);
  if (!apiBase || !isValidHttpHttpsUrl(apiBase)) {
    return { ok: false, message: 'API Base URL must be a valid http or https URL.' };
  }

  const targetUrl = targetUrlInput.value.trim();
  if (!isValidHttpHttpsUrl(targetUrl)) {
    return { ok: false, message: 'Target URL must be a valid http or https URL.' };
  }

  const widthResult = parseBoundedInteger(widthInput.value, {
    label: 'Width',
    min: LIMITS.minWidth,
    max: LIMITS.maxWidth,
    fallback: DEFAULTS.width,
  });
  if (!widthResult.ok) {
    return widthResult;
  }

  const heightResult = parseBoundedInteger(heightInput.value, {
    label: 'Height',
    min: LIMITS.minHeight,
    max: LIMITS.maxHeight,
    fallback: DEFAULTS.height,
  });
  if (!heightResult.ok) {
    return heightResult;
  }

  const waitResult = parseBoundedInteger(waitInput.value, {
    label: 'Wait',
    min: 0,
    max: LIMITS.maxWaitMs,
    fallback: DEFAULTS.waitMs,
  });
  if (!waitResult.ok) {
    return waitResult;
  }

  let downloadName = null;
  const rawDownloadName = downloadInput.value.trim();
  if (rawDownloadName) {
    downloadName = sanitizeDownloadName(rawDownloadName);
    if (!downloadName) {
      return {
        ok: false,
        message: 'Download name must include at least one letter or number.',
      };
    }

    if (downloadName !== rawDownloadName.replace(/\.[pP][nN][gG]$/u, '')) {
      downloadInput.value = downloadName;
    }
  }

  return {
    ok: true,
    data: {
      apiBase,
      targetUrl,
      width: widthResult.value,
      height: heightResult.value,
      waitMs: waitResult.value,
      downloadName,
    },
  };
}

function parseBoundedInteger(rawValue, options) {
  const { label, min, max, fallback } = options;
  const inputValue = String(rawValue ?? '').trim();

  if (!inputValue) {
    return { ok: true, value: fallback };
  }

  if (!/^\d+$/u.test(inputValue)) {
    return { ok: false, message: `${label} must be a whole number.` };
  }

  const parsed = Number.parseInt(inputValue, 10);
  if (parsed < min || parsed > max) {
    return { ok: false, message: `${label} must be between ${min} and ${max}.` };
  }

  return { ok: true, value: parsed };
}

function sanitizeDownloadName(rawValue) {
  const baseName = rawValue
    .trim()
    .replace(/\.[pP][nN][gG]$/u, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  return baseName || null;
}

function buildScreenshotUrl(input) {
  const baseUrl = ensureTrailingSlash(input.apiBase);
  const endpoint = new URL('screenshot', baseUrl);

  endpoint.searchParams.set('url', input.targetUrl);
  endpoint.searchParams.set('width', String(input.width));
  endpoint.searchParams.set('height', String(input.height));
  endpoint.searchParams.set('waitMs', String(input.waitMs));

  if (input.downloadName) {
    endpoint.searchParams.set('download', input.downloadName);
  }

  return endpoint.toString();
}

async function requestScreenshot(input) {
  const requestUrl = buildScreenshotUrl(input);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(requestUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'image/png, application/json',
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw {
        status: 504,
        code: 'CLIENT_TIMEOUT',
        message: 'The browser request timed out. Please try again.',
      };
    }

    throw {
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the API. Check the API URL and CORS settings.',
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const apiError = await parseApiError(response);
    throw {
      status: response.status,
      code: apiError.code || 'REQUEST_FAILED',
      message: apiError.message || 'Screenshot request failed.',
      headers: response.headers,
    };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('image/png')) {
    const apiError = await parseApiError(response);
    throw {
      status: response.status || 500,
      code: apiError.code || 'INVALID_RESPONSE',
      message: apiError.message || 'API did not return a PNG image.',
      headers: response.headers,
    };
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw {
      status: 500,
      code: 'EMPTY_IMAGE',
      message: 'API returned an empty image.',
      headers: response.headers,
    };
  }

  return {
    blob,
    blobUrl: URL.createObjectURL(blob),
    headers: response.headers,
  };
}

async function parseApiError(response) {
  try {
    const payload = await response.json();
    return {
      code: payload?.error || null,
      message: payload?.message || null,
    };
  } catch {
    return {
      code: null,
      message: null,
    };
  }
}

function renderPreview(result, downloadName) {
  cleanupBlobUrl();
  currentBlobUrl = result.blobUrl;

  previewEl.src = currentBlobUrl;
  openLinkEl.href = currentBlobUrl;
  downloadLinkEl.href = currentBlobUrl;
  downloadLinkEl.download = `${downloadName || 'screenshot'}.png`;

  previewWrapEl.hidden = false;
  emptyStateEl.hidden = true;

  const sizeKb = (result.blob.size / 1024).toFixed(1);
  previewMetaEl.textContent = `PNG size: ${sizeKb} KB`;
}

function renderRequestError(error) {
  updateRateLimit(error?.headers || null);

  const statusText = error?.status ? `HTTP ${error.status}` : 'Request failed';
  const codeText = error?.code ? ` (${error.code})` : '';
  const messageText = error?.message || 'Unable to generate a screenshot.';

  setStatus('Capture failed. Review the error and try again.', 'error');
  showError(`${statusText}${codeText}: ${messageText}`);
}

function setBusy(isBusy) {
  form.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  captureButton.disabled = isBusy;
  captureButton.textContent = isBusy ? 'Capturing...' : 'Capture Screenshot';
}

function setStatus(message, variant) {
  statusEl.textContent = message;
  statusEl.className = 'status';

  if (variant) {
    statusEl.classList.add(variant);
  }
}

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function updateRateLimit(headers) {
  if (!headers) {
    rateLimitEl.textContent = '';
    return;
  }

  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');

  if (!limit && !remaining && !reset) {
    rateLimitEl.textContent = '';
    return;
  }

  const segments = [];

  if (remaining && limit) {
    segments.push(`Rate limit: ${remaining}/${limit} remaining`);
  } else if (limit) {
    segments.push(`Rate limit: ${limit}`);
  }

  const resetSeconds = calculateResetSeconds(reset);
  if (resetSeconds !== null) {
    segments.push(`resets in ${resetSeconds}s`);
  }

  rateLimitEl.textContent = segments.join(' - ');
}

function calculateResetSeconds(resetEpochSeconds) {
  if (!resetEpochSeconds) {
    return null;
  }

  const parsedReset = Number.parseInt(resetEpochSeconds, 10);
  if (!Number.isFinite(parsedReset)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.max(0, parsedReset - nowSeconds);
}

function persistCurrentApiBase() {
  const normalized = normalizeBaseUrl(apiBaseInput.value);
  if (normalized && isValidHttpHttpsUrl(normalized)) {
    persistApiBase(normalized);
  }
}

function persistApiBase(value) {
  try {
    localStorage.setItem(STORAGE_KEY_API_BASE, value);
  } catch {
    // Ignore storage failures in restrictive browser modes.
  }
}

function loadApiBase() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_API_BASE);
    return normalizeBaseUrl(saved || '');
  } catch {
    return '';
  }
}

function normalizeBaseUrl(rawValue) {
  return String(rawValue || '').trim().replace(/\/+$/u, '');
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function isValidHttpHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanupBlobUrl() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}
