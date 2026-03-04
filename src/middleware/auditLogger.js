const geoip = require('geoip-lite');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');

// Country code to name mapping for common countries
const countryNames = {
  'US': 'United States', 'IN': 'India', 'GB': 'United Kingdom', 'CA': 'Canada',
  'AU': 'Australia', 'DE': 'Germany', 'FR': 'France', 'JP': 'Japan',
  'CN': 'China', 'BR': 'Brazil', 'RU': 'Russia', 'IT': 'Italy',
  'ES': 'Spain', 'MX': 'Mexico', 'KR': 'South Korea', 'NL': 'Netherlands',
  'SE': 'Sweden', 'NO': 'Norway', 'DK': 'Denmark', 'FI': 'Finland',
  'SG': 'Singapore', 'AE': 'UAE', 'SA': 'Saudi Arabia', 'PK': 'Pakistan',
  'BD': 'Bangladesh', 'ID': 'Indonesia', 'PH': 'Philippines', 'MY': 'Malaysia',
  'TH': 'Thailand', 'VN': 'Vietnam', 'ZA': 'South Africa', 'NG': 'Nigeria',
  'EG': 'Egypt', 'KE': 'Kenya', 'AR': 'Argentina', 'CL': 'Chile',
  'CO': 'Colombia', 'PE': 'Peru', 'PL': 'Poland', 'UA': 'Ukraine',
  'CZ': 'Czech Republic', 'AT': 'Austria', 'CH': 'Switzerland', 'BE': 'Belgium',
  'PT': 'Portugal', 'GR': 'Greece', 'IE': 'Ireland', 'NZ': 'New Zealand',
  'IL': 'Israel', 'TR': 'Turkey', 'HK': 'Hong Kong', 'TW': 'Taiwan',
};

function getClientIp(req) {
  // Try multiple headers for real IP (important for proxied requests)
  const headers = [
    'x-real-ip',
    'x-forwarded-for',
    'cf-connecting-ip', // Cloudflare
    'x-client-ip',
    'x-cluster-client-ip',
    'forwarded-for',
    'forwarded',
    'true-client-ip', // Akamai
  ];

  for (const header of headers) {
    const value = req.headers[header];
    if (typeof value === 'string' && value.length > 0) {
      // x-forwarded-for can have multiple IPs, take the first one
      const ip = value.split(',')[0].trim();
      // Skip localhost/private IPs if we can get a better one
      if (ip && !isPrivateIp(ip)) {
        return ip;
      }
    }
  }

  // Fallback to connection IP
  const connectionIp = req.ip || req.connection?.remoteAddress || '';

  // ::1 means localhost in IPv6
  if (connectionIp === '::1' || connectionIp === '127.0.0.1') {
    return 'localhost';
  }

  // ::ffff:127.0.0.1 is IPv4-mapped IPv6 for localhost
  if (connectionIp.startsWith('::ffff:')) {
    const ipv4 = connectionIp.slice(7);
    if (ipv4 === '127.0.0.1') return 'localhost';
    return ipv4;
  }

  return connectionIp;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === 'localhost' || ip === '::1' || ip === '127.0.0.1') return true;

  // Check for private IPv4 ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    // 10.x.x.x
    if (parts[0] === 10) return true;
    // 172.16.x.x - 172.31.x.x
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.x.x
    if (parts[0] === 192 && parts[1] === 168) return true;
  }

  return false;
}

function parseUserAgent(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };

  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  // Browser detection
  if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Opera') || ua.includes('OPR/')) browser = 'Opera';

  // OS detection
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  // Device detection
  if (ua.includes('Mobile') || ua.includes('Android')) device = 'Mobile';
  else if (ua.includes('iPad') || ua.includes('Tablet')) device = 'Tablet';

  return { browser, os, device };
}

function actionFromMethod(method, path = '') {
  const m = (method || '').toUpperCase();
  const p = (path || '').toLowerCase();

  if (p.includes('/remove') || p.includes('/delete') || p.includes('/reject') || p.includes('/unlike') || p.includes('/unfollow')) {
    return 'DELETE';
  }

  if (m === 'POST') return 'CREATE';
  if (m === 'PUT' || m === 'PATCH') return 'UPDATE';
  if (m === 'DELETE') return 'DELETE';
  return 'OTHER';
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return null;
  if (Array.isArray(body)) return { _type: 'array', length: body.length };

  // Remove sensitive fields
  const sensitiveFields = ['password', 'passwordHash', 'token', 'secret', 'apiKey', 'creditCard'];
  const sanitized = {};

  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.substring(0, 200) + '...[truncated]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function safeBodyKeys(req) {
  const body = req.body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) return ['<array>'];
  return Object.keys(body).slice(0, 50);
}

