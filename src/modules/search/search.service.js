const User = require('../../models/User');
const Group = require('../../models/Group');
const FriendRequest = require('../../models/FriendRequest');
const { sanitizeUser } = require('../../utils/auth');
const { SimpleTtlCache } = require('../../utils/simpleTtlCache');
const { getAllBlockedUserIds } = require('../../utils/messaging');

const suggestedUsersCache = new SimpleTtlCache({ defaultTtlMs: 30000, maxEntries: 5000 });

function groupView(group, userId) {
  const g = group.toObject ? group.toObject() : group;
  const isMember =
    g.members?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);
  const isAdmin =
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);
  return { ...g, id: g._id, isMember, isAdmin };
}

async function attachFriendStatus(users, userId) {
  if (!userId || users.length === 0) return users;
  const otherIds = users.map(u => u.id).filter(id => Boolean(id) && id !== userId);
  if (otherIds.length === 0) return users;

  const [outgoingPending, incomingPending, accepted] = await Promise.all([
    FriendRequest.find({ from: userId, to: { $in: otherIds }, status: 'pending' }).lean(),
    FriendRequest.find({ to: userId, from: { $in: otherIds }, status: 'pending' }).lean(),
    FriendRequest.find({
      status: 'accepted',
      $or: [{ from: userId, to: { $in: otherIds } }, { to: userId, from: { $in: otherIds } }],
    }).lean(),
  ]);

  const outgoingByTo = new Map(outgoingPending.map(r => [String(r.to), String(r._id)]));
  const incomingByFrom = new Map(incomingPending.map(r => [String(r.from), String(r._id)]));
  const acceptedSet = new Set(accepted.map(r => (String(r.from) === userId ? String(r.to) : String(r.from))));

  return users.map(u => {
    if (!u?.id || u.id === userId) return u;
    if (acceptedSet.has(u.id)) return { ...u, friendStatus: 'friends' };
    const out = outgoingByTo.get(u.id);
    if (out) return { ...u, friendStatus: 'pending_outgoing', friendRequestId: out };
    const inc = incomingByFrom.get(u.id);
    if (inc) return { ...u, friendStatus: 'pending_incoming', friendRequestId: inc };
    return { ...u, friendStatus: 'none' };
  });
}

async function searchAll(queryStr, type, userId, userRole) {
  if (!queryStr) return { users: [], groups: [], query: '' };

  const regex = new RegExp(queryStr, 'i');
  const tasks = [];

  if (!type || type === 'users') {
    tasks.push(
      User.find({ $or: [{ name: regex }, { email: regex }, { bio: regex }, { location: regex }, { disease: regex }] })
        .limit(50).lean().then(items => ({ type: 'users', items }))
    );
  }
  if (!type || type === 'groups') {
    tasks.push(
      Group.find({ $or: [{ name: regex }, { description: regex }, { diseaseTag: regex }] })
        .limit(50).lean().then(items => ({ type: 'groups', items }))
    );
  }

  const results = await Promise.all(tasks);
  let matchedUsers = [];
  let matchedGroups = [];
  results.forEach(r => { if (r.type === 'users') matchedUsers = r.items; if (r.type === 'groups') matchedGroups = r.items; });

  let blockedIds = [];
  if (userId) blockedIds = await getAllBlockedUserIds(userId);
  matchedUsers = matchedUsers.filter(u => !blockedIds.includes(u._id || u.id)).map(u => sanitizeUser(u));

  matchedUsers = await attachFriendStatus(matchedUsers, userId);

  matchedGroups = matchedGroups
    .filter(group => {
      if (group.privacy === 'hidden') {
        if (!userId) return false;
        const isMember =
          group.members?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
          group.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
          group.ownerId === userId || (group.ownerId && group.ownerId._id && group.ownerId._id.toString() === userId);
        if (!isMember && userRole !== 'admin-user') return false;
      }
      return true;
    })
    .map(group => groupView(group, userId));

  return { users: matchedUsers, groups: matchedGroups, query: queryStr };
}

async function getSuggestedUsers(userId, rawLimit) {
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 20) : 3;

  const cacheKey = `${userId || 'anon'}:${limit}`;
  const cached = suggestedUsersCache.get(cacheKey);
  if (cached) return { users: cached };

  const query = { role: { $ne: 'admin-user' } };
  if (userId) query._id = { $ne: userId };

  const users = await User.aggregate([{ $match: query }, { $sample: { size: limit } }]);
  let sanitizedUsers = users.map(u => sanitizeUser(u));
  sanitizedUsers = await attachFriendStatus(sanitizedUsers, userId);
  suggestedUsersCache.set(cacheKey, sanitizedUsers);

  return { users: sanitizedUsers };
}

module.exports = { searchAll, getSuggestedUsers };
