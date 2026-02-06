const { v4: uuidv4 } = require("uuid");
const User = require("../models/User");
const { sanitizeUser } = require("../utils/auth");
const {
  verifyCognitoToken,
  extractUserFromPayload,
} = require("../utils/cognitoAuth");
const { generateUsername } = require("./profileController");
const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { sendWelcomeEmail } = require("../services/emailService");
const jwt = require("jsonwebtoken");

// Cognito client for admin operations
const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.REGION || "eu-north-1",
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
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isRoleAllowedForSocial(role) {
  // Only these roles can access Winsights Social.
  return role === "patient" || role === "moderator" || role === "admin" || role === 'caregiver';;
}

function extractRoleFromDecodedIdToken(decoded) {
  return decoded?.["cognito:groups"]?.[0] || "user";
}

function inferNameFromEmail(emailNormalized) {
  return (
    String(emailNormalized || "")
      .split("@")[0]
      ?.replace(/[._-]+/g, " ")
      .trim() || "User"
  );
}

async function findLinkOrCreateUserFromCognito({
  cognitoSub,
  emailNormalized,
  role,
  sendWelcomeEmailOnCreate,
  shouldLog,
}) {
  // Find user by Cognito sub (primary lookup)
  let user = await User.findOne({ cognitoSub });

  if (!user) {
    // Try to find by email and auto-link
    user = await User.findOne({ email: emailNormalized });

    if (user) {
      user.cognitoSub = cognitoSub;
      user.authProvider = "cognito";
      user.updatedAt = new Date();
      await user.save();
      if (shouldLog) console.log(`Auto-linked existing user: ${user.email}`);
    }
  }

  if (!user) {
    // Auto-create new user on first Cognito login
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
      authProvider: "cognito",
      isPatient: role === "patient",
      disease: "",
      caregiverRelationship: "",
      location: "",
      bio: "",
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
        console.error("Failed to send welcome email:", err),
      );
    }
  }

  // Ensure existing users have a username
  if (!user.username) {
    user.username = await generateUsername(user.name, user.email);
    await user.save();
    if (shouldLog) console.log(`Generated username for existing user: ${user.username}`);
  }

  return user;
}

