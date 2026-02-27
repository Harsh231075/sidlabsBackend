const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const User = require('../../models/User');
const { sanitizeUser } = require('../../utils/auth');
const { sendWelcomeEmail } = require('../../services/emailService');
const { httpError } = require('../../utils/httpError');

const { generateUsername } = require('../profile/profile.service');

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.REGION || 'eu-north-1',
});

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

function isRoleAllowedForSocial(role) {
  return role === 'patient' || role === 'moderator' || role === 'admin' || role === 'caregiver' || role === 'researcher';
}

function extractRoleFromDecodedIdToken(decoded) {
  return decoded?.['cognito:groups']?.[0] || 'user';
}

function inferNameFromEmail(emailNormalized) {
  return (
    String(emailNormalized || '')
      .split('@')[0]
      ?.replace(/[._-]+/g, ' ')
      .trim() || 'User'
  );
}

async function findLinkOrCreateUserFromCognito({
  cognitoSub,
  emailNormalized,
  role,
  sendWelcomeEmailOnCreate,
  shouldLog,
}) {
  let user = await User.findOne({ cognitoSub });

  if (!user) {
    user = await User.findOne({ email: emailNormalized });

    if (user) {
      user.cognitoSub = cognitoSub;
      user.authProvider = 'cognito';
      user.updatedAt = new Date();
      await user.save();
      if (shouldLog) console.log(`Auto-linked existing user: ${user.email}`);
    }
  }

  if (!user) {
    const inferredName = inferNameFromEmail(emailNormalized);
    const username = await generateUsername(inferredName, emailNormalized);

    const now = new Date();
    user = await User.create({
      _id: uuidv4(),
      cognitoSub: cognitoSub,
      username,
      name: inferredName,
      email: emailNormalized,
      passwordHash: null,
      role: `${role}-user`,
      roleType: role,
      authProvider: 'cognito',
      isPatient: role === 'patient',
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

    if (shouldLog) {
      console.log(`Created new user: ${user.email} with username: ${user.username}`);
    }

    if (sendWelcomeEmailOnCreate) {
      sendWelcomeEmail(user).catch((err) =>
        console.error('Failed to send welcome email:', err),
      );
    }
  }

  if (!user.username) {
    user.username = await generateUsername(user.name, user.email);
    await user.save();
    if (shouldLog) console.log(`Generated username for existing user: ${user.username}`);
  }

  return user;
}

function buildCookiesToSet(auth) {
  return [

    {
      name: 'winsights_access',
      value: auth.AccessToken,
      options: {
        domain: 'localhost',
        secure: false,
        sameSite: 'lax',
        maxAge: auth.ExpiresIn * 1000,
      },
    },
    {
      name: 'winsights_auth',
      value: auth.IdToken,
      options: {
        domain: 'localhost',
        secure: false,
        sameSite: 'lax',
        maxAge: auth.ExpiresIn * 1000,
      },
    },
  ];
}

function buildTokenPayload(auth) {
  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
    expiresAt: Date.now() + auth.ExpiresIn * 1000,
  };
}

async function issueCognitoLoginSuccess({
  auth,
  blockedRoleMessage,
  sendWelcomeEmailOnCreate,
  shouldLog,
}) {
  if (!auth?.IdToken) {
    throw httpError(401, { error: 'Auth failed' });
  }

  const decoded = jwt.decode(auth.IdToken);
  if (!decoded?.sub) {
    throw httpError(401, { error: 'Invalid token' });
  }

  const emailNormalized = normalizeEmail(decoded.email);
  const cognitoSub = decoded.sub;
  const role = extractRoleFromDecodedIdToken(decoded);

  if (!isRoleAllowedForSocial(role)) {
    throw httpError(403, {
      error: blockedRoleMessage || 'You do not have access to this platform.',
    });
  }

  const user = await findLinkOrCreateUserFromCognito({
    cognitoSub,
    emailNormalized,
    role,
    sendWelcomeEmailOnCreate,
    shouldLog,
  });

  if (user.suspended) {
    throw httpError(403, { error: 'Account suspended. Please contact support.' });
  }

  return {
    cookiesToSet: buildCookiesToSet(auth),
    body: {
      user: sanitizeUser(user.toObject()),
      tokens: buildTokenPayload(auth),
    },
  };
}

async function registerUser(body) {
  const {
    cognitoSub,
    name,
    email,
    roleType = 'patient',
    disease = '',
    caregiverRelationship = '',
    location = '',
    bio = '',
  } = body || {};

  if (!cognitoSub || !name || !email) {
    throw httpError(400, { error: 'cognitoSub, name, and email are required' });
  }

  const validRoles = ['admin', 'caregiver', 'moderator', 'patient', 'researcher'];
  const normalizedRole = validRoles.includes(roleType) ? roleType : 'patient';

  const emailNormalized = normalizeEmail(email);

  try {
    await addUserToCognitoGroup(cognitoSub, normalizedRole);
  } catch (cognitoError) {
    console.error('Failed to add user to Cognito group:', cognitoError);
  }

  if (normalizedRole !== 'patient') {
    console.log(
      `User ${email} registered with role ${normalizedRole} - no DB entry (non-patient)`,
    );

    sendWelcomeEmail({
      email: emailNormalized,
      name,
      roleType: normalizedRole,
    }).catch((err) => console.error('Failed to send welcome email:', err));

    return {
      _statusCode: 201,
      body: {
        message: `User registered successfully as ${normalizedRole}. Added to Cognito group.`,
        user: {
          email: emailNormalized,
          name,
          roleType: normalizedRole,
          cognitoSub,
        },
      },
    };
  }

  let user = await User.findOne({ cognitoSub });
  if (user) throw httpError(409, { error: 'User already registered' });

  const existingEmail = await User.findOne({ email: emailNormalized });
  if (existingEmail) throw httpError(409, { error: 'Email already registered' });

  const username = await generateUsername(name, emailNormalized);

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

  console.log(
    `Registered new patient user: ${user.email} with username: ${user.username}`,
  );

  sendWelcomeEmail(user).catch((err) =>
    console.error('Failed to send welcome email:', err),
  );

  return {
    _statusCode: 201,
    body: {
      message: 'User registered successfully',
      user: sanitizeUser(user.toObject()),
    },
  };
}

async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, { error: 'User not found' });
  return { body: { user: sanitizeUser(user.toObject()) } };
}

