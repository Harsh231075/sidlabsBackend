const User = require('../models/User');
const { sanitizeUser } = require('../utils/auth');
const { listBadgesForUser } = require('../utils/badges');
const { blockUser, unblockUser, getBlockedUsers } = require('../utils/messaging');
const fs = require('fs');
const path = require('path');

/**
 * Get all users (admin/moderator only - though original code didn't check role, let's keep it safe but replicate original logic)
 */
async function getUsers(req, res, next) {
  try {
    const users = await User.find({}).lean();
    res.json(users.map(sanitizeUser));
  } catch (error) {
    next(error);
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Update authenticated user's profile
 */
async function updateMyProfile(req, res, next) {
  try {
    const { bio, location, disease, caregiverRelationship, avatarUrl, name, email } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (name !== undefined) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (location !== undefined) user.location = location;
    if (disease !== undefined) user.disease = disease;
    if (caregiverRelationship !== undefined) user.caregiverRelationship = caregiverRelationship;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

    // Allow updating email with normalization and uniqueness check
    if (email !== undefined) {
      const newEmail = normalizeEmail(email);
      if (newEmail !== user.email) {
        const existing = await User.findOne({ email: newEmail });
        if (existing && String(existing.id) !== String(user.id)) {
          return res.status(409).json({ error: 'Email is already in use' });
        }
        user.email = newEmail;
      }
    }
    user.updatedAt = new Date();

    await user.save();

    // Convert to object for sanitization if needed, but sanitizeUser usually takes plain object or smart enough
    // `user` is Mongoose doc. sanitizeUser expects object?
    // Let's assume sanitizeUser handles it or convert.
    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Update user profile (admin can update any user; owner can update themselves)
 */
async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    if (req.user.id !== id && req.user.role !== 'admin-user') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Apply updates from body
    const payload = req.body;
    if (payload.name !== undefined) user.name = payload.name;
    if (payload.bio !== undefined) user.bio = payload.bio;
    if (payload.location !== undefined) user.location = payload.location;
    if (payload.disease !== undefined) user.disease = payload.disease;
    if (payload.caregiverRelationship !== undefined) user.caregiverRelationship = payload.caregiverRelationship;
    if (payload.avatarUrl !== undefined) user.avatarUrl = payload.avatarUrl;

    // Allow email update with normalization and uniqueness validation
    if (payload.email !== undefined) {
      const newEmail = normalizeEmail(payload.email);
      if (newEmail !== user.email) {
        const existing = await User.findOne({ email: newEmail });
        if (existing && String(existing.id) !== String(user.id)) {
          return res.status(409).json({ error: 'Email is already in use' });
        }
        user.email = newEmail;
      }
    }

    // Also allow updating 'suspended' status if admin
    if (req.user.role === 'admin-user' && payload.suspended !== undefined) {
      user.suspended = payload.suspended;
    }

    user.updatedAt = new Date();
    await user.save();

    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user badges
 */
async function getUserBadges(req, res, next) {
  try {
    if (req.user.id !== req.params.id && req.user.role !== 'admin-user') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const badges = await listBadgesForUser(req.params.id);
    // badges is likely array of Mongoose docs or objects.
    res.json(badges);
  } catch (error) {
    next(error);
  }
}

/**
 * Block a user
 */
async function blockUserEndpoint(req, res, next) {
  try {
    const blockedUserId = req.params.id;
    if (req.user.id === blockedUserId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }
    await blockUser(req.user.id, blockedUserId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Unblock a user
 */
async function unblockUserEndpoint(req, res, next) {
  try {
    const blockedUserId = req.params.id;
    await unblockUser(req.user.id, blockedUserId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Get list of blocked users for authenticated user
 */
async function getBlockedUsersList(req, res, next) {
  try {
    const blockedUserIds = await getBlockedUsers(req.user.id);
    // blockedUserIds is array of strings
    if (blockedUserIds.length === 0) {
      return res.json([]);
    }

    const users = await User.find({ _id: { $in: blockedUserIds } }).lean();
    const blockedUsers = users.map((u) => sanitizeUser(u));
    res.json(blockedUsers);
  } catch (error) {
    next(error);
  }
}


/**
 * Upload avatar for authenticated user (accepts base64 image in JSON body)
 * Payload: { image: 'data:<mime>;base64,<data>' }
 */
const storageService = require('../services/storageService');

async function uploadAvatar(req, res, next) {
  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // support data URLs or raw base64
    let base64 = image;
    let mime = 'image/png';
    const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1];
      base64 = dataUrlMatch[2];
    }

    const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const filename = `${req.user.id}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64, 'base64');

    // Upload via storage service (local or S3), namespace under 'avatars/'
    const result = await storageService.upload({
      buffer,
      contentType: mime,
      key: `avatars/${filename}`,
    });

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.avatarUrl = result.url;
    user.updatedAt = new Date();
    await user.save();

    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Upload cover photo for authenticated user (accepts base64 image in JSON body)
 * Payload: { image: 'data:<mime>;base64,<data>' }
 */
async function uploadCover(req, res, next) {
  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    let base64 = image;
    let mime = 'image/jpeg';
    const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1];
      base64 = dataUrlMatch[2];
    }

    const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const filename = `${req.user.id}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64, 'base64');

    const result = await storageService.upload({
      buffer,
      contentType: mime,
      key: `covers/${filename}`,
    });

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.coverPhotoUrl = result.url;
    user.updatedAt = new Date();
    await user.save();

    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Remove avatar for authenticated user
 */
async function removeAvatar(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.avatarUrl = '';
    user.updatedAt = new Date();
    await user.save();

    res.json({ message: 'Avatar removed successfully', user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Remove cover photo for authenticated user
 */
async function removeCover(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.coverPhotoUrl = '';
    user.updatedAt = new Date();
    await user.save();

    res.json({ message: 'Cover photo removed successfully', user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUsers,
  updateMyProfile,
  updateUser,
  getUserBadges,
  blockUser: blockUserEndpoint,
  unblockUser: unblockUserEndpoint,
  getBlockedUsersList,
  uploadAvatar,
  uploadCover,
  removeAvatar,
  removeCover,
};


