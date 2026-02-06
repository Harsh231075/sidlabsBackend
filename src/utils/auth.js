const jwt = require('jsonwebtoken');
const { authenticateHybrid } = require('./cognitoAuth');
const { toPublicUrl } = require('./publicUrl');

const JWT_SECRET = process.env.JWT_SECRET || 'winsights-dev-secret';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Local JWT authentication middleware (original implementation)
 */
function authenticateLocal(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * Smart authentication middleware that supports both local and Cognito auth
 * Uses AUTH_PROVIDER env variable to determine which method to use
 */
async function authenticate(req, res, next) {
  const authProvider = process.env.AUTH_PROVIDER || 'local';

  if (authProvider === 'cognito') {
    return authenticateHybrid(req, res, next);
  }

  // Default to local authentication
  return authenticateLocal(req, res, next);
}

function requireRole(roles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

function sanitizeUser(user) {
  // Ensure returned user has an `id` field for client consumption
  const { passwordHash, _id, id, ...rest } = user;
  const mapped = { ...rest, id: id || _id };

  // Normalize uploaded image paths to full URLs
  if ('avatarUrl' in mapped) mapped.avatarUrl = toPublicUrl(mapped.avatarUrl);
  if ('coverPhotoUrl' in mapped) mapped.coverPhotoUrl = toPublicUrl(mapped.coverPhotoUrl);

  return mapped;
}

/**
 * Optional authentication middleware
 * Sets req.user if token is valid, but doesn't block if no token
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const authProvider = process.env.AUTH_PROVIDER || 'local';
  const token = authHeader.replace('Bearer ', '');

  try {
    if (authProvider === 'cognito') {
      // Try Cognito auth
      const { verifyCognitoToken, extractUserFromPayload } = require('./cognitoAuth');
      const User = require('../models/User');

      const payload = await verifyCognitoToken(token);
      const cognitoInfo = extractUserFromPayload(payload);

      const user = await User.findOne({ cognitoSub: cognitoInfo.cognitoSub });
      if (user) {
        req.user = { id: user._id, role: user.role, email: user.email, name: user.name };
      } else {
        req.user = null;
      }
    } else {
      // Local JWT auth
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
    }
  } catch (error) {
    req.user = null;
  }

  next();
}

module.exports = { generateToken, authenticate, requireRole, sanitizeUser, optionalAuth };