function inferResource(req) {
  const original = (req.originalUrl || '').split('?')[0];
  const withoutApi = original.startsWith('/api/') ? original.slice(5) : (original.startsWith('/') ? original.slice(1) : original);
  const parts = withoutApi.split('/').filter(Boolean);

  // Default logic: standard resource/id
  let resource = parts[0] || '';
  let resourceId = parts[1] || '';
  let parentResource = '';
  let parentResourceId = '';

  // Handle common nested patterns
  // Pattern 1: /resource/:id/subresource (e.g., /posts/123/comments)
  if (parts.length >= 3) {
    const isAction = ['like', 'unlike', 'follow', 'unfollow', 'remove', 'feature-post', 'review', 'approve', 'reject'].includes(parts[parts.length - 1]);

    if (parts[0] === 'disease-pages' || parts[0] === 'groups' || parts[0] === 'forums' || parts[0] === 'posts') {
      // Check if there's a subresource at parts[2]
      // Example 1: /forums/threads -> resource=threads
      // Example 2: /forums/threads/123/posts -> resource=posts, parent=threads

      if (parts[0] === 'forums' && parts[1] === 'threads') {
        if (parts[2] && !['like', 'report'].includes(parts[2])) {
          // It's a post in a thread
          return { resource: 'forum-posts', resourceId: parts[3] || '', parentResource: 'threads', parentResourceId: parts[2] };
        }
        return { resource: 'threads', resourceId: parts[2] || '' };
      }

      if (parts[2] && !isAction) {
        return { resource: parts[2], resourceId: parts[3] || '', parentResource: parts[0], parentResourceId: parts[1] };
      }
    }
  }

  return { resource, resourceId };
}

function generateDescription(action, resource, resourceId, method, path, body, parentResource, parentResourceId) {
  const normalizedResource = resource.toLowerCase();
  const resourceName = resource.charAt(0).toUpperCase() + resource.slice(1).replace(/s$/, '').replace(/-/g, ' ');
  const parentName = parentResource ? parentResource.charAt(0).toUpperCase() + parentResource.slice(1).replace(/s$/, '').replace(/-/g, ' ') : '';

  // Try to get a meaningful name from the body or params
  const targetName = body?.title || body?.name || body?.content?.substring(0, 50) || '';

  // Special cases/Action keywords (Highest priority)
  if (path.includes('/like')) return `Liked a ${normalizedResource.replace(/s$/, '')}${resourceId ? ` #${resourceId}` : ''}`;
  if (path.includes('/unlike')) return `Unliked a ${normalizedResource.replace(/s$/, '')}${resourceId ? ` #${resourceId}` : ''}`;
  if (path.includes('/follow')) return `Followed a ${normalizedResource.replace(/s$/, '')}${resourceId ? ` #${resourceId}` : ''}`;
  if (path.includes('/unfollow')) return `Unfollowed a ${normalizedResource.replace(/s$/, '')}${resourceId ? ` #${resourceId}` : ''}`;
  if (path.includes('/join')) return `Joined Group #${resourceId || ''}`;
  if (path.includes('/leave')) return `Left Group #${resourceId || ''}`;
  if (path.includes('/approve')) return `Approved ${resourceName}${resourceId ? ` #${resourceId}` : ''}`;
  if (path.includes('/reject') || path.includes('/remove')) return `Removed/Rejected ${resourceName}${resourceId ? ` #${resourceId}` : ''}`;

  switch (action) {
    case 'CREATE':
      if (normalizedResource === 'posts') {
        if (parentResource === 'disease-pages') return `Created post on Disease Page "${parentResourceId}"`;
        if (parentResource === 'groups') return `Created post in Group #${parentResourceId}`;
        return `Created a new post${targetName ? `: "${targetName}"` : ''}`;
      }
      if (normalizedResource === 'forum-posts') return `Replied to thread #${parentResourceId}${targetName ? `: "${targetName}"` : ''}`;
      if (normalizedResource === 'threads') return `Started a new forum thread${targetName ? `: "${targetName}"` : ''}`;
      if (normalizedResource === 'comments') return `Added a comment on ${parentName || 'Resource'}${parentResourceId ? ` #${parentResourceId}` : ''}${targetName ? `: "${targetName}"` : ''}`;
      if (normalizedResource === 'groups') return `Created group${targetName ? `: "${targetName}"` : ''}`;
      if (normalizedResource === 'disease-pages') return `Created disease page${targetName ? `: "${targetName}"` : ''}`;
      if (normalizedResource === 'messages') return `Sent a message`;
      return `Created ${resourceName}${resourceId ? ` #${resourceId}` : ''}`;

    case 'UPDATE':
      if (normalizedResource === 'users' && path.includes('/role')) return `Changed role for user #${resourceId}`;
      if (normalizedResource === 'users' && (path.includes('/suspend') || path.includes('/ban'))) return `Suspended/Banned User #${resourceId}`;
      return `Updated ${resourceName}${resourceId ? ` #${resourceId}` : ''}${targetName ? `: "${targetName}"` : ''}`;

    case 'DELETE':
      return `Deleted ${resourceName}${resourceId ? ` #${resourceId}` : ''}`;

    default:
      return `${method} ${path}`;
  }
}

