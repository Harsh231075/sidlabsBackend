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

function actionFromMethod(method) {
  const m = (method || '').toUpperCase();
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
  const withoutApi = original.startsWith('/api/') ? original.slice(4) : original;
  const parts = withoutApi.split('/').filter(Boolean);
  const resource = parts[0] || '';
  const resourceId = parts[1] || '';
  return { resource, resourceId };
}

function generateDescription(action, resource, resourceId, method, path, body) {
  const resourceName = resource.charAt(0).toUpperCase() + resource.slice(1).replace(/s$/, '');

  // Try to get a meaningful name from the body
  const targetName = body?.title || body?.name || body?.content?.substring(0, 50) || '';

  switch (action) {
    case 'CREATE':
      if (resource === 'posts') return `Created a new post${targetName ? `: "${targetName}"` : ''}`;
      if (resource === 'comments') return `Added a comment${targetName ? `: "${targetName}"` : ''}`;
      if (resource === 'groups') return `Created group${targetName ? `: "${targetName}"` : ''}`;
      if (resource === 'disease-pages') return `Created disease page${targetName ? `: "${targetName}"` : ''}`;
      if (resource === 'events') return `Created event${targetName ? `: "${targetName}"` : ''}`;
      if (resource === 'messages') return `Sent a message`;
      if (path.includes('/like')) return `Liked a ${resource.replace(/s$/, '')}`;
      if (path.includes('/follow')) return `Followed a ${resource.replace(/s$/, '')}`;
      if (path.includes('/join')) return `Joined a group`;
      return `Created ${resourceName}${resourceId ? ` #${resourceId}` : ''}`;

    case 'UPDATE':
      if (resource === 'users' && path.includes('/role')) return `Changed user role${targetName ? ` for "${targetName}"` : ''}`;
      if (resource === 'users' && path.includes('/suspend')) return `Suspended user${targetName ? `: "${targetName}"` : ''}`;
      if (path.includes('/approve')) return `Approved ${resourceName}`;
      if (path.includes('/reject')) return `Rejected ${resourceName}`;
      return `Updated ${resourceName}${resourceId ? ` #${resourceId}` : ''}${targetName ? `: "${targetName}"` : ''}`;

    case 'DELETE':
      if (path.includes('/unlike')) return `Unliked a ${resource.replace(/s$/, '')}`;
      if (path.includes('/unfollow')) return `Unfollowed a ${resource.replace(/s$/, '')}`;
      if (path.includes('/leave')) return `Left a group`;
      return `Deleted ${resourceName}${resourceId ? ` #${resourceId}` : ''}`;

    default:
      return `${method} ${path}`;
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
    const { resource, resourceId } = inferResource(req);
    const action = actionFromMethod(method);
    const userAgentStr = req.headers['user-agent'] || '';
    const { browser, os, device } = parseUserAgent(userAgentStr);

    res.on('finish', async () => {
      try {
        const statusCode = res.statusCode;
        const success = statusCode >= 200 && statusCode < 400;

        let actorSnapshot = null;
        let actorUserId = null;

        if (req.user?.id) {
          actorUserId = String(req.user.id);
          const dbUser = await User.findById(actorUserId).lean();
          if (dbUser) {
            actorSnapshot = {
              id: dbUser._id || dbUser.id,
              name: dbUser.name,
              email: dbUser.email,
              username: dbUser.username,
              role: dbUser.role,
            };
          } else {
            actorSnapshot = {
              id: String(req.user.id),
              name: req.user.name,
              email: req.user.email,
              role: req.user.role,
            };
          }
        }

        const sanitizedBody = sanitizeBody(req.body);
        const description = generateDescription(action, resource, resourceId, method, pathOnly, req.body);
        const targetName = req.body?.title || req.body?.name || '';

        await ActivityLog.create({
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
              regionName: geo.region, // geoip-lite doesn't have region names
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
        });
      } catch (err) {
        console.error('auditLogger failed:', err);
      }
    });

    next();
  };
}

module.exports = auditLogger;