function setAuthCookies(res, auth) {
  //  res.cookie("winsights_auth", auth.IdToken, {
  //     domain: ".sidlabs.net",
  //     httpOnly: true,
  //     secure: true,
  //     sameSite: "none",
  //     maxAge: auth.ExpiresIn * 1000,
  //   });

  res.cookie("winsights_auth", auth.IdToken, {
    domain: ".sidlabs.net",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 60 * 60 * 1000,
  });

  res.cookie("winsights_access", auth.AccessToken, {
    domain: ".sidlabs.net",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 15 * 60 * 1000, // access token = short lived
  });

  // res.cookie("winsights_access", auth.AccessToken, {
  //   domain: "localhost",
  //   secure: false,
  //   sameSite: "lax",
  //   maxAge: auth.ExpiresIn * 1000,
  // });

  // res.cookie("winsights_auth", auth.IdToken, {
  //   domain: "localhost",
  //   secure: false,
  //   sameSite: "lax",
  //   maxAge: auth.ExpiresIn * 1000,
  // });
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
  res,
  auth,
  blockedRoleMessage,
  sendWelcomeEmailOnCreate,
  shouldLog,
}) {
  if (!auth?.IdToken) {
    return res.status(401).json({ error: "Auth failed" });
  }

  const decoded = jwt.decode(auth.IdToken);
  if (!decoded?.sub) {
    return res.status(401).json({ error: "Invalid token" });
  }

  const emailNormalized = normalizeEmail(decoded.email);
  const cognitoSub = decoded.sub;
  const role = extractRoleFromDecodedIdToken(decoded);

  // Block access for caregiver/researcher (and any other non-allowed roles)
  if (!isRoleAllowedForSocial(role)) {
    return res.status(403).json({
      error: blockedRoleMessage || "You do not have access to this platform.",
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
    return res
      .status(403)
      .json({ error: "Account suspended. Please contact support." });
  }

  setAuthCookies(res, auth);

  return res.json({
    user: sanitizeUser(user.toObject()),
    tokens: buildTokenPayload(auth),
  });
}

// async function getPrimaryCognitoGroup(username) {
//   // Best-effort lookup; if it fails, caller can fallback to token groups.
//   try {
//     if (!process.env.COGNITO_USER_POOL_ID) return null;
//     if (!username) return null;

//     const cmd = new AdminListGroupsForUserCommand({
//       UserPoolId: process.env.COGNITO_USER_POOL_ID,
//       Username: username,
//     });

//     const resp = await cognitoClient.send(cmd);
//     const groupName = resp?.Groups?.[0]?.GroupName;
//     return groupName || null;
//   } catch (err) {
//     return null;
//   }
// }

async function registerUser(req, res, next) {
  try {
    const {
      cognitoSub,
      name,
      email,
      roleType = "patient",
      disease = "",
      caregiverRelationship = "",
      location = "",
      bio = "",
    } = req.body;

    // Validate required fields
    if (!cognitoSub || !name || !email) {
      return res
        .status(400)
        .json({ error: "cognitoSub, name, and email are required" });
    }

    // Valid roles that map to Cognito groups
    const validRoles = [
      "admin",
      "caregiver",
      "moderator",
      "patient",
      "researcher",
    ];
    const normalizedRole = validRoles.includes(roleType) ? roleType : "patient";

    const emailNormalized = normalizeEmail(email);

    // Step 1: Add user to Cognito group (use cognitoSub - that's the Cognito username/sub)
    try {
      await addUserToCognitoGroup(cognitoSub, normalizedRole);
    } catch (cognitoError) {
      console.error("Failed to add user to Cognito group:", cognitoError);
      // Continue with registration even if group assignment fails
    }

    // Step 2: Only create DB user if role is 'patient' (social app users only)
    if (normalizedRole !== "patient") {
      console.log(
        `User ${email} registered with role ${normalizedRole} - no DB entry (non-patient)`,
      );

      // Send welcome email
      sendWelcomeEmail({
        email: emailNormalized,
        name,
        roleType: normalizedRole,
      }).catch((err) => console.error("Failed to send welcome email:", err));

      return res.status(201).json({
        message: `User registered successfully as ${normalizedRole}. Added to Cognito group.`,
        user: {
          email: emailNormalized,
          name,
          roleType: normalizedRole,
          cognitoSub,
        },
      });
    }

    // Check if user already exists
    let user = await User.findOne({ cognitoSub });
    if (user) {
      return res.status(409).json({ error: "User already registered" });
    }

    // Check if email already exists
    const existingEmail = await User.findOne({ email: emailNormalized });
    if (existingEmail) {
      return res.status(409).json({ error: "Email already registered" });
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
      role: "patient-user",
      roleType: "patient",
      authProvider: "cognito",
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

    // Send welcome email
    sendWelcomeEmail(user).catch((err) =>
      console.error("Failed to send welcome email:", err),
    );

    return res.status(201).json({
      message: "User registered successfully",
      user: sanitizeUser(user.toObject()),
    });
  } catch (error) {
    console.error("Registration error:", error);
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

// async function getUser(req, res) {
//   const token = req.cookies?.winsights_session;
//   if (!token) return res.status(401).end();

//   try {
//     const decoded = jwt.decode(token);
//     const user = await User.findOne({ cognitoSub: decoded.sub });

//     if (!user) return res.status(404).end();

//     return res.json({
//       user: sanitizeUser(user.toObject()),
//       token, // idToken
//     });
//   } catch {
//     return res.status(401).end();
//   }
// }


async function getUser(req, res) {
  const idToken = req.cookies?.winsights_auth;
  const accessToken = req.cookies?.winsights_access;
  if (!idToken || !accessToken) return res.status(401).end();

  try {
    const decoded = jwt.decode(idToken);

    if (!decoded || !decoded.sub || !decoded.exp) {
      return res.status(401).end();
    }

    // ⏰ EXPIRATION CHECK
    if (decoded.exp * 1000 < Date.now()) {
      return res.status(401).json({ error: "Token expired" });
    }

    const user = await User.findOne({ cognitoSub: decoded.sub });
    if (!user) return res.status(404).end();

    return res.json({
      user: sanitizeUser(user.toObject()),
      token: idToken, // ID token (UI)
      accessToken: accessToken || null, // 🔥 Access token for APIs
    });
  } catch (err) {
    return res.status(401).end();
  }
}

/// implement first login user autocreate logic , and password reset logic here ....
async function cognitoLogin(req, res, next) {
  const { email, password } = req.body;

  console.log("cognitoLogin", { email, hasPassword: Boolean(password) });

  try {
    const command = new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: process.env.COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const result = await cognitoClient.send(command);

    // For manually-created Cognito users, first login often returns NEW_PASSWORD_REQUIRED
    if (result?.ChallengeName) {
      return res.status(200).json({
        challengeName: result.ChallengeName,
        session: result.Session || null,
        username: email,
      });
    }

    const auth = result.AuthenticationResult;

    return await issueCognitoLoginSuccess({
      res,
      auth,
      blockedRoleMessage: "You do not have access to this platform.",
      sendWelcomeEmailOnCreate: true,
      shouldLog: true,
    });
  } catch (error) {
    console.error("Cognito login error:", error);

    const status = error?.status || 401;
    const isProd = process.env.NODE_ENV === "production";

    // Prefer explicit server-side messages from cognitoAuth.verifyCognitoToken
    const publicMessage = error?.message || "Unauthorized";

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

async function respondToAuthChallenge(req, res) {
  const { username, session, newPassword } = req.body;

  if (!username || !session || !newPassword) {
    return res
      .status(400)
      .json({ error: "username, session, newPassword are required" });
  }

  try {
    const command = new RespondToAuthChallengeCommand({
      ClientId: process.env.COGNITO_CLIENT_ID,
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: newPassword,
      },
    });

    const result = await cognitoClient.send(command);

    if (result?.ChallengeName) {
      return res.status(400).json({
        error: "Additional challenge required",
        challengeName: result.ChallengeName,
        session: result.Session || null,
      });
    }

    const auth = result.AuthenticationResult;
    return await issueCognitoLoginSuccess({
      res,
      auth,
      blockedRoleMessage:
        "Password updated, but you do not have access to this platform.",
      // Keep behavior same as before: challenge path does NOT send welcome email on create.
      sendWelcomeEmailOnCreate: false,
      shouldLog: false,
    });
  } catch (error) {
    console.error("respondToAuthChallenge error:", error);
    const status = error?.status || 400;
    return res
      .status(status)
      .json({ error: error?.message || "Challenge response failed" });
  }
}
// ------------------------------------- finish login controller ---------//////




function logout(req, res) {
  // res.clearCookie("winsights_auth", {
  //   httpOnly: true,
  //   sameSite: "lax",
  //   secure: false,
  // });

  // res.clearCookie("winsights_access", {
  //   httpOnly: true,
  //   sameSite: "lax",
  //   secure: false,
  // });

  res.clearCookie("winsights_auth", {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    domain: ".sidlabs.net",
  });

  res.clearCookie("winsights_access", {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    domain: ".sidlabs.net",
  });

  return res.json({ success: true });
}

module.exports = {
  getMe,
  cognitoLogin,
  respondToAuthChallenge,
  registerUser,
  getUser,
  logout,
};
