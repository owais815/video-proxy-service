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

      // Try quality-specific key first, then fallback to videoId-only key for backward compatibility
      const sourceKey = `video:source:${videoId}:${quality}`;
      const fallbackKey = `video:source:${videoId}`;

      let sourceData = await this.redis.get(sourceKey);
      if (!sourceData) {
        // Fallback to quality-agnostic key for backward compatibility
        sourceData = await this.redis.get(fallbackKey);
      }

      if (!sourceData) {
        throw new Error(`Video source not found for ${videoId} (${quality}) - URL may have expired`);
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
      let { originalUrl, headers: sourceHeaders, platform } = source;

      // Prepare request headers
      const requestHeaders = {
        ...sourceHeaders,
        'Range': req.headers.range || undefined
      };

      // For TikTok, ensure proper headers and handle proxy URLs
      if (platform === 'tiktok') {
        requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        requestHeaders['Referer'] = 'https://www.tiktok.com/';

        // TikTok proxy URLs need special handling - the robotilab.xyz URL returns 400
        // This suggests we should resolve it differently or the URL format is wrong
        if (originalUrl.includes('robotilab.xyz/download-api') || originalUrl.includes('download-api')) {
          console.log(`[TikTok] Detected proxy URL, attempting to resolve...`);
          console.log(`[TikTok] Original URL: ${originalUrl}`);

          // The robotilab.xyz service might be broken or require different handling
          // Try to extract the actual TikTok video URL from the query parameter
          try {
            const urlObj = new URL(originalUrl);
            const videoUrlParam = urlObj.searchParams.get('videoUrl');

            if (videoUrlParam) {
              console.log(`[TikTok] Found videoUrl parameter: ${videoUrlParam}`);
              // Instead of using the proxy URL, we should fetch the video directly from TikTok
              // But we don't have direct access to TikTok CDN URLs from the API response
              // So we'll try the proxy URL with proper error handling
              console.log(`[TikTok] Will attempt to stream from proxy URL with error handling`);
            }
          } catch (urlParseError) {
            console.log(`[TikTok] Could not parse URL: ${urlParseError.message}`);
          }

          // Note: The robotilab.xyz proxy is returning 400, which suggests it might be:
          // 1. Blocking our requests
          // 2. Requiring different headers/parameters
          // 3. Temporarily unavailable
          // We'll try to stream it anyway and handle the error gracefully
        }
      }

      // Stream from CDN (or resolved URL)
      const response = await axios.get(originalUrl, {
        responseType: 'stream',
        headers: requestHeaders,
        timeout: 300000, // 5 minutes
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400, // Accept redirects
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
        const status = error.response.status;

        // Special handling for TikTok proxy URLs
        if (status === 400 && originalUrl.includes('robotilab.xyz')) {
          return res.status(503).json({
            error: 'TikTok video temporarily unavailable',
            message: 'The video source is currently blocked by the provider. This is a known issue with the TikTok API returning proxy URLs. Please try again in a few minutes or contact support.',
            retryAfter: 300, // 5 minutes
            issue: 'proxy_url_blocked',
            solution: 'Consider switching to a TikTok API that returns direct CDN URLs. See TIKTOK_DOWNLOAD_SOLUTION.md for details.'
          });
        }

        res.status(status).json({
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
  async getVideoMetadata(videoId, quality = null) {
    if (!this.redis) return null;

    try {
      // If quality is provided, try quality-specific key first
      if (quality) {
        const sourceKey = `video:source:${videoId}:${quality}`;
        const sourceData = await this.redis.get(sourceKey);
        if (sourceData) {
          return JSON.parse(sourceData);
        }
      }

      // Fallback to quality-agnostic key
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
