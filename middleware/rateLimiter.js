const { getRedisClient } = require('../config/redis');

const RATE_LIMIT_DOWNLOAD_MAX = parseInt(process.env.RATE_LIMIT_DOWNLOAD_MAX || '10', 10);
const RATE_LIMIT_DOWNLOAD_WINDOW = parseInt(process.env.RATE_LIMIT_DOWNLOAD_WINDOW || '3600', 10);

/**
 * Rate limiter middleware for downloads
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
async function rateLimitDownload(req, res, next) {
  try {
    const redis = getRedisClient();

    if (!redis) {
      console.warn('Redis not available - skipping rate limit');
      return next();
    }

    const ip = req.ip || req.connection.remoteAddress;
    const key = `ratelimit:download:${ip}`;

    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, RATE_LIMIT_DOWNLOAD_WINDOW);
    }

    const remaining = Math.max(0, RATE_LIMIT_DOWNLOAD_MAX - current);
    const resetTime = Date.now() + (RATE_LIMIT_DOWNLOAD_WINDOW * 1000);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_DOWNLOAD_MAX);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    if (current > RATE_LIMIT_DOWNLOAD_MAX) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many download requests. Limit: ${RATE_LIMIT_DOWNLOAD_MAX} per hour`,
        limit: RATE_LIMIT_DOWNLOAD_MAX,
        remaining: 0,
        resetAt: new Date(resetTime).toISOString()
      });
    }

    next();
  } catch (error) {
    console.error('Rate limiter error:', error.message);
    // Don't block on rate limiter failure
    next();
  }
}

/**
 * Rate limiter for API calls
 */
async function rateLimitAPI(req, res, next) {
  try {
    const redis = getRedisClient();

    if (!redis) {
      return next();
    }

    const ip = req.ip || req.connection.remoteAddress;
    const key = `ratelimit:api:${ip}`;
    const limit = 30;
    const window = 900; // 15 minutes

    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, window);
    }

    const remaining = Math.max(0, limit - current);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (current > limit) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Please slow down',
        limit,
        remaining: 0
      });
    }

    next();
  } catch (error) {
    console.error('API rate limiter error:', error.message);
    next();
  }
}

module.exports = {
  rateLimitDownload,
  rateLimitAPI
};
