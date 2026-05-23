import Redis from 'ioredis';
import logger from './logger.js';

let redis = null;

export function connectRedis() {
  if (redis) {
    return redis;
  }

  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisPassword = process.env.REDIS_PASSWORD;
    
    redis = new Redis(redisUrl, {
      password: redisPassword || undefined,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      lazyConnect: true
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });

    redis.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });

    return redis;
  } catch (error) {
    logger.error('Failed to initialize Redis', { error: error.message });
    return null;
  }
}

export function getRedis() {
  return redis;
}

export async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// Redis store for rate limiting
export class RedisStore {
  constructor(options = {}) {
    this.prefix = options.prefix || 'rl:';
    this.resetExpiryOnChange = options.resetExpiryOnChange || false;
  }

  async increment(key) {
    const client = getRedis();
    if (!client) {
      throw new Error('Redis not available');
    }

    const fullKey = this.prefix + key;
    const results = await client
      .multi()
      .incr(fullKey)
      .expire(fullKey, 15 * 60) // 15 minutes
      .exec();

    if (!results) {
      throw new Error('Redis transaction failed');
    }

    const totalHits = results[0][1];
    const timeToReset = 15 * 60; // 15 minutes in seconds

    return {
      totalHits,
      timeToReset
    };
  }

  async decrement(key) {
    const client = getRedis();
    if (!client) {
      return;
    }

    const fullKey = this.prefix + key;
    await client.decr(fullKey);
  }

  async resetKey(key) {
    const client = getRedis();
    if (!client) {
      return;
    }

    const fullKey = this.prefix + key;
    await client.del(fullKey);
  }
}