async function getUser(cookies) {
  const idToken = cookies?.winsights_auth;
  const accessToken = cookies?.winsights_access;
  if (!idToken || !accessToken) return { _end: true, _statusCode: 401 };

  try {
    const decoded = jwt.decode(idToken);

    if (!decoded || !decoded.sub || !decoded.exp) {
      return { _end: true, _statusCode: 401 };
    }

    if (decoded.exp * 1000 < Date.now()) {
      return { _statusCode: 401, body: { error: 'Token expired' } };
    }

    const user = await User.findOne({ cognitoSub: decoded.sub });
    if (!user) return { _end: true, _statusCode: 404 };

    return {
      body: {
        user: sanitizeUser(user.toObject()),
        token: idToken,
        accessToken: accessToken || null,
      },
    };
  } catch (err) {
    return { _end: true, _statusCode: 401 };
  }
}

async function cognitoLogin(body) {
  const { email, password } = body || {};

  console.log('cognitoLogin', { email, hasPassword: Boolean(password) });

  try {
    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: process.env.COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const result = await cognitoClient.send(command);

    if (result?.ChallengeName) {
      return {
        _statusCode: 200,
        body: {
          challengeName: result.ChallengeName,
          session: result.Session || null,
          username: email,
        },
      };
    }

    const auth = result.AuthenticationResult;

    const issued = await issueCognitoLoginSuccess({
      auth,
      blockedRoleMessage: 'You do not have access to this platform.',
      sendWelcomeEmailOnCreate: true,
      shouldLog: true,
    });

    return { ...issued, _statusCode: 200 };
  } catch (error) {
    console.error('Cognito login error:', error);

    const status = error?.status || 401;
    const isProd = process.env.NODE_ENV === 'production';
    const publicMessage = error?.message || 'Unauthorized';

    if (!isProd) {
      return {
        _statusCode: status,
        body: {
          error: publicMessage,
          details: {
            name: error?.cause?.name || error?.name,
            message: error?.cause?.message || error?.message,
          },
        },
      };
    }

    return { _statusCode: status, body: { error: publicMessage } };
  }
}

async function respondToAuthChallenge(body) {
  const { username, session, newPassword } = body || {};

  if (!username || !session || !newPassword) {
    return {
      _statusCode: 400,
      body: { error: 'username, session, newPassword are required' },
    };
  }

  try {
    const command = new RespondToAuthChallengeCommand({
      ClientId: process.env.COGNITO_CLIENT_ID,
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: newPassword,
      },
    });

    const result = await cognitoClient.send(command);

    if (result?.ChallengeName) {
      return {
        _statusCode: 400,
        body: {
          error: 'Additional challenge required',
          challengeName: result.ChallengeName,
          session: result.Session || null,
        },
      };
    }

    const auth = result.AuthenticationResult;
    const issued = await issueCognitoLoginSuccess({
      auth,
      blockedRoleMessage: 'Password updated, but you do not have access to this platform.',
      sendWelcomeEmailOnCreate: false,
      shouldLog: false,
    });

    return { ...issued, _statusCode: 200 };
  } catch (error) {
    console.error('respondToAuthChallenge error:', error);
    const status = error?.status || 400;
    return {
      _statusCode: status,
      body: { error: error?.message || 'Challenge response failed' },
    };
  }
}

async function forgotPassword(body) {
  const { email } = body || {};
  if (!email) return { _statusCode: 400, body: { error: 'Email is required' } };

  try {
    const command = new ForgotPasswordCommand({
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email,
    });

    await cognitoClient.send(command);
    return { body: { message: 'Password reset code sent' } };
  } catch (error) {
    console.error('Forgot password error:', error);
    return {
      _statusCode: 400,
      body: { error: error.message || 'Failed to initiate password reset' },
    };
  }
}

async function resetPassword(body) {
  const { email, code, newPassword } = body || {};

  if (!email || !code || !newPassword) {
    return {
      _statusCode: 400,
      body: { error: 'Email, code, and new password are required' },
    };
  }

  try {
    const command = new ConfirmForgotPasswordCommand({
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    });

    await cognitoClient.send(command);
    return { body: { message: 'Password has been reset successfully' } };
  } catch (error) {
    console.error('Reset password error:', error);
    return {
      _statusCode: 400,
      body: { error: error.message || 'Failed to reset password' },
    };
  }
}

async function logout() {
  return {
    cookiesToClear: [
      {
        name: 'winsights_auth',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
        },
      },
      {
        name: 'winsights_access',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
        },
      },

    ],
    body: { success: true },
  };
}

module.exports = {
  registerUser,
  cognitoLogin,
  respondToAuthChallenge,
  forgotPassword,
  resetPassword,
  getMe,
  getUser,
  logout,
};
