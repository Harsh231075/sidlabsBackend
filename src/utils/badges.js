const Badge = require('../models/Badge');
const BadgeDefinition = require('../models/BadgeDefinition');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');

// We likely used this BADGE_TYPES for some logic, but now definitions are in DB (or should be).
// However, the seed script put specific definitions. 
// For backward compat with existing logic in controllers, we will keep logic similar but read from DB if needed or keep static logic if that's what was requested (Migrate to Mongoose, but identical API).
// The user asked to remove file based storage.
// The previous logic had hardcoded criteria check here. We can keep it or query DB for definitions?
// The seed script populated 'badgeDefinitions.json'.
// Let's rely on the hardcoded checks for now as `checkForBadges` receives data from controllers. 
// But `awardBadge` should use Mongoose.

const BADGE_TYPES = [
  { key: 'first-post', name: 'First Post', criteria: { posts: 1 } },
  { key: 'community-contributor', name: 'Community Contributor', criteria: { posts: 10 } },
  { key: 'first-comment', name: 'First Comment', criteria: { comments: 1 } },
  { key: 'moderator', name: 'Moderator', criteria: { role: 'moderator-user' } },
];

async function listBadgesForUser(userId) {
  return Badge.find({ userId });
}

async function awardBadge(userId, badgeKey) {
  const exists = await Badge.findOne({ userId, type: badgeKey });
  if (exists) return null;

  const badgeConfig = BADGE_TYPES.find((b) => b.key === badgeKey);
  // Also check DB definitions if needed, but for now fallback to config
  // Or fetch definition name from DB? 
  // Let's stick to simple migration.

  if (!badgeConfig) return null;

  const badge = await Badge.create({
    _id: uuidv4(),
    userId,
    type: badgeKey,
    name: badgeConfig.name,
    awardedAt: new Date(),
  });

  console.log(`Minting NFT badge '${badgeConfig.name}' for user ${userId} (simulated)`);
  return badge;
}

async function checkForBadges(userId, { postsCount = 0, commentsCount = 0, role }) {
  const earned = [];
  if (postsCount >= 1) {
    const badge = await awardBadge(userId, 'first-post');
    if (badge) earned.push(badge);
  }
  if (postsCount >= 10) {
    const badge = await awardBadge(userId, 'community-contributor');
    if (badge) earned.push(badge);
  }
  if (commentsCount >= 1) {
    const badge = await awardBadge(userId, 'first-comment');
    if (badge) earned.push(badge);
  }
  if (role === 'moderator-user') {
    const badge = await awardBadge(userId, 'moderator');
    if (badge) earned.push(badge);
  }
  return earned;
}

module.exports = { BADGE_TYPES, awardBadge, checkForBadges, listBadgesForUser };
