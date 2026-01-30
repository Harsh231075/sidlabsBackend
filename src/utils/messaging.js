const BlockedUser = require('../models/BlockedUser');
const { v4: uuidv4 } = require('uuid');

/**
 * Check if a user has blocked another user
 */
async function isUserBlocked(blockerId, blockedId) {
  const count = await BlockedUser.countDocuments({ blockerId, blockedId });
  return count > 0;
}

/**
 * Block a user
 */
async function blockUser(blockerId, blockedId) {
  if (blockerId === blockedId) {
    throw new Error('Cannot block yourself');
  }

  const existing = await BlockedUser.findOne({ blockerId, blockedId });
  if (!existing) {
    await BlockedUser.create({
      _id: uuidv4(),
      blockerId,
      blockedId,
      createdAt: new Date(),
    });
  }
}

/**
 * Unblock a user
 */
async function unblockUser(blockerId, blockedId) {
  await BlockedUser.deleteOne({ blockerId, blockedId });
}

/**
 * Get list of users blocked by a user
 */
async function getBlockedUsers(userId) {
  const blocks = await BlockedUser.find({ blockerId: userId });
  return blocks.map((b) => b.blockedId);
}

/**
 * Get list of users who have blocked a user
 */
async function getUsersWhoBlocked(userId) {
  const blocks = await BlockedUser.find({ blockedId: userId });
  return blocks.map((b) => b.blockerId);
}

/**
 * Check if users can message each other (not blocked)
 */
async function canMessageUsers(userId1, userId2) {
  const [blocked1, blocked2] = await Promise.all([
    isUserBlocked(userId1, userId2),
    isUserBlocked(userId2, userId1)
  ]);
  return !blocked1 && !blocked2;
}

module.exports = {
  isUserBlocked,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getUsersWhoBlocked,
  canMessageUsers,
};

