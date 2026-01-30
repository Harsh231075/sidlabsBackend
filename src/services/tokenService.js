const { v4: uuidv4 } = require('uuid');
const Gamification = require('../models/Gamification');
const BadgeDefinition = require('../models/BadgeDefinition');
const User = require('../models/User');

// Token values per action type (configurable)
const TOKEN_REWARDS = {
  create_post: 10,
  create_comment: 5,
  forum_reply: 7,
  survey_completion: 25,
  helpful_content: 15, // Admin-approved helpful content
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

  // Update action count
  const currentCount = gamification.actionCounts.get(actionType) || 0;
  gamification.actionCounts.set(actionType, currentCount + 1);

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

    // Check if user meets threshold
    const actionCount = userGamification.actionCounts.get(actionType) || 0;
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

/**
 * Get leaderboard
 */
async function getLeaderboard(limit = 10, period = 'all') {
  // Filter by period if needed (for MVP, just use all-time as DB filter might be complex for implicit history)
  // For scalable solution, we'd aggregate tokenHistory.
  // For now, sorting by totalTokens (all time)

  const gamificationDocs = await Gamification.find({})
    .sort({ totalTokens: -1 })
    .limit(limit)
    .populate('userId', 'name avatarUrl')
    .lean();

  const topUsers = gamificationDocs.map((doc, index) => {
    // userId is populated
    const userDetails = doc.userId;
    return {
      rank: index + 1,
      userId: userDetails ? userDetails._id : doc.userId, // handle if populate fail or raw id
      totalTokens: doc.totalTokens || 0,
      badgeCount: (doc.badges || []).length,
      name: userDetails?.name || 'Unknown User',
      avatarUrl: userDetails?.avatarUrl || null,
    };
  });

  return topUsers;
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

