const { getRedisClient } = require('../config/redis');

/**
 * Analytics middleware - track download requests
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
async function trackDownload(req, res, next) {
  const startTime = Date.now();
  const { videoId, quality } = req.params;
  const ip = req.ip || req.connection.remoteAddress;

  // Track response finish
  res.on('finish', async () => {
    const duration = Date.now() - startTime;
    const cacheHit = res.getHeader('X-Cache-Status') === 'HIT';

    const analyticsData = {
      ip: hashIP(ip), // Hash IP for privacy
      videoId,
      quality,
      platform: req.query.platform || 'unknown',
      cacheHit,
      downloadDuration: duration,
      timestamp: Date.now(),
      statusCode: res.statusCode,
      bytesTransferred: res.getHeader('Content-Length') || 0
    };

    try {
      const redis = getRedisClient();
      if (redis) {
        // Buffer analytics in Redis for batch writing
        await redis.lpush('analytics:buffer', JSON.stringify(analyticsData));
        await redis.ltrim('analytics:buffer', 0, 999); // Keep last 1000
      }
    } catch (error) {
      console.error('Analytics tracking error:', error.message);
    }
  });

  next();
}

/**
 * Hash IP address for privacy
 * @param {string} ip - IP address
 * @returns {string} - Hashed IP
 */
function hashIP(ip) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

module.exports = {
  trackDownload
};
