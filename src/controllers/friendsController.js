const Follow = require('../models/Follow');
const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');
const { notifyFriendRequestReceived, notifyFriendRequestAccepted } = require('../utils/notifications');
const { sendFriendRequestEmail, sendFriendRequestAcceptedEmail } = require('../services/emailService');
const { toPublicUrl } = require('../utils/publicUrl');

async function ensureFollow(followerId, followingId) {
  if (!followerId || !followingId || followerId === followingId) return;

  const existing = await Follow.findOne({ follower: followerId, following: followingId }).lean();
  if (existing) return;

  await Follow.create({ follower: followerId, following: followingId });

  // Keep counters best-effort (don't throw if user missing)
  await Promise.all([
    User.findByIdAndUpdate(followerId, { $inc: { followingCount: 1 } }).catch(() => null),
    User.findByIdAndUpdate(followingId, { $inc: { followersCount: 1 } }).catch(() => null),
  ]);
}

async function ensureMutualFollow(userA, userB) {
  await ensureFollow(userA, userB);
  await ensureFollow(userB, userA);
}

function canHaveFriends(user) {
  return user && user.role !== 'admin-user';
}

/**
 * Send friend request (or auto-accept if reverse pending exists)
 * POST /api/friends/request/:username
 */
async function sendFriendRequest(req, res, next) {
  try {
    const fromUserId = req.user.id;
    const { username } = req.params;

    const toUser = await User.findOne({ username }).lean();
    if (!toUser) return res.status(404).json({ error: 'User not found' });

    if (!canHaveFriends(toUser)) {
      return res.status(403).json({ error: 'Cannot send friend request to this user' });
    }

    if (toUser._id === fromUserId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    // If already friends (accepted in either direction), ensure mutual follow and return.
    const existingFriendship = await FriendRequest.findOne({
      status: 'accepted',
      $or: [
        { from: fromUserId, to: toUser._id },
        { from: toUser._id, to: fromUserId },
      ],
    }).lean();

    if (existingFriendship) {
      await ensureMutualFollow(fromUserId, toUser._id);
      return res.json({
        message: 'Already friends',
        status: 'friends',
      });
    }

    // If reverse pending request exists, auto-accept
    const reversePending = await FriendRequest.findOne({
      from: toUser._id,
      to: fromUserId,
      status: 'pending',
    });

    if (reversePending) {
      reversePending.status = 'accepted';
      reversePending.respondedAt = new Date();
      await reversePending.save();

      await ensureMutualFollow(fromUserId, toUser._id);

      return res.json({
        message: 'Friend request accepted',
        status: 'friends',
        requestId: reversePending._id,
      });
    }

    // Existing outgoing pending request
    const outgoingPending = await FriendRequest.findOne({
      from: fromUserId,
      to: toUser._id,
      status: 'pending',
    }).lean();

    if (outgoingPending) {
      await ensureFollow(fromUserId, toUser._id);
      return res.json({
        message: 'Friend request already sent',
        status: 'pending_outgoing',
        requestId: outgoingPending._id,
      });
    }

    // Create new pending request
    const request = await FriendRequest.create({
      from: fromUserId,
      to: toUser._id,
      status: 'pending',
    });

    // When requesting, follow the user (one-way). Acceptance will make it mutual.
    await ensureFollow(fromUserId, toUser._id);

    // Notify recipient
    await notifyFriendRequestReceived(fromUserId, toUser._id);

    // Send email notification (async)
    // We already have fromUser (req.user) and toUser in scope, but req.user doesn't have name/email populated usually in middleware?
    // req.user usually has id, role. Let's fetch fromUser details or assume req.user is populated if auth middleware does it.
    // auth middleware usually just decodes token. Let's fetch fromUser to be safe or use what we have.
    // Actually, `fromUserId` is available. Let's just pass `toUser` (we have it) and fetch `fromUser` name.
    User.findById(fromUserId).select('name email').then(sender => {
      sendFriendRequestEmail({ fromUser: sender, toUser: toUser }).catch(err => console.error('Error sending friend request email:', err));
    });

    return res.status(201).json({
      message: 'Friend request sent',
      status: 'pending_outgoing',
      requestId: request._id,
    });
  } catch (error) {
    // Handle duplicate pending index
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Friend request already pending' });
    }
    next(error);
  }
}

/**
 * Send friend request by userId (fallback for users without username)
 * POST /api/friends/request/id/:userId
 */