// ─── Async batched audit logger ──────────────────────────────────
// Instead of an await ActivityLog.create() per request we buffer
// entries in memory and flush every FLUSH_INTERVAL_MS (or when the
// buffer reaches FLUSH_SIZE). This eliminates per-request DB write
// overhead which was the #1 bottleneck at 2k concurrent users.

const FLUSH_INTERVAL_MS = Number(process.env.AUDIT_FLUSH_MS || 3000);
const FLUSH_SIZE = Number(process.env.AUDIT_FLUSH_SIZE || 50);
let _auditBuffer = [];
let _flushTimer = null;

async function _flushAuditBuffer() {
  if (_auditBuffer.length === 0) return;
  const batch = _auditBuffer.splice(0);
  try {
    await ActivityLog.insertMany(batch, { ordered: false });
  } catch (err) {
    console.error(`auditLogger batch-flush failed (${batch.length} entries):`, err.message);
  }
}

function _ensureFlushTimer() {
  if (_flushTimer) return;
  _flushTimer = setInterval(() => {
    _flushAuditBuffer().catch(() => { });
  }, FLUSH_INTERVAL_MS);
  if (_flushTimer.unref) _flushTimer.unref(); // don't keep process alive
}

function _enqueueAuditEntry(doc) {
  _auditBuffer.push(doc);
  _ensureFlushTimer();
  if (_auditBuffer.length >= FLUSH_SIZE) {
    _flushAuditBuffer().catch(() => { });
  }
}

function auditLogger(options = {}) {
  const {
    includePathsRegex,
    excludePathsRegex = /^\/(ping|auth)(\/|$)/i,
  } = options;

  return function auditLoggerMiddleware(req, res, next) {
    const method = (req.method || '').toUpperCase();
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!isWrite) return next();

    const pathOnly = (req.originalUrl || '').split('?')[0];
    if (excludePathsRegex && excludePathsRegex.test(pathOnly)) return next();
    if (includePathsRegex && !includePathsRegex.test(pathOnly)) return next();

    const ip = getClientIp(req);
    const geo = ip && ip !== 'localhost' ? geoip.lookup(ip) : null;
    const { resource, resourceId, parentResource, parentResourceId } = inferResource(req);
    const action = actionFromMethod(method, pathOnly);
    const userAgentStr = req.headers['user-agent'] || '';
    const { browser, os, device } = parseUserAgent(userAgentStr);

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const success = statusCode >= 200 && statusCode < 400;

      // Use req.user (already resolved by auth middleware) instead of a DB query
      let actorSnapshot = null;
      let actorUserId = null;
      if (req.user?.id) {
        actorUserId = String(req.user.id);
        actorSnapshot = {
          id: actorUserId,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
        };
      }

      const sanitizedBody = sanitizeBody(req.body);
      const description = generateDescription(action, resource, resourceId, method, pathOnly, req.body, parentResource, parentResourceId);
      const targetName = req.body?.title || req.body?.name || '';

      _enqueueAuditEntry({
        actorUserId,
        actor: actorSnapshot,
        action,
        method,
        path: pathOnly,
        resource,
        resourceId,
        description,
        targetName,
        requestBody: sanitizedBody,
        statusCode,
        success,
        ip: ip || 'unknown',
        realIp: req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || ip,
        geo: geo
          ? {
            country: geo.country,
            countryName: countryNames[geo.country] || geo.country,
            region: geo.region,
            regionName: geo.region,
            city: geo.city,
            ll: geo.ll,
            timezone: geo.timezone,
          }
          : ip === 'localhost'
            ? { country: 'LOCAL', countryName: 'Localhost', city: 'Development' }
            : undefined,
        userAgent: userAgentStr,
        browser,
        os,
        device,
        params: req.params,
        query: req.query,
        bodyKeys: safeBodyKeys(req),
        errorMessage: success ? undefined : `HTTP_${statusCode}`,
        createdAt: new Date(),
      });
    });

    next();
  };
}

module.exports = auditLogger;
