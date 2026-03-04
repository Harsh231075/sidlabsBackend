/**
 * Generic cache-aside helper built on top of redisClient.
 * 
 * Usage:
 *   const user = await cacheService.getOrSet(
 *     `user:${id}`,
 *     () => User.findById(id).lean(),
 *     60  // TTL seconds
 *   );
 */
const redis = require('./redisClient');

/**
 * Get from cache; if miss, call `fetchFn`, cache the result, return it.
 */
async function getOrSet(key, fetchFn, ttlSeconds = 60) {
  const cached = await redis.safeGet(key);
  if (cached) {
    try { return JSON.parse(cached); } catch { return cached; }
  }

  const fresh = await fetchFn();
  if (fresh !== undefined && fresh !== null) {
    await redis.safeSet(key, JSON.stringify(fresh), ttlSeconds);
  }
  return fresh;
}

/**
 * Invalidate a single key.
 */
async function invalidate(key) {
  await redis.safeDel(key);
}

/**
 * Invalidate all keys matching a pattern (e.g. `user:*`).
 */
async function invalidatePattern(pattern) {
  await redis.safeDelPattern(pattern);
}

module.exports = { getOrSet, invalidate, invalidatePattern };
