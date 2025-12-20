const fs = require('fs');
const { getRedisClient } = require('../config/redis');
const { getFilePath, getCachedFiles, getCacheSize, MAX_CACHE_SIZE_BYTES, isNearCapacity } = require('../config/storage');

class CacheService {
  constructor() {
    this.redis = null;
    this.initialize();
  }

  initialize() {
    try {
      this.redis = getRedisClient();
    } catch (error) {
      console.error('Cache service initialization failed:', error);
      this.redis = null;
    }
  }

  /**
   * Check if video exists in file cache
   * @param {string} videoId - Video ID
   * @param {string} quality - Video quality
   * @returns {Promise<string|null>} - File path or null
   */
  async getFile(videoId, quality = 'hd') {
    const filePath = getFilePath(videoId, quality);

    // Check if file exists on disk
    if (!fs.existsSync(filePath)) {
      return null;
    }

    // Update access stats in Redis
    if (this.redis) {
      const cacheKey = `cache:index:${videoId}:${quality}`;
      try {
        await this.redis.hincrby(cacheKey, 'accessCount', 1);
        await this.redis.hset(cacheKey, 'lastAccess', Date.now());
      } catch (error) {
        console.error('Failed to update cache stats:', error.message);
      }
    }

    return filePath;
  }

  /**
   * Create write stream for caching video
   * @param {string} videoId - Video ID
   * @param {string} quality - Video quality
   * @returns {fs.WriteStream}
   */
  createWriteStream(videoId, quality = 'hd') {
    const filePath = getFilePath(videoId, quality);
    const writeStream = fs.createWriteStream(filePath);

    writeStream.on('finish', async () => {
      const stats = fs.statSync(filePath);

      // Index in Redis
      if (this.redis) {
        const cacheKey = `cache:index:${videoId}:${quality}`;
        try {
          await this.redis.hset(cacheKey, {
            filePath,
            size: stats.size,
            accessCount: 0,
            lastAccess: Date.now(),
            createdAt: Date.now()
          });
          await this.redis.expire(cacheKey, 86400); // 24 hours TTL

          console.log(`✓ Cached video: ${videoId} (${quality}) - ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        } catch (error) {
          console.error('Failed to index cached file:', error.message);
        }
      }

      // Check if cache cleanup is needed
      if (isNearCapacity(0.9)) {
        console.warn('Cache near capacity - triggering cleanup');
        this.cleanupCache().catch(err => console.error('Cleanup failed:', err));
      }
    });

    writeStream.on('error', (error) => {
      console.error(`Cache write error for ${videoId}:`, error.message);
      // Clean up partial file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    return writeStream;
  }

  /**
   * Clean up cache using LRU eviction
   * @returns {Promise<void>}
   */
  async cleanupCache() {
    try {
      const files = getCachedFiles();
      const currentSize = getCacheSize();

      if (currentSize < MAX_CACHE_SIZE_BYTES * 0.8) {
        return; // No cleanup needed
      }

      console.log(`Starting cache cleanup - Current size: ${(currentSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

      // Sort by access time (LRU)
      files.sort((a, b) => a.accessed - b.accessed);

      let freedSpace = 0;
      const targetFree = MAX_CACHE_SIZE_BYTES * 0.3; // Free 30% of cache
      const deletedFiles = [];

      for (const file of files) {
        if (freedSpace >= targetFree) break;

        try {
          fs.unlinkSync(file.path);
          freedSpace += file.size;
          deletedFiles.push(file.name);

          // Remove from Redis index
          if (this.redis) {
            const videoId = file.name.split('_')[0];
            const quality = file.name.split('_')[1]?.replace('.mp4', '') || 'hd';
            await this.redis.del(`cache:index:${videoId}:${quality}`);
          }
        } catch (error) {
          console.error(`Failed to delete ${file.name}:`, error.message);
        }
      }

      console.log(`✓ Cache cleanup complete - Freed ${(freedSpace / 1024 / 1024 / 1024).toFixed(2)} GB (${deletedFiles.length} files)`);
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    const currentSize = getCacheSize();
    const files = getCachedFiles();

    let totalAccessCount = 0;
    if (this.redis) {
      try {
        const keys = await this.redis.keys('cache:index:*');
        for (const key of keys) {
          const count = await this.redis.hget(key, 'accessCount');
          totalAccessCount += parseInt(count || 0, 10);
        }
      } catch (error) {
        console.error('Failed to get cache stats:', error.message);
      }
    }

    return {
      totalFiles: files.length,
      totalSize: currentSize,
      totalSizeGB: (currentSize / 1024 / 1024 / 1024).toFixed(2),
      maxSizeGB: (MAX_CACHE_SIZE_BYTES / 1024 / 1024 / 1024).toFixed(2),
      utilizationPercent: ((currentSize / MAX_CACHE_SIZE_BYTES) * 100).toFixed(2),
      totalAccess: totalAccessCount
    };
  }

  /**
   * Delete specific cached file
   * @param {string} videoId - Video ID
   * @param {string} quality - Video quality
   * @returns {Promise<boolean>}
   */
  async deleteFile(videoId, quality = 'hd') {
    const filePath = getFilePath(videoId, quality);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      if (this.redis) {
        await this.redis.del(`cache:index:${videoId}:${quality}`);
      }

      return true;
    } catch (error) {
      console.error(`Failed to delete cached file ${videoId}:`, error.message);
      return false;
    }
  }
}

module.exports = new CacheService();
