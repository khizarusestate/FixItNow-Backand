import logger from "./logger.js";
import env from "./env.js";

/** In-memory fallback when Redis is unavailable (single-instance). */
const memoryStore = new Map();
const MEMORY_MAX = 500;

let redisClient = null;
let redisReady = false;

function memoryGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key, value, ttlSeconds) {
  if (memoryStore.size >= MEMORY_MAX) {
    const first = memoryStore.keys().next().value;
    if (first) memoryStore.delete(first);
  }
  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

export async function initRedis() {
  if (redisClient && redisReady) {
    return redisClient;
  }

  const url = String(env.REDIS_URL || process.env.REDIS_URL || "").trim();
  if (!url) {
    logger.info("Cache: in-memory mode (set REDIS_URL for Redis)");
    return null;
  }

  try {
    const { default: Redis } = await import("ioredis");
    redisClient = new Redis(url, {
      password: env.REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    redisClient.on("error", (err) => {
      logger.warn("Redis connection error", { error: err?.message });
    });

    await redisClient.connect();
    await redisClient.ping();
    redisReady = true;
    logger.info("Cache: Redis connected");
    return redisClient;
  } catch (err) {
    logger.warn("Cache: Redis unavailable, using in-memory", {
      error: err?.message,
    });
    redisClient = null;
    redisReady = false;
    return null;
  }
}

/** Alias used by index.js startup. */
export const initCache = initRedis;

export function getRedisClient() {
  return redisClient;
}

export function isRedisAvailable() {
  return redisReady;
}

export function isRedisConnected() {
  return redisReady;
}

export async function getCache(key) {
  try {
    if (redisReady && redisClient) {
      const raw = await redisClient.get(key);
      return raw ? JSON.parse(raw) : null;
    }
    return memoryGet(key);
  } catch (err) {
    logger.warn("getCache failed", { key, error: err?.message });
    return memoryGet(key);
  }
}

export async function cacheGet(key) {
  return getCache(key);
}

export async function setCache(key, value, ttlSeconds = 3600) {
  try {
    const payload = JSON.stringify(value);
    if (redisReady && redisClient) {
      await redisClient.set(key, payload, "EX", ttlSeconds);
      return true;
    }
    memorySet(key, value, ttlSeconds);
    return true;
  } catch (err) {
    logger.warn("setCache failed", { key, error: err?.message });
    memorySet(key, value, ttlSeconds);
    return false;
  }
}

export async function cacheSet(key, value, ttlSeconds = 60) {
  return setCache(key, value, ttlSeconds);
}

export async function deleteCache(key) {
  try {
    if (redisReady && redisClient) {
      await redisClient.del(key);
    }
    memoryStore.delete(key);
    return true;
  } catch {
    memoryStore.delete(key);
    return false;
  }
}

export async function cacheDel(key) {
  return deleteCache(key);
}

async function deleteKeysByPrefix(prefix) {
  for (const key of [...memoryStore.keys()]) {
    if (key.startsWith(prefix)) memoryStore.delete(key);
  }

  if (!redisReady || !redisClient) return 0;

  let deleted = 0;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redisClient.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        50,
      );
      cursor = next;
      if (keys.length) {
        await redisClient.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
  } catch (err) {
    logger.warn("deleteKeysByPrefix failed", { prefix, error: err?.message });
  }
  return deleted;
}

export async function deleteCachePattern(pattern) {
  const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
  return deleteKeysByPrefix(prefix);
}

export async function cacheDelByPrefix(prefix) {
  return deleteKeysByPrefix(prefix);
}

export async function getOrSetCache(key, fetchFn, ttlSeconds = 3600) {
  const cached = await getCache(key);
  if (cached !== null && cached !== undefined) {
    return cached;
  }
  const data = await fetchFn();
  if (data !== null && data !== undefined) {
    await setCache(key, data, ttlSeconds);
  }
  return data;
}

export async function cacheGetOrSet(key, ttlSeconds, factory) {
  const cached = await getCache(key);
  if (cached !== null && cached !== undefined) {
    return { value: cached, hit: true };
  }
  const value = await factory();
  await setCache(key, value, ttlSeconds);
  return { value, hit: false };
}

export async function setCacheHash(key, fields, ttlSeconds = 3600) {
  if (!redisReady || !redisClient) return false;
  try {
    await redisClient.hset(key, fields);
    await redisClient.expire(key, ttlSeconds);
    return true;
  } catch (err) {
    logger.warn("setCacheHash failed", { key, error: err?.message });
    return false;
  }
}

export async function getCacheHash(key) {
  if (!redisReady || !redisClient) return null;
  try {
    const value = await redisClient.hgetall(key);
    return Object.keys(value).length === 0 ? null : value;
  } catch (err) {
    logger.warn("getCacheHash failed", { key, error: err?.message });
    return null;
  }
}

export async function incrementCache(key, increment = 1) {
  if (!redisReady || !redisClient) return null;
  try {
    return await redisClient.incrby(key, increment);
  } catch (err) {
    logger.warn("incrementCache failed", { key, error: err?.message });
    return null;
  }
}

export async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      /* ignore */
    }
  }
  redisClient = null;
  redisReady = false;
  logger.info("Redis connection closed");
}

export const closeCache = closeRedis;
