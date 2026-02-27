const { v4: uuidv4 } = require('uuid');
const Gamification = require('../models/Gamification');
const BadgeDefinition = require('../models/BadgeDefinition');
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');
const { toPublicUrl } = require('../utils/publicUrl');

// Token values per action type (configurable)
const TOKEN_REWARDS = {
  // Content Creation
  create_post: 10,
  create_comment: 5,
  forum_reply: 7,

  // Engagement
  like_post: 2,           // User gives a like
  receive_like: 3,        // User receives a like on their post
  receive_comment: 2,     // User receives a comment on their post

  // Profile & Social
  complete_profile: 20,   // First time filling out profile
  first_post: 15,         // Bonus for first ever post
  first_comment: 10,      // Bonus for first ever comment
  follow_user: 2,         // Following someone
  get_follower: 3,        // Someone follows you

  // Groups
  join_group: 5,
  create_group: 25,

  // Special
  survey_completion: 25,
  helpful_content: 15,    // Admin-approved helpful content
  daily_login: 5,         // Daily active user bonus
};

/**
 * Get or initialize gamification data for a user
 */
async function getUserGamification(userId) {
  let gamification = await Gamification.findOne({ userId });

  if (!gamification) {
    const now = new Date();
    gamification = await Gamification.create({
      userId,
      totalTokens: 0,
      tokenHistory: [],
      badges: [],
      actionCounts: {
        create_post: 0,
        create_comment: 0,
        forum_reply: 0,
        survey_completion: 0,
        helpful_content: 0,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  return gamification;
}

/**
 * Award tokens to a user for an action
 */
async function awardTokens(userId, actionType, metadata = {}) {
  const tokenAmount = TOKEN_REWARDS[actionType] || 0;
  if (tokenAmount === 0) {
    return { tokens: 0, newTotal: 0 };
  }

  const gamification = await getUserGamification(userId);

  // Check for duplicate actions to prevent exploitation (like/unlike cycles)
  if (metadata.postId && (actionType === 'like_post' || actionType === 'receive_like' || actionType === 'receive_comment')) {
    const alreadyRewarded = gamification.tokenHistory.some(
      h => h.action === actionType && h.metadata && String(h.metadata.postId) === String(metadata.postId)
    );
    if (alreadyRewarded) {
      return { tokens: 0, newTotal: gamification.totalTokens, message: 'Already rewarded for this item' };
    }
  }

  // Check for general spam protection (e.g., same action within 5 seconds)
  if (gamification.tokenHistory.length > 0) {
    const lastAction = gamification.tokenHistory[gamification.tokenHistory.length - 1];
    const timeSinceLast = new Date() - new Date(lastAction.timestamp);
    if (lastAction.action === actionType && timeSinceLast < 5000) {
      return { tokens: 0, newTotal: gamification.totalTokens, message: 'Please wait before earning more points for this action' };
    }
  }

  // Update action count (actionCounts is a plain object, not a Map)
  const currentCount = gamification.actionCounts[actionType] || 0;
  gamification.actionCounts[actionType] = currentCount + 1;
  gamification.markModified('actionCounts'); // Tell Mongoose the object changed

  // Award tokens
  gamification.totalTokens = (gamification.totalTokens || 0) + tokenAmount;

  // Add to history
  gamification.tokenHistory.push({
    id: uuidv4(),
    action: actionType,
    tokens: tokenAmount,
    timestamp: new Date(),
    metadata,
  });

  gamification.updatedAt = new Date();
  await gamification.save();

  return {
    tokens: tokenAmount,
    newTotal: gamification.totalTokens,
  };
}

/**
 * Check if user is eligible for any badges
 */
async function checkBadgeEligibility(userId) {
  const [userGamification, badgeDefinitions] = await Promise.all([
    getUserGamification(userId),
    BadgeDefinition.find({}).lean(),
  ]);

  const earnedBadges = [];

  for (const badgeDef of badgeDefinitions) {
    const { badgeId, criteria } = badgeDef;
    const { actionType, threshold } = criteria || {};

    if (!actionType || !threshold) continue;

    // Check if user already has this badge
    const hasBadge = userGamification.badges?.some((b) => b.badgeId === badgeId);
    if (hasBadge) continue;

    // Check if user meets threshold (actionCounts is a plain object)
    const actionCount = userGamification.actionCounts[actionType] || 0;
    if (actionCount >= threshold) {
      // User is eligible for this badge
      earnedBadges.push({
        badgeId,
        badgeDefinition: badgeDef,
      });
    }
  }

  return earnedBadges;
}

/**
 * Mint a badge NFT for a user (off-chain tracking for MVP)
 */
async function mintBadgeNFT(userId, badgeId) {
  const badgeDef = await BadgeDefinition.findOne({ badgeId }).lean();
  if (!badgeDef) {
    throw new Error(`Badge definition not found: ${badgeId}`);
  }

  const gamification = await getUserGamification(userId);

  // Check if badge already exists
  const existingBadge = gamification.badges?.find((b) => b.badgeId === badgeId);
  if (existingBadge) {
    return existingBadge; // Already minted
  }

  const now = new Date();
  const newBadge = {
    badgeId,
    minted: true,
    mintedAt: now,
    nftTokenId: null, // Will be set when actually minted on-chain
    nftContractAddress: null, // Will be set when actually minted on-chain
  };

  // Award bonus tokens for earning badge
  if (badgeDef.tokenReward) {
    gamification.totalTokens = (gamification.totalTokens || 0) + badgeDef.tokenReward;
    gamification.tokenHistory.push({
      id: uuidv4(),
      action: 'badge_earned',
      tokens: badgeDef.tokenReward,
      timestamp: now,
      metadata: { badgeId, badgeName: badgeDef.name },
    });
  }

  gamification.badges.push(newBadge);
  gamification.updatedAt = now;

  await gamification.save();

  // TODO: In future, trigger actual NFT minting on blockchain here
  // For MVP, we just track it off-chain
  console.log(`[GAMIFICATION] Badge ${badgeId} minted (off-chain) for user ${userId}`);

  return newBadge;
}

/**
 * Process user action and award tokens/badges
 */
async function processUserAction(userId, actionType, metadata = {}) {
  try {
    // Award tokens
    const tokenResult = await awardTokens(userId, actionType, metadata);

    // Check for badge eligibility
    const eligibleBadges = await checkBadgeEligibility(userId);

    // Mint eligible badges
    const mintedBadges = [];
    for (const eligibleBadge of eligibleBadges) {
      try {
        const minted = await mintBadgeNFT(userId, eligibleBadge.badgeId);
        mintedBadges.push({
          badgeId: eligibleBadge.badgeId,
          badgeDefinition: eligibleBadge.badgeDefinition,
          minted,
        });
      } catch (error) {
        console.error(`Error minting badge ${eligibleBadge.badgeId} for user ${userId}:`, error);
      }
    }

    return {
      tokensAwarded: tokenResult.tokens,
      totalTokens: tokenResult.newTotal,
      badgesEarned: mintedBadges,
    };
  } catch (error) {
    console.error(`Error processing user action for ${userId}:`, error);
    // Don't throw - gamification should not break core functionality
    return {
      tokensAwarded: 0,
      totalTokens: 0,
      badgesEarned: [],
      error: error.message,
    };
  }
}

/**
 * Get user gamification stats
 */
async function getUserStats(userId) {
  const userGamification = await getUserGamification(userId);
  const badgeDefinitions = await BadgeDefinition.find({}).lean();

  // Enrich badges with badge definitions
  const enrichedBadges = (userGamification.badges || []).map((badge) => {
    const badgeDef = badgeDefinitions.find((b) => b.badgeId === badge.badgeId);
    return {
      ...badge.toObject ? badge.toObject() : badge,
      badgeDefinition: badgeDef || null,
    };
  });

  return {
    userId: userGamification.userId,
    totalTokens: userGamification.totalTokens || 0,
    badges: enrichedBadges,
    actionCounts: userGamification.actionCounts || {},
    tokenHistory: userGamification.tokenHistory?.slice(-20) || [], // Last 20 entries
  };
}

// ... existing code ...

/**
 * Get leaderboard with pagination, search, and scope
 */
async function getLeaderboard({ limit = 10, page = 1, period = 'all', scope = 'global', userId = null, search = '' }) {
  const skip = (page - 1) * limit;
  let userFilter = {};

  // 1. Handle "Friends" scope
  if (scope === 'friends' && userId) {
    const friendships = await FriendRequest.find({
      status: 'accepted',
      $or: [{ from: userId }, { to: userId }]
    }).lean();

    const friendIds = friendships.map(f =>
      String(f.from) === String(userId) ? String(f.to) : String(f.from)
    );

    // Include self in friends leaderboard? Usually yes to compare rank.
    if (!friendIds.includes(String(userId))) {
      friendIds.push(String(userId));
    }

    userFilter._id = { $in: friendIds };
  }

  // 2. Handle Search
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    const searchConditions = [
      { name: searchRegex },
      { username: searchRegex },
      { email: searchRegex }
    ];

    if (userFilter._id) {
      // Combine with existing ID filter
      userFilter = {
        $and: [
          { _id: userFilter._id },
          { $or: searchConditions }
        ]
      };
    } else {
      userFilter = { $or: searchConditions };
    }
  }

  // If we have filters on Users (search or friends), we first find matching User IDs
  let targetUserIds = null;
  if (Object.keys(userFilter).length > 0) {
    const users = await User.find(userFilter).select('_id').lean();
    targetUserIds = users.map(u => u._id);

    if (targetUserIds.length === 0) {
      return { leaderboard: [], total: 0, page, limit };
    }
  }

  // 3. Build Gamification Query
  const query = {};
  if (targetUserIds) {
    query.userId = { $in: targetUserIds };
  }

  // Get Total Count
  const total = await Gamification.countDocuments(query);

  // Get Data
  const gamificationDocs = await Gamification.find(query)
    .sort({ totalTokens: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  if (!gamificationDocs.length) {
    return { leaderboard: [], total, page, limit };
  }

  // 4. Populate User Details
  const userIds = gamificationDocs.map(doc => doc.userId);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const userMap = new Map(users.map(u => [String(u._id), u]));

  // Calculate Global Rank (Wait, this is paginated, so 'rank' is just index + skip + 1)
  // But if searching/filtering, rank should ideally be the global rank.
  // Calculating true global rank for search/filter results is expensive (requires count of all users with more tokens).
  // For MVP: Simple display rank (skip + index + 1) relative to the current list.

  const leaderboard = gamificationDocs.map((doc, index) => {
    const userDetails = userMap.get(doc.userId);
    return {
      rank: skip + index + 1, // Relative rank in the filtered list
      userId: doc.userId,
      totalTokens: doc.totalTokens || 0,
      badgeCount: (doc.badges || []).length,
      name: userDetails?.name || 'Unknown User',
      avatarUrl: toPublicUrl(userDetails?.avatarUrl),
      username: userDetails?.username || null,
    };
  });

  return { leaderboard, total, page, limit };
}

module.exports = {
  awardTokens,
  checkBadgeEligibility,
  mintBadgeNFT,
  processUserAction,
  getUserStats,
  getLeaderboard,
  getUserGamification,
  TOKEN_REWARDS,
};

