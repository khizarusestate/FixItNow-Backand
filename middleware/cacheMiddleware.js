import { getCache, setCache, deleteCache, deleteCachePattern, isRedisAvailable } from '../utils/cache.js';
import logger from '../utils/logger.js';

/**
 * Cache middleware factory
 * Creates middleware that caches GET requests
 * @param {string} keyPrefix - Prefix for cache keys
 * @param {number} ttlSeconds - Time to live in seconds (default: 1 hour)
 * @param {Function} keyGenerator - Optional custom key generator function
 */
export const cacheMiddleware = (keyPrefix, ttlSeconds = 3600, keyGenerator = null) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip caching if Redis is not available
    if (!isRedisAvailable()) {
      return next();
    }

    try {
      // Generate cache key
      const cacheKey = keyGenerator 
        ? keyGenerator(req)
        : `${keyPrefix}:${req.originalUrl}:${JSON.stringify(req.query)}`;

      // Try to get cached response
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        logger.debug(`Cache hit for key: ${cacheKey}`);
        res.setHeader('X-Cache', 'HIT');
        return res.json(cachedData);
      }

      // Cache miss - store original json method
      const originalJson = res.json.bind(res);

      // Override json method to cache response
      res.json = function(data) {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          setCache(cacheKey, data, ttlSeconds)
            .then(() => logger.debug(`Cached response for key: ${cacheKey}`))
            .catch(err => logger.error(`Error caching response:`, err));
        }
        
        res.setHeader('X-Cache', 'MISS');
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      next();
    }
  };
};

/**
 * Cache invalidation middleware
 * Invalidates cache when data is modified
 * @param {string} pattern - Cache key pattern to invalidate
 */
export const invalidateCacheMiddleware = (pattern) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to invalidate cache on success
    res.json = function(data) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        deleteCachePattern(pattern)
          .then(count => {
            if (count > 0) {
              logger.info(`Invalidated ${count} cache keys matching pattern: ${pattern}`);
            }
          })
          .catch(err => logger.error('Error invalidating cache:', err));
      }
      
      return originalJson(data);
    };

    next();
  };
};

/**
 * Cache by ID middleware
 * Caches responses keyed by resource ID
 * @param {string} keyPrefix - Prefix for cache keys
 * @param {number} ttlSeconds - Time to live in seconds
 */
export const cacheByIdMiddleware = (keyPrefix, ttlSeconds = 3600) => {
  return cacheMiddleware(
    keyPrefix,
    ttlSeconds,
    (req) => `${keyPrefix}:${req.params.id}`
  );
};

/**
 * Cache by user middleware
 * Caches responses keyed by user ID
 * @param {string} keyPrefix - Prefix for cache keys
 * @param {number} ttlSeconds - Time to live in seconds
 */
export const cacheByUserMiddleware = (keyPrefix, ttlSeconds = 1800) => {
  return cacheMiddleware(
    keyPrefix,
    ttlSeconds,
    (req) => {
      const userId = req.user?.id || req.admin?.id || 'anonymous';
      return `${keyPrefix}:user:${userId}:${req.originalUrl}`;
    }
  );
};

/**
 * Short-term cache middleware
 * For frequently changing data (short TTL)
 * @param {string} keyPrefix - Prefix for cache keys
 * @param {number} ttlSeconds - Time to live in seconds (default: 5 minutes)
 */
export const shortTermCacheMiddleware = (keyPrefix, ttlSeconds = 300) => {
  return cacheMiddleware(keyPrefix, ttlSeconds);
};

/**
 * Long-term cache middleware
 * For rarely changing data (long TTL)
 * @param {string} keyPrefix - Prefix for cache keys
 * @param {number} ttlSeconds - Time to live in seconds (default: 24 hours)
 */
export const longTermCacheMiddleware = (keyPrefix, ttlSeconds = 86400) => {
  return cacheMiddleware(keyPrefix, ttlSeconds);
};

/**
 * Conditional cache middleware
 * Only cache if response meets certain conditions
 * @param {string} keyPrefix - Prefix for cache keys
 * @param {number} ttlSeconds - Time to live in seconds
 * @param {Function} condition - Function that determines if response should be cached
 */
export const conditionalCacheMiddleware = (keyPrefix, ttlSeconds = 3600, condition) => {
  return async (req, res, next) => {
    if (req.method !== 'GET' || !isRedisAvailable()) {
      return next();
    }

    try {
      const cacheKey = `${keyPrefix}:${req.originalUrl}:${JSON.stringify(req.query)}`;
      const cachedData = await getCache(cacheKey);
      
      if (cachedData) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cachedData);
      }

      const originalJson = res.json.bind(res);
      res.json = function(data) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (condition ? condition(data) : true) {
            setCache(cacheKey, data, ttlSeconds)
              .then(() => logger.debug(`Conditionally cached response for key: ${cacheKey}`))
              .catch(err => logger.error('Error caching response:', err));
          }
        }
        
        res.setHeader('X-Cache', 'MISS');
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error('Conditional cache middleware error:', error);
      next();
    }
  };
};
