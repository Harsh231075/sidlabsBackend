

const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const { sanitizeUser } = require('../utils/auth');
const { verifyCognitoToken, extractUserFromPayload } = require('../utils/cognitoAuth');
const { generateUsername } = require('./profileController');
const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');

// Cognito client for admin operations
const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.REGION || 'eu-north-1',
});

/**
 * Add user to Cognito group
 */
async function addUserToCognitoGroup(username, groupName) {
  try {
    const command = new AdminAddUserToGroupCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: username,
      GroupName: groupName,
    });
    await cognitoClient.send(command);
    console.log(`Added user ${username} to Cognito group: ${groupName}`);
  } catch (error) {
    console.error(`Failed to add user to Cognito group: ${error.message}`);
    throw error;
  }
}


function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}


async function registerUser(req, res, next) {
  try {
    const { cognitoSub, name, email, roleType = 'patient', disease = '', caregiverRelationship = '', location = '', bio = '' } = req.body;

    // Validate required fields
    if (!cognitoSub || !name || !email) {
      return res.status(400).json({ error: 'cognitoSub, name, and email are required' });
    }

    // Valid roles that map to Cognito groups
    const validRoles = ['admin', 'caregiver', 'moderator', 'patient', 'researcher'];
    const normalizedRole = validRoles.includes(roleType) ? roleType : 'patient';

    const emailNormalized = normalizeEmail(email);

    // Step 1: Add user to Cognito group (use cognitoSub - that's the Cognito username/sub)
    try {
      await addUserToCognitoGroup(cognitoSub, normalizedRole);
    } catch (cognitoError) {
      console.error('Failed to add user to Cognito group:', cognitoError);
      // Continue with registration even if group assignment fails
    }

    // Step 2: Only create DB user if role is 'patient' (social app users only)
    if (normalizedRole !== 'patient') {
      console.log(`User ${email} registered with role ${normalizedRole} - no DB entry (non-patient)`);
      return res.status(201).json({
        message: `User registered successfully as ${normalizedRole}. Added to Cognito group.`,
        user: { email: emailNormalized, name, roleType: normalizedRole, cognitoSub }
      });
    }

    // Check if user already exists
    let user = await User.findOne({ cognitoSub });
    if (user) {
      return res.status(409).json({ error: 'User already registered' });
    }

    // Check if email already exists
    const existingEmail = await User.findOne({ email: emailNormalized });
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Generate unique username
    const username = await generateUsername(name, emailNormalized);

    // Create new user in database (only for patients)
    const now = new Date();
    user = await User.create({
      _id: uuidv4(),
      cognitoSub,
      username,
      name,
      email: emailNormalized,
      passwordHash: null,
      role: 'patient-user',
      roleType: 'patient',
      authProvider: 'cognito',
      isPatient: true,
      disease,
      caregiverRelationship,
      location,
      bio,
      healthInterests: disease ? [disease] : [],
      followersCount: 0,
      followingCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`Registered new patient user: ${user.email} with username: ${user.username}`);

    return res.status(201).json({
      message: 'User registered successfully',
      user: sanitizeUser(user.toObject())
    });
  } catch (error) {
    console.error('Registration error:', error);
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}


async function cognitoLogin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '').trim();

    // Verify the Cognito ID token
    const payload = await verifyCognitoToken(token);
    const cognitoUserInfo = extractUserFromPayload(payload);

    console.log('Cognito user info:', cognitoUserInfo);

    // Find user by Cognito sub (primary lookup)
    let user = await User.findOne({ cognitoSub: cognitoUserInfo.cognitoSub });

    if (!user) {
      // Try to find by email and auto-link
      const emailNormalized = normalizeEmail(cognitoUserInfo.email);
      user = await User.findOne({ email: emailNormalized });

      if (user) {
        // Auto-link existing user to Cognito
        user.cognitoSub = cognitoUserInfo.cognitoSub;
        user.authProvider = 'cognito';
        user.updatedAt = new Date();
        await user.save();
        console.log(`Auto-linked existing user: ${user.email}`);
      }
    }

    if (!user) {
      // Auto-create new user on first Cognito login
      const emailNormalized = normalizeEmail(cognitoUserInfo.email);
      const inferredName = String(emailNormalized || '')
        .split('@')[0]
        ?.replace(/[._-]+/g, ' ')
        .trim() || 'User';

      // Generate unique username
      const username = await generateUsername(inferredName, emailNormalized);

      const now = new Date();
      user = await User.create({
        _id: uuidv4(),
        cognitoSub: cognitoUserInfo.cognitoSub,
        username,
        name: inferredName,
        email: emailNormalized,
        passwordHash: null,
        role: cognitoUserInfo.role,
        roleType: cognitoUserInfo.roleType,
        authProvider: 'cognito',
        isPatient: cognitoUserInfo.roleType === 'patient',
        disease: '',
        caregiverRelationship: '',
        location: '',
        bio: '',
        healthInterests: [],
        followersCount: 0,
        followingCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`Created new user: ${user.email} with username: ${user.username}`);
    }

    // Ensure existing users have a username
    if (!user.username) {
      user.username = await generateUsername(user.name, user.email);
      await user.save();
      console.log(`Generated username for existing user: ${user.username}`);
    }

    if (user.suspended) {
      return res.status(403).json({ error: 'Account suspended. Please contact support.' });
    }

    return res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    console.error('Cognito login error:', error);

    const status = error?.status || 401;
    const isProd = process.env.NODE_ENV === 'production';

    // Prefer explicit server-side messages from cognitoAuth.verifyCognitoToken
    const publicMessage = error?.message || 'Unauthorized';

    if (!isProd) {
      return res.status(status).json({
        error: publicMessage,
        details: {
          name: error?.cause?.name || error?.name,
          message: error?.cause?.message || error?.message,
        },
      });
    }

    return res.status(status).json({ error: publicMessage });
  }
}

module.exports = {
  getMe,
  cognitoLogin,
  registerUser,
};
