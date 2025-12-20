const fs = require('fs');
const path = require('path');

const STORAGE_PATH = process.env.STORAGE_PATH || '/tmp/video-cache';
const MAX_CACHE_SIZE_GB = parseInt(process.env.MAX_CACHE_SIZE_GB || '10', 10);
const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_GB * 1024 * 1024 * 1024;

// Ensure storage directory exists
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_PATH)) {
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
    console.log(`✓ Created cache directory: ${STORAGE_PATH}`);
  }
}

// Get file path for a video ID
function getFilePath(videoId, quality = 'hd') {
  return path.join(STORAGE_PATH, `${videoId}_${quality}.mp4`);
}

// Get total cache size
function getCacheSize() {
  try {
    const files = fs.readdirSync(STORAGE_PATH);
    let totalSize = 0;

    files.forEach(file => {
      const filePath = path.join(STORAGE_PATH, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    });

    return totalSize;
  } catch (error) {
    console.error('Error calculating cache size:', error.message);
    return 0;
  }
}

// Get all cached files with metadata
function getCachedFiles() {
  try {
    const files = fs.readdirSync(STORAGE_PATH);
    return files.map(file => {
      const filePath = path.join(STORAGE_PATH, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        path: filePath,
        size: stats.size,
        accessed: stats.atime,
        modified: stats.mtime
      };
    });
  } catch (error) {
    console.error('Error getting cached files:', error.message);
    return [];
  }
}

// Check if cache is near capacity
function isNearCapacity(threshold = 0.9) {
  const currentSize = getCacheSize();
  return currentSize >= (MAX_CACHE_SIZE_BYTES * threshold);
}

module.exports = {
  STORAGE_PATH,
  MAX_CACHE_SIZE_BYTES,
  ensureStorageDir,
  getFilePath,
  getCacheSize,
  getCachedFiles,
  isNearCapacity
};
