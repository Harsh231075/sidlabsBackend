/**
 * AWS Cognito Authentication Module
 * 
 * This module handles JWT verification for AWS Cognito tokens.
 * It validates ID tokens received from the frontend and extracts user information.
 */

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { v4: uuidv4 } = require('uuid');

// Singleton verifier instance
let verifier = null;

/**
 * Get or create the Cognito JWT verifier (Singleton pattern)
 * @returns {Object} The Cognito JWT verifier instance
 */
function getVerifier() {
  if (!verifier) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;

    if (!userPoolId || !clientId) {
      throw new Error('Missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID in environment variables');
    }

    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'id', // Verify ID tokens (contains `sub`, `email`, groups)
      clientId,
      // Small tolerance for minor clock skew between client/server.
      clockToleranceInSeconds: 5,
    });
  }
  return verifier;
}

function mapCognitoVerifyError(error) {
  const name = error?.name || '';
  const message = String(error?.message || '');

  // Common aws-jwt-verify error names include:
  // JwtExpiredError, JwtInvalidIssuerError, JwtInvalidAudienceError, JwtInvalidSignatureError, etc.
  if (name.includes('Expired') || /expir(ed|y)/i.test(message)) {
    return { status: 401, publicMessage: 'Token expired' };
  }
  if (name.includes('InvalidAudience') || /audience/i.test(message) || /clientId/i.test(message)) {
    return { status: 401, publicMessage: 'Token audience mismatch (wrong Cognito app client)' };
  }
  if (name.includes('InvalidIssuer') || /issuer/i.test(message) || /userPool/i.test(message)) {
    return { status: 401, publicMessage: 'Token issuer mismatch (wrong Cognito user pool/region)' };
  }
  if (name.includes('InvalidSignature') || /signature/i.test(message)) {
    return { status: 401, publicMessage: 'Invalid token signature' };
  }

  // Server misconfiguration (missing env vars) should not look like an expired token.
  if (message.includes('Missing COGNITO_USER_POOL_ID') || message.includes('Missing COGNITO_CLIENT_ID')) {
    return { status: 500, publicMessage: 'Cognito is not configured on the server' };
  }

  return { status: 401, publicMessage: 'Invalid token' };
}

/**
 * Verify a Cognito ID token
 * @param {string} token - The JWT ID token
 * @returns {Promise<Object>} The decoded token payload
 */
async function verifyCognitoToken(token) {
  try {
    const payload = await getVerifier().verify(token);
    return payload;
  } catch (error) {
    const mapped = mapCognitoVerifyError(error);
    // Keep detailed logs server-side; return a clean error message to client.
    console.error('Cognito token verification failed:', {
      name: error?.name,
      message: error?.message,
    });

    const e = new Error(mapped.publicMessage);
    e.status = mapped.status;
    e.cause = error;
    throw e;
  }
}

/**
 * Extract user info from Cognito token payload
 * @param {Object} payload - The decoded token payload
 * @returns {Object} User information extracted from the token
 */
function extractUserFromPayload(payload) {
  // Map Cognito groups to our role system
  const groups = payload['cognito:groups'] || [];
  const allowedRoles = ['admin', 'moderator', 'patient'];

  // Find the first matching role from Cognito groups
  const roleType = groups.find(g => allowedRoles.includes(g)) || 'patient';

  // Map roleType to role format used in our system
  const roleMap = {
    admin: 'admin-user',
    moderator: 'moderator-user',
    patient: 'patient-user',
  };

  return {
    cognitoSub: payload.sub,
    email: payload.email || payload['cognito:username'] || payload.username,
    roleType,
    role: roleMap[roleType] || 'patient-user',
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Middleware to authenticate requests using Cognito tokens
 * Links Cognito users with MongoDB users
 */
async function authenticateCognito(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const payload = await verifyCognitoToken(token);
    const userInfo = extractUserFromPayload(payload);

    // Attach Cognito user info to request
    req.cognitoUser = userInfo;

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: ' + error.message });
  }
}

/**
 * Middleware that supports both local JWT and Cognito authentication
 * Tries Cognito first, falls back to local JWT if configured
 */
async function authenticateHybrid(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  // Check if Cognito is configured
  const useCognito = process.env.AUTH_PROVIDER === 'cognito' &&
    process.env.COGNITO_USER_POOL_ID &&
    process.env.COGNITO_CLIENT_ID;

  if (useCognito) {
    try {
      const payload = await verifyCognitoToken(token);
      const userInfo = extractUserFromPayload(payload);
      req.cognitoUser = userInfo;

      // Try to find linked MongoDB user
      const User = require('../models/User');
      let dbUser = await User.findOne({ cognitoSub: userInfo.cognitoSub });

      if (!dbUser) {
        // Try to link by email
        const emailNormalized = normalizeEmail(userInfo.email);
        dbUser = await User.findOne({ email: emailNormalized });

        if (dbUser) {
          dbUser.cognitoSub = userInfo.cognitoSub;
          dbUser.authProvider = 'cognito';
          dbUser.updatedAt = new Date();
          await dbUser.save();
        }
      }

      if (!dbUser) {
        // Auto-create user for Cognito-only mode
        const emailNormalized = normalizeEmail(userInfo.email);
        const inferredName = String(emailNormalized || '')
          .split('@')[0]
          ?.replace(/[._-]+/g, ' ')
          .trim() || 'User';

        const now = new Date();
        dbUser = await User.create({
          _id: uuidv4(),
          cognitoSub: userInfo.cognitoSub,
          name: inferredName,
          email: emailNormalized,
          passwordHash: null,
          role: userInfo.role,
          roleType: userInfo.roleType,
          authProvider: 'cognito',
          isPatient: userInfo.roleType === 'patient',
          disease: '',
          caregiverRelationship: '',
          location: '',
          bio: '',
          createdAt: now,
          updatedAt: now,
        });
      }

      req.user = {
        id: dbUser._id,
        role: dbUser.role,
        email: dbUser.email,
        name: dbUser.name,
      };

      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized: ' + error.message });
    }
  }

  // Fall back to local JWT authentication
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'winsights-dev-secret';

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = {
  verifyCognitoToken,
  extractUserFromPayload,
  authenticateCognito,
  authenticateHybrid,
  getVerifier,
};
