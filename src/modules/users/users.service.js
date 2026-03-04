const User = require('../../models/User');
const Post = require('../../models/Post');
const { sanitizeUser } = require('../../utils/auth');
const { listBadgesForUser } = require('../../utils/badges');
const { blockUser, unblockUser, getBlockedUsers } = require('../../utils/messaging');
const { toPublicUrl } = require('../../utils/publicUrl');
const storageService = require('../../services/storageService');
const { httpError } = require('../../utils/httpError');

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

async function getUsers() {
  const users = await User.find({}).lean();
  return users.map(sanitizeUser);
}

async function updateMyProfile(userId, body) {
  const { bio, location, disease, caregiverRelationship, avatarUrl, name, email } = body;
  const user = await User.findById(userId);
  if (!user) throw httpError(404, { error: 'User not found' });

  if (name !== undefined) user.name = name;
  if (bio !== undefined) user.bio = bio;
  if (location !== undefined) user.location = location;
  if (disease !== undefined) user.disease = disease;
  if (caregiverRelationship !== undefined) user.caregiverRelationship = caregiverRelationship;
  if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

  if (email !== undefined) {
    const newEmail = normalizeEmail(email);
    if (newEmail !== user.email) {
      const existing = await User.findOne({ email: newEmail });
      if (existing && String(existing.id) !== String(user.id)) throw httpError(409, { error: 'Email is already in use' });
      user.email = newEmail;
    }
  }
  user.updatedAt = new Date();
  await user.save();
  return { user: sanitizeUser(user.toObject()) };
}

async function updateUser(targetId, body, requesterId, requesterRole) {
  if (requesterId !== targetId && requesterRole !== 'admin-user') throw httpError(403, { error: 'Forbidden' });

  const user = await User.findById(targetId);
  if (!user) throw httpError(404, { error: 'User not found' });

  if (body.name !== undefined) user.name = body.name;
  if (body.bio !== undefined) user.bio = body.bio;
  if (body.location !== undefined) user.location = body.location;
  if (body.disease !== undefined) user.disease = body.disease;
  if (body.caregiverRelationship !== undefined) user.caregiverRelationship = body.caregiverRelationship;
  if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl;

  if (body.email !== undefined) {
    const newEmail = normalizeEmail(body.email);
    if (newEmail !== user.email) {
      const existing = await User.findOne({ email: newEmail });
      if (existing && String(existing.id) !== String(user.id)) throw httpError(409, { error: 'Email is already in use' });
      user.email = newEmail;
    }
  }
  if (requesterRole === 'admin-user' && body.suspended !== undefined) user.suspended = body.suspended;

  user.updatedAt = new Date();
  await user.save();
  return { user: sanitizeUser(user.toObject()) };
}

async function getUserBadges(requesterId, requesterRole, targetId) {
  if (requesterId !== targetId && requesterRole !== 'admin-user') throw httpError(403, { error: 'Forbidden' });
  return await listBadgesForUser(targetId);
}

async function blockUserById(userId, blockedUserId) {
  if (userId === blockedUserId) throw httpError(400, { error: 'Cannot block yourself' });
  await blockUser(userId, blockedUserId);
  return { success: true };
}

async function unblockUserById(userId, blockedUserId) {
  await unblockUser(userId, blockedUserId);
  return { success: true };
}

async function getBlockedUsersList(userId) {
  const blockedUserIds = await getBlockedUsers(userId);
  if (blockedUserIds.length === 0) return [];
  const users = await User.find({ _id: { $in: blockedUserIds } }).lean();
  return users.map(u => sanitizeUser(u));
}

async function uploadAvatar(userId, image) {
  if (!image) throw httpError(400, { error: 'No image provided' });

  let base64 = image;
  let mime = 'image/png';
  const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
  if (dataUrlMatch) { mime = dataUrlMatch[1]; base64 = dataUrlMatch[2]; }

  const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const filename = `${userId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  const result = await storageService.upload({ buffer, contentType: mime, key: `avatars/${filename}` });
  const user = await User.findById(userId);
  if (!user) throw httpError(404, { error: 'User not found' });
  if (user.avatarUrl) await storageService.deleteFile(user.avatarUrl);
  user.avatarUrl = result.url;
  user.updatedAt = new Date();
  await user.save();
  return { user: sanitizeUser(user.toObject()) };
}

async function uploadCover(userId, image) {
  if (!image) throw httpError(400, { error: 'No image provided' });

  let base64 = image;
  let mime = 'image/jpeg';
  const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
  if (dataUrlMatch) { mime = dataUrlMatch[1]; base64 = dataUrlMatch[2]; }

  const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const filename = `${userId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  const result = await storageService.upload({ buffer, contentType: mime, key: `covers/${filename}` });
  const user = await User.findById(userId);
  if (!user) throw httpError(404, { error: 'User not found' });
  if (user.coverPhotoUrl) await storageService.deleteFile(user.coverPhotoUrl);
  user.coverPhotoUrl = result.url;
  user.updatedAt = new Date();
  await user.save();
  return { user: sanitizeUser(user.toObject()) };
}

async function removeAvatar(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, { error: 'User not found' });
  if (user.avatarUrl) await storageService.deleteFile(user.avatarUrl);
  user.avatarUrl = '';
  user.updatedAt = new Date();
  await user.save();
  return { message: 'Avatar removed successfully', user: sanitizeUser(user.toObject()) };
}

async function removeCover(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, { error: 'User not found' });
  if (user.coverPhotoUrl) await storageService.deleteFile(user.coverPhotoUrl);
  user.coverPhotoUrl = '';
  user.updatedAt = new Date();
  await user.save();
  return { message: 'Cover photo removed successfully', user: sanitizeUser(user.toObject()) };
}

async function getMyReports(userId) {
  const posts = await Post.find({ 'reports.reporterId': userId })
    .select('content mediaUrl createdAt reports moderation removed moderationStatus')
    .sort({ createdAt: -1 }).lean();

  return posts.map(post => {
    const userReport = post.reports && post.reports.find(r => r.reporterId && r.reporterId.toString() === userId.toString());
    const reportDate = userReport ? new Date(userReport.reportedAt) : new Date(0);
    const reviewedAt = post.moderation && post.moderation.reviewedAt ? new Date(post.moderation.reviewedAt) : null;

    let status = 'Pending';
    if (post.removed) status = 'Approved';
    else if (post.moderation && (post.moderation.status === 'ALLOW' || post.moderation.status === 'APPROVED') && reviewedAt && reviewedAt > reportDate) status = 'Rejected';

    return {
      postId: post._id, content: post.content, mediaUrl: toPublicUrl(post.mediaUrl),
      reportedAt: userReport ? userReport.reportedAt : post.createdAt,
      reason: userReport ? userReport.reason : 'Unknown', status,
    };
  });
}

module.exports = {
  getUsers, updateMyProfile, updateUser, getUserBadges,
  blockUserById, unblockUserById, getBlockedUsersList,
  uploadAvatar, uploadCover, removeAvatar, removeCover, getMyReports,
};
