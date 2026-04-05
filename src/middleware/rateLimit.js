function getClientIp(req, trustProxy) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (trustProxy && typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createRateLimitMiddleware({ windowMs, maxRequests, logger, trustProxy = false }) {
  const buckets = new Map();
  let cleanupCounter = 0;

  return function rateLimit(req, res, next) {
    const key = getClientIp(req, trustProxy);
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(maxRequests - bucket.count, 0);

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > maxRequests) {
      logger.warn('rate_limit.exceeded', {
        ip: key,
        path: req.originalUrl,
        method: req.method,
      });

      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Rate limit exceeded. Please retry later.',
      });
    }

    cleanupCounter += 1;
    if (cleanupCounter >= 1000) {
      cleanupCounter = 0;
      for (const [storedKey, storedBucket] of buckets.entries()) {
        if (now >= storedBucket.resetAt) {
          buckets.delete(storedKey);
        }
      }
    }

    return next();
  };
}
