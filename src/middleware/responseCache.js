/**
 * Express middleware – short-lived Redis response cache for GET endpoints.
 *
 * Under concurrent load (e.g. 250 VUs hitting the same user's feed) this turns
 * N identical DB queries into 1 query + (N-1) cache hits.
 *
 * Behaviour:
 *  - Only caches GET requests that return 2xx JSON.
 *  - Cache key = userId + method + originalUrl (includes query string).
 *  - Default TTL is short (10 s) so data stays fresh.
 *  - Skips caching for paths listed in SKIP_PATHS.
 *  - Gracefully degrades: if Redis is unavailable the request passes through.
 */

const { safeGet, safeSet, safeDel, getClient, isReady } = require('../services/redisClient');
const crypto = require('crypto');

// Paths that must NEVER be cached (auth, writes, real-time)
const SKIP_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/login/challenge',
  '/health',
];

const DEFAULT_TTL = Number(process.env.RESPONSE_CACHE_TTL || 10); // seconds
const DEFAULT_LOCK_TTL = Number(process.env.RESPONSE_CACHE_LOCK_TTL || 5); // seconds
const DEFAULT_WAIT_MS = Number(process.env.RESPONSE_CACHE_WAIT_MS || 250); // milliseconds

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAuthIdentity(req) {
  const authHeader = req.get('authorization') || '';
  if (!authHeader) return 'anon';

  // Hash the full header value to avoid leaking tokens into Redis keys.
  // We only need a stable identifier to vary cache entries per principal.
  const digest = crypto.createHash('sha256').update(authHeader).digest('hex').slice(0, 16);
  return `auth:${digest}`;
}

function shouldSkip(path) {
  for (const prefix of SKIP_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function responseCache(ttlSeconds = DEFAULT_TTL) {
  return async function responseCacheMiddleware(req, res, next) {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    // Skip un-cacheable paths
    const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
    if (shouldSkip(fullPath)) return next();

    // Build a cache key incorporating the authenticated identity.
    // NOTE: At this middleware position, req.user may not be populated yet.
    const identity = req.user?.id || req.user?._id || getAuthIdentity(req);
    const cacheKey = `rc:${identity}:${req.originalUrl}`;
    const lockKey = `${cacheKey}:lock`;

    // Try to serve from cache
    try {
      const cached = await safeGet(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-Cache', 'HIT');
        return res.end(cached);
      }
    } catch {
      // Redis error — fall through to normal handler
    }

    // Stampede protection: if another request is already recomputing this key,
    // wait briefly for it to populate cache instead of hammering Mongo.
    try {
      let haveLock = false;

      if (isReady()) {
        // SET key value NX EX <ttl>
        const c = getClient();
        const ok = await c.set(lockKey, '1', 'NX', 'EX', DEFAULT_LOCK_TTL);
        haveLock = ok === 'OK';
      }

      if (!haveLock) {
        const deadline = Date.now() + DEFAULT_WAIT_MS;
        while (Date.now() < deadline) {
          const cachedLater = await safeGet(cacheKey);
          if (cachedLater) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('X-Cache', 'HIT');
            return res.end(cachedLater);
          }
          await sleep(25);
        }
      }

      // Keep whether we acquired lock so we can release after caching.
      res.locals.__responseCacheHaveLock = haveLock;
    } catch {
      // If lock/wait fails, just proceed.
    }

    // Monkey-patch res.json to intercept the response body
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const serialized = JSON.stringify(body);
        const jitter = Math.floor(Math.random() * 3); // small jitter to reduce synchronized expiry
        safeSet(cacheKey, serialized, Math.max(1, Number(ttlSeconds) + jitter)).catch(() => { });
        if (res.locals.__responseCacheHaveLock) {
          safeDel(lockKey).catch(() => { });
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = responseCache;