async function sendFriendRequestById(req, res, next) {
  try {
    const fromUserId = req.user.id;
    const { userId } = req.params;

    const toUser = await User.findById(userId).lean();
    if (!toUser) return res.status(404).json({ error: 'User not found' });

    if (!canHaveFriends(toUser)) {
      return res.status(403).json({ error: 'Cannot send friend request to this user' });
    }

    if (toUser._id === fromUserId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    // If already friends (accepted in either direction)
    const existingFriendship = await FriendRequest.findOne({
      status: 'accepted',
      $or: [
        { from: fromUserId, to: toUser._id },
        { from: toUser._id, to: fromUserId },
      ],
    }).lean();

    if (existingFriendship) {
      await ensureMutualFollow(fromUserId, toUser._id);
      return res.json({ message: 'Already friends', status: 'friends' });
    }

    // Auto-accept if reverse pending exists
    const reversePending = await FriendRequest.findOne({
      from: toUser._id,
      to: fromUserId,
      status: 'pending',
    });

    if (reversePending) {
      reversePending.status = 'accepted';
      reversePending.respondedAt = new Date();
      await reversePending.save();
      await ensureMutualFollow(fromUserId, toUser._id);
      return res.json({
        message: 'Friend request accepted',
        status: 'friends',
        requestId: reversePending._id,
      });
    }

    const outgoingPending = await FriendRequest.findOne({
      from: fromUserId,
      to: toUser._id,
      status: 'pending',
    }).lean();

    if (outgoingPending) {
      await ensureFollow(fromUserId, toUser._id);
      return res.json({
        message: 'Friend request already sent',
        status: 'pending_outgoing',
        requestId: outgoingPending._id,
      });
    }

    const request = await FriendRequest.create({ from: fromUserId, to: toUser._id, status: 'pending' });
    await ensureFollow(fromUserId, toUser._id);

    return res.status(201).json({
      message: 'Friend request sent',
      status: 'pending_outgoing',
      requestId: request._id,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Friend request already pending' });
    }
    next(error);
  }
}

/**
 * Accept friend request
 * PUT /api/friends/request/:requestId/accept
 */
async function acceptFriendRequest(req, res, next) {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await FriendRequest.findOne({ _id: requestId, to: userId, status: 'pending' });
    if (!request) return res.status(404).json({ error: 'Friend request not found' });

    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();

    await ensureMutualFollow(request.from, request.to);

    // Notify sender that request was accepted
    await notifyFriendRequestAccepted(request.to, request.from);

    // Send email to the Original SENDER (request.from)
    // We need to fetch details for both
    const [senderUser, recipientUser] = await Promise.all([
      User.findById(request.from).select('name email'),
      User.findById(request.to).select('name username')
    ]);

    if (senderUser && recipientUser) {
      sendFriendRequestAcceptedEmail({
        sender: senderUser,
        recipient: recipientUser
      }).catch(err => console.error('Failed to send friend accept email:', err));
    }

    return res.json({
      message: 'Friend request accepted',
      status: 'friends',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Reject friend request
 * PUT /api/friends/request/:requestId/reject
 */
async function rejectFriendRequest(req, res, next) {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await FriendRequest.findOne({ _id: requestId, to: userId, status: 'pending' });
    if (!request) return res.status(404).json({ error: 'Friend request not found' });

    request.status = 'rejected';
    request.respondedAt = new Date();
    await request.save();

    return res.json({
      message: 'Friend request rejected',
      status: 'none',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Cancel outgoing friend request
 * DELETE /api/friends/request/:requestId
 */
async function cancelFriendRequest(req, res, next) {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await FriendRequest.findOne({ _id: requestId, from: userId, status: 'pending' });
    if (!request) return res.status(404).json({ error: 'Friend request not found' });

    request.status = 'cancelled';
    request.respondedAt = new Date();
    await request.save();

    return res.json({ message: 'Friend request cancelled' });
  } catch (error) {
    next(error);
  }
}

/**
 * List friend requests
 * GET /api/friends/requests?type=incoming|outgoing
 */
async function listFriendRequests(req, res, next) {
  try {
    const userId = req.user.id;
    const type = String(req.query.type || 'incoming');

    const query =
      type === 'outgoing'
        ? { from: userId, status: 'pending' }
        : { to: userId, status: 'pending' };

    const requests = await FriendRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('from', 'name username avatarUrl role')
      .populate('to', 'name username avatarUrl role');

    return res.json({
      requests: requests.map((r) => ({
        id: r._id,
        status: r.status,
        createdAt: r.createdAt,
        from: r.from
          ? {
            id: r.from._id,
            name: r.from.name,
            username: r.from.username,
            avatarUrl: toPublicUrl(r.from.avatarUrl),
            isModerator: r.from.role === 'moderator-user',
          }
          : null,
        to: r.to
          ? {
            id: r.to._id,
            name: r.to.name,
            username: r.to.username,
            avatarUrl: toPublicUrl(r.to.avatarUrl),
            isModerator: r.to.role === 'moderator-user',
          }
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List accepted friends
 * GET /api/friends/list
 */
async function listAcceptedFriends(req, res, next) {
  try {
    const userId = req.user.id;

    // Find all accepted requests involving this user
    const requests = await FriendRequest.find({
      status: 'accepted',
      $or: [{ from: userId }, { to: userId }]
    })
      .populate('from', 'name username avatarUrl role')
      .populate('to', 'name username avatarUrl role');

    // Extract the "other" user from each request
    const friends = requests.map(r => {
      const isFromMe = String(r.from._id) === String(userId);
      const friend = isFromMe ? r.to : r.from;
      return {
        id: friend._id,
        name: friend.name,
        username: friend.username,
        avatarUrl: toPublicUrl(friend.avatarUrl),
        role: friend.role
      };
    });

    res.json({ friends });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  sendFriendRequest,
  sendFriendRequestById,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  listFriendRequests,
  listAcceptedFriends,
};
