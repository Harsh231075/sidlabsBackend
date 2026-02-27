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

const { safeGet, safeSet } = require('../services/redisClient');
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

    // Monkey-patch res.json to intercept the response body
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const serialized = JSON.stringify(body);
        safeSet(cacheKey, serialized, ttlSeconds).catch(() => { });
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = responseCache;
