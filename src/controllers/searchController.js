const User = require('../models/User');
const Group = require('../models/Group');
const FriendRequest = require('../models/FriendRequest');
const { sanitizeUser } = require('../utils/auth');

function groupView(group, userId) {
  // ensure it's an object
  const g = group.toObject ? group.toObject() : group;

  const isMember =
    g.members?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);

  const isAdmin =
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);

  return {
    ...g,
    id: g._id,
    isMember,
    isAdmin,
  };
}

/**
 * Search across users and groups
 */
async function search(req, res, next) {
  try {
    const query = (req.query.q || '').trim();
    const type = req.query.type; // Optional: 'users', 'groups', or undefined (both)

    if (!query) {
      return res.json({
        users: [],
        groups: [],
        query: '',
      });
    }

    const regex = new RegExp(query, 'i'); // Case-insensitive regex

    const tasks = [];

    // Search users
    if (!type || type === 'users') {
      tasks.push(User.find({
        $or: [
          { name: regex },
          { email: regex },
          { bio: regex },
          { location: regex },
          { disease: regex }
        ]
      }).limit(50).lean().then(users => ({ type: 'users', items: users })));
    }

    // Search groups
    if (!type || type === 'groups') {
      tasks.push(Group.find({
        $or: [
          { name: regex },
          { description: regex },
          { diseaseTag: regex }
        ]
      }).limit(50).lean().then(groups => ({ type: 'groups', items: groups })));
    }

    const results = await Promise.all(tasks);

    let matchedUsers = [];
    let matchedGroups = [];

    results.forEach(r => {
      if (r.type === 'users') matchedUsers = r.items;
      if (r.type === 'groups') matchedGroups = r.items;
    });

    const userId = req.user?.id;

    // Sanitize users
    matchedUsers = matchedUsers.map(u => sanitizeUser(u));

    // Attach friend relationship metadata for current user (best-effort)
    if (userId && matchedUsers.length > 0) {
      const otherIds = matchedUsers
        .map((u) => u.id)
        .filter((id) => Boolean(id) && id !== userId);

      if (otherIds.length > 0) {
        const [outgoingPending, incomingPending, accepted] = await Promise.all([
          FriendRequest.find({ from: userId, to: { $in: otherIds }, status: 'pending' }).lean(),
          FriendRequest.find({ to: userId, from: { $in: otherIds }, status: 'pending' }).lean(),
          FriendRequest.find({
            status: 'accepted',
            $or: [
              { from: userId, to: { $in: otherIds } },
              { to: userId, from: { $in: otherIds } },
            ],
          }).lean(),
        ]);

        const outgoingByTo = new Map(outgoingPending.map((r) => [String(r.to), String(r._id)]));
        const incomingByFrom = new Map(incomingPending.map((r) => [String(r.from), String(r._id)]));
        const acceptedSet = new Set(
          accepted.map((r) => (String(r.from) === userId ? String(r.to) : String(r.from)))
        );

        matchedUsers = matchedUsers.map((u) => {
          if (!u?.id || u.id === userId) return u;

          if (acceptedSet.has(u.id)) {
            return { ...u, friendStatus: 'friends' };
          }

          const outgoingId = outgoingByTo.get(u.id);
          if (outgoingId) {
            return { ...u, friendStatus: 'pending_outgoing', friendRequestId: outgoingId };
          }

          const incomingId = incomingByFrom.get(u.id);
          if (incomingId) {
            return { ...u, friendStatus: 'pending_incoming', friendRequestId: incomingId };
          }

          return { ...u, friendStatus: 'none' };
        });
      }
    }

    // Filter groups for visibility
    matchedGroups = matchedGroups
      .filter((group) => {
        if (group.privacy === 'hidden') {
          if (!userId) return false;
          // Check membership helper inline logic or reuse
          // Since we reused groupView function structure above, let's look at membership manually for filter
          // Or just check if groupView returns isMember

          // Re-use logic from groupView
          const isMember =
            group.members?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
            group.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
            group.ownerId === userId || (group.ownerId && group.ownerId._id && group.ownerId._id.toString() === userId);

          if (!isMember && req.user?.role !== 'admin-user') {
            return false;
          }
        }
        return true;
      })
      .map((group) => groupView(group, userId));

    res.json({
      users: matchedUsers,
      groups: matchedGroups,
      query,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get suggested users (random active users)
 * GET /api/search/suggested
 */
async function getSuggestedUsers(req, res, next) {
  try {
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit) || 3;

    // Get random users excluding current user and admins
    const query = {
      role: { $ne: 'admin-user' }
    };

    if (userId) {
      query._id = { $ne: userId };
    }

    // Get random users using aggregation
    const users = await User.aggregate([
      { $match: query },
      { $sample: { size: limit } }
    ]);

    // Sanitize users
    let sanitizedUsers = users.map(u => sanitizeUser(u));

    // Attach friend relationship metadata for current user
    if (userId && sanitizedUsers.length > 0) {
      const otherIds = sanitizedUsers.map((u) => u.id).filter((id) => Boolean(id));

      if (otherIds.length > 0) {
        const [outgoingPending, incomingPending, accepted] = await Promise.all([
          FriendRequest.find({ from: userId, to: { $in: otherIds }, status: 'pending' }).lean(),
          FriendRequest.find({ to: userId, from: { $in: otherIds }, status: 'pending' }).lean(),
          FriendRequest.find({
            status: 'accepted',
            $or: [
              { from: userId, to: { $in: otherIds } },
              { to: userId, from: { $in: otherIds } },
            ],
          }).lean(),
        ]);

        const outgoingByTo = new Map(outgoingPending.map((r) => [String(r.to), String(r._id)]));
        const incomingByFrom = new Map(incomingPending.map((r) => [String(r.from), String(r._id)]));
        const acceptedSet = new Set(
          accepted.map((r) => (String(r.from) === userId ? String(r.to) : String(r.from)))
        );

        sanitizedUsers = sanitizedUsers.map((u) => {
          if (!u?.id) return u;

          if (acceptedSet.has(u.id)) {
            return { ...u, friendStatus: 'friends' };
          }

          const outgoingId = outgoingByTo.get(u.id);
          if (outgoingId) {
            return { ...u, friendStatus: 'pending_outgoing', friendRequestId: outgoingId };
          }

          const incomingId = incomingByFrom.get(u.id);
          if (incomingId) {
            return { ...u, friendStatus: 'pending_incoming', friendRequestId: incomingId };
          }

          return { ...u, friendStatus: 'none' };
        });
      }
    }

    res.json({
      users: sanitizedUsers
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { search, getSuggestedUsers };

