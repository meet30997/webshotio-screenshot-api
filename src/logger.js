const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return {};
  }

  return meta;
}

export function createLogger(level = 'info', bindings = {}) {
  const threshold = LOG_LEVEL_ORDER[level] ?? LOG_LEVEL_ORDER.info;

  function write(logLevel, message, meta) {
    if ((LOG_LEVEL_ORDER[logLevel] ?? Number.MAX_SAFE_INTEGER) < threshold) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level: logLevel,
      message,
      ...bindings,
      ...normalizeMeta(meta),
    };

    const line = `${JSON.stringify(payload)}\n`;
    if (logLevel === 'error') {
      process.stderr.write(line);
      return;
    }

    process.stdout.write(line);
  }

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (childBindings = {}) => createLogger(level, { ...bindings, ...childBindings }),
  };
}
