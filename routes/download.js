const express = require('express');
const router = express.Router();
const streamService = require('../services/streamService');
const cacheService = require('../services/cacheService');
const { rateLimitDownload } = require('../middleware/rateLimiter');
const { trackDownload } = require('../middleware/analytics');

/**
 * GET /download/:videoId/:quality
 * Download/stream video
 */
router.get('/download/:videoId/:quality', rateLimitDownload, trackDownload, async (req, res, next) => {
  try {
    const { videoId, quality } = req.params;

    await streamService.streamVideo(videoId, quality, req, res);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const stats = await cacheService.getStats();

    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      cache: stats
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * GET /stats
 * Cache statistics endpoint
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await cacheService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
