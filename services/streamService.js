const axios = require('axios');
const fs = require('fs');
const { getRedisClient } = require('../config/redis');
const cacheService = require('./cacheService');

class StreamService {
  constructor() {
    this.redis = null;
    this.initialize();
  }

  initialize() {
    try {
      this.redis = getRedisClient();
    } catch (error) {
      console.error('Stream service initialization failed:', error);
      this.redis = null;
    }
  }

  /**
   * Stream video to client
   * @param {string} videoId - Video ID
   * @param {string} quality - Video quality
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @returns {Promise<void>}
   */
  async streamVideo(videoId, quality, req, res) {
    try {
      // 1. Check file cache first
      const cachedFile = await cacheService.getFile(videoId, quality);
      if (cachedFile) {
        console.log(`✓ Cache HIT: ${videoId} (${quality})`);
        return await this.serveFromCache(cachedFile, req, res);
      }

      console.log(`⊘ Cache MISS: ${videoId} (${quality}) - Streaming from source`);

      // 2. Get source URL and headers from Redis
      if (!this.redis) {
        throw new Error('Redis not available - cannot retrieve source URL');
      }

      const sourceKey = `video:source:${videoId}`;
      const sourceData = await this.redis.get(sourceKey);

      if (!sourceData) {
        throw new Error('Video source not found - URL may have expired');
      }

      const source = JSON.parse(sourceData);

      // 3. Stream from CDN with proper headers
      await this.streamFromSource(source, videoId, quality, req, res);

    } catch (error) {
      console.error(`Stream error for ${videoId}:`, error.message);

      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to stream video',
          message: error.message
        });
      }
    }
  }

  /**
   * Serve video from cache
   * @param {string} filePath - Path to cached file
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @returns {Promise<void>}
   */
  async serveFromCache(filePath, req, res) {
    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      // Set common headers
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Cache-Status', 'HIT');

      if (range) {
        // Handle range request
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;

        res.status(206); // Partial Content
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
      } else {
        // Full file
        res.setHeader('Content-Length', fileSize);
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      }
    } catch (error) {
      console.error('Error serving from cache:', error);
      throw error;
    }
  }

  /**
   * Stream from CDN source and cache simultaneously
   * @param {Object} source - Source data (url, headers, platform)
   * @param {string} videoId - Video ID
   * @param {string} quality - Video quality
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @returns {Promise<void>}
   */
  async streamFromSource(source, videoId, quality, req, res) {
    try {
      const { originalUrl, headers: sourceHeaders, platform } = source;

      // Prepare request headers
      const requestHeaders = {
        ...sourceHeaders,
        'Range': req.headers.range || undefined
      };

      // Stream from CDN
      const response = await axios.get(originalUrl, {
        responseType: 'stream',
        headers: requestHeaders,
        timeout: 300000, // 5 minutes
        maxRedirects: 5
      });

      // Set response headers
      res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Cache-Status', 'MISS');

      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }

      if (response.headers['content-range']) {
        res.status(206); // Partial Content
        res.setHeader('Content-Range', response.headers['content-range']);
      }

      // Create cache write stream (only if full file, not range request)
      let cacheStream = null;
      if (!req.headers.range) {
        cacheStream = cacheService.createWriteStream(videoId, quality);
      }

      // Pipe to client
      response.data.pipe(res);

      // Also pipe to cache (if not range request)
      if (cacheStream) {
        response.data.pipe(cacheStream);
      }

      // Handle errors
      response.data.on('error', (error) => {
        console.error('CDN stream error:', error.message);
        if (cacheStream) {
          cacheStream.destroy();
        }
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });

    } catch (error) {
      console.error('Stream from source error:', error.message);

      if (error.response) {
        // CDN returned an error
        res.status(error.response.status).json({
          error: 'Source unavailable',
          message: error.message
        });
      } else {
        // Network or timeout error
        res.status(504).json({
          error: 'Gateway timeout',
          message: 'Failed to reach video source'
        });
      }
    }
  }

  /**
   * Get video metadata from Redis
   * @param {string} videoId - Video ID
   * @returns {Promise<Object|null>}
   */
  async getVideoMetadata(videoId) {
    if (!this.redis) return null;

    try {
      const sourceKey = `video:source:${videoId}`;
      const sourceData = await this.redis.get(sourceKey);

      if (!sourceData) return null;

      return JSON.parse(sourceData);
    } catch (error) {
      console.error('Failed to get video metadata:', error.message);
      return null;
    }
  }
}

module.exports = new StreamService();
