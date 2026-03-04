const { processUserAction, getUserStats, getLeaderboard } = require('../../services/tokenService');
const { httpError } = require('../../utils/httpError');

async function getUserGamificationStats(targetUserId, requestingUserId) {
  const userId = targetUserId || requestingUserId;
  return await getUserStats(userId);
}

async function getLeaderboardStats(userId, query) {
  const limit = parseInt(query.limit || '10', 10);
  const page = parseInt(query.page || '1', 10);
  const period = query.period || 'all';
  const scope = query.scope || 'global';
  const search = query.search || '';
  return await getLeaderboard({ limit, page, period, scope, userId, search });
}

async function awardTokensManually(requestingUserId, requestingUserRole, body) {
  const { userId, actionType, metadata } = body;
  if (!userId || !actionType) throw httpError(400, { error: 'userId and actionType are required' });
  if (requestingUserRole !== 'admin-user' && requestingUserRole !== 'moderator-user') {
    throw httpError(403, { error: 'Only admins and moderators can manually award tokens' });
  }
  const result = await processUserAction(userId, actionType, {
    ...metadata,
    manuallyAwarded: true,
    awardedBy: requestingUserId,
  });
  return {
    success: true,
    tokensAwarded: result.tokensAwarded,
    totalTokens: result.totalTokens,
    badgesEarned: result.badgesEarned,
  };
}

module.exports = { getUserGamificationStats, getLeaderboardStats, awardTokensManually };
