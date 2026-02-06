const { processUserAction, getUserStats, getLeaderboard } = require('../services/tokenService');

/**
 * Get user's gamification stats
 */
async function getUserGamificationStats(req, res, next) {
  try {
    const userId = req.params.userId || req.user.id;
    const stats = await getUserStats(userId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
}

/**
 * Get leaderboard
 */
async function getLeaderboardStats(req, res, next) {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const page = parseInt(req.query.page || '1', 10);
    const period = req.query.period || 'all'; // 'all', 'weekly', 'monthly'
    const scope = req.query.scope || 'global'; // 'global', 'friends'
    const search = req.query.search || '';

    const result = await getLeaderboard({ limit, page, period, scope, userId: req.user.id, search });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Award tokens manually (admin only - for helpful content, etc.)
 */
async function awardTokensManually(req, res, next) {
  try {
    const { userId, actionType, tokens, metadata } = req.body;

    if (!userId || !actionType) {
      return res.status(400).json({ error: 'userId and actionType are required' });
    }

    // Only admins/moderators can manually award tokens
    if (req.user.role !== 'admin-user' && req.user.role !== 'moderator-user') {
      return res.status(403).json({ error: 'Only admins and moderators can manually award tokens' });
    }

    const result = await processUserAction(userId, actionType, {
      ...metadata,
      manuallyAwarded: true,
      awardedBy: req.user.id,
    });

    res.json({
      success: true,
      tokensAwarded: result.tokensAwarded,
      totalTokens: result.totalTokens,
      badgesEarned: result.badgesEarned,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUserGamificationStats,
  getLeaderboardStats,
  awardTokensManually,
};

