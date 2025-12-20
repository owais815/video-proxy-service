const Redis = require('ioredis');

let redisClient = null;

function createRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  try {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      console.warn('REDIS_URL not configured. Caching disabled.');
      return null;
    }

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      }
    });

    redisClient.on('connect', () => {
      console.log('✓ Proxy Service: Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      console.error('Proxy Service: Redis connection error:', err.message);
    });

    redisClient.on('close', () => {
      console.warn('Proxy Service: Redis connection closed');
    });

    return redisClient;
  } catch (error) {
    console.error('Failed to create Redis client:', error);
    return null;
  }
}

function getRedisClient() {
  if (!redisClient) {
    return createRedisClient();
  }
  return redisClient;
}

async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

module.exports = {
  createRedisClient,
  getRedisClient,
  closeRedis
};
