import Redis from 'ioredis';
import logger from './logger.js';

let redisClient = null;

/**
 * Initialize Redis connection
 * @returns {Promise<Redis|null>}
 */
export async function initRedis() {
  if (redisClient && redisClient.status === 'ready') {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL;
  const redisPassword = process.env.REDIS_PASSWORD;

  if (!redisUrl) {
    logger.warn('Redis URL not configured. Caching will be disabled.');
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      password: redisPassword,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });

    redisClient.on('close', () => {
      logger.warn('Redis connection closed');
    });

    // Test connection
    await redisClient.ping();
    logger.info('Redis connection test successful');
    
    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    redisClient = null;
    return null;
  }
}

/**
 * Get Redis client instance
 * @returns {Redis|null}
 */
export function getRedisClient() {
  return redisClient;
}

/**
 * Check if Redis is available
 * @returns {boolean}
 */
export function isRedisAvailable() {
  return redisClient && redisClient.status === 'ready';
}

/**
 * Set cache with TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to cache (will be JSON stringified)
 * @param {number} ttlSeconds - Time to live in seconds
 * @returns {Promise<boolean>}
 */
export async function setCache(key, value, ttlSeconds = 3600) {
  if (!isRedisAvailable()) {
    return false;
  }

  try {
    const serializedValue = JSON.stringify(value);
    await redisClient.setex(key, ttlSeconds, serializedValue);
    return true;
  } catch (error) {
    logger.error(`Error setting cache for key ${key}:`, error);
    return false;
  }
}

/**
 * Get cached value
 * @param {string} key - Cache key
 * @returns {Promise<any|null>}
 */
export async function getCache(key) {
  if (!isRedisAvailable()) {
    return null;
  }

  try {
    const value = await redisClient.get(key);
    if (value === null) {
      return null;
    }
    return JSON.parse(value);
  } catch (error) {
    logger.error(`Error getting cache for key ${key}:`, error);
    return null;
  }
}

/**
 * Delete cache key
 * @param {string} key - Cache key
 * @returns {Promise<boolean>}
 */
export async function deleteCache(key) {
  if (!isRedisAvailable()) {
    return false;
  }

  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    logger.error(`Error deleting cache for key ${key}:`, error);
    return false;
  }
}

/**
 * Delete multiple cache keys by pattern
 * @param {string} pattern - Cache key pattern (e.g., "services:*")
 * @returns {Promise<number>} Number of keys deleted
 */
export async function deleteCachePattern(pattern) {
  if (!isRedisAvailable()) {
    return 0;
  }

  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length === 0) {
      return 0;
    }
    await redisClient.del(keys);
    return keys.length;
  } catch (error) {
    logger.error(`Error deleting cache pattern ${pattern}:`, error);
    return 0;
  }
}

/**
 * Set cache with hash structure for complex objects
 * @param {string} key - Cache key
 * @param {object} fields - Object fields to cache
 * @param {number} ttlSeconds - Time to live in seconds
 * @returns {Promise<boolean>}
 */
export async function setCacheHash(key, fields, ttlSeconds = 3600) {
  if (!isRedisAvailable()) {
    return false;
  }

  try {
    await redisClient.hset(key, fields);
    await redisClient.expire(key, ttlSeconds);
    return true;
  } catch (error) {
    logger.error(`Error setting cache hash for key ${key}:`, error);
    return false;
  }
}

/**
 * Get cache hash
 * @param {string} key - Cache key
 * @returns {Promise<object|null>}
 */
export async function getCacheHash(key) {
  if (!isRedisAvailable()) {
    return null;
  }

  try {
    const value = await redisClient.hgetall(key);
    if (Object.keys(value).length === 0) {
      return null;
    }
    return value;
  } catch (error) {
    logger.error(`Error getting cache hash for key ${key}:`, error);
    return null;
  }
}

/**
 * Increment counter in cache
 * @param {string} key - Cache key
 * @param {number} increment - Amount to increment (default: 1)
 * @returns {Promise<number|null>} New value
 */
export async function incrementCache(key, increment = 1) {
  if (!isRedisAvailable()) {
    return null;
  }

  try {
    return await redisClient.incrby(key, increment);
  } catch (error) {
    logger.error(`Error incrementing cache for key ${key}:`, error);
    return null;
  }
}

/**
 * Get or set cache pattern
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Function to fetch data if cache miss
 * @param {number} ttlSeconds - Time to live in seconds
 * @returns {Promise<any>}
 */
export async function getOrSetCache(key, fetchFn, ttlSeconds = 3600) {
  const cached = await getCache(key);
  if (cached !== null) {
    return cached;
  }

  const data = await fetchFn();
  if (data !== null && data !== undefined) {
    await setCache(key, data, ttlSeconds);
  }
  
  return data;
}

/**
 * Close Redis connection
 * @returns {Promise<void>}
 */
export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await closeRedis();
});

process.on('SIGINT', async () => {
  await closeRedis();
});
