const Follow = require('../../models/Follow');
const FriendRequest = require('../../models/FriendRequest');
const User = require('../../models/User');
const { notifyFriendRequestReceived, notifyFriendRequestAccepted } = require('../../utils/notifications');
const { sendFriendRequestEmail, sendFriendRequestAcceptedEmail } = require('../../services/emailService');
const { toPublicUrl } = require('../../utils/publicUrl');
const { httpError } = require('../../utils/httpError');

async function ensureFollow(followerId, followingId) {
  if (!followerId || !followingId || followerId === followingId) return;

  // Use upsert/addToSet logic to avoid separate find/create/update noise
  const result = await Follow.updateOne(
    { follower: followerId, following: followingId },
    { $setOnInsert: { _id: uuidv4(), createdAt: new Date() } },
    { upsert: true }
  );

  if (result.upsertedCount > 0) {
    await Promise.all([
      User.updateOne({ _id: followerId }, { $inc: { followingCount: 1 } }).catch(() => null),
      User.updateOne({ _id: followingId }, { $inc: { followersCount: 1 } }).catch(() => null),
    ]);
  }
}

async function ensureMutualFollow(userA, userB) {
  await ensureFollow(userA, userB);
  await ensureFollow(userB, userA);
}

function canHaveFriends(user) {
  return user && user.role !== 'admin-user';
}

async function sendFriendRequest(fromUserId, username) {
  const toUser = await User.findOne({ username }).lean();
  if (!toUser) throw httpError(404, { error: 'User not found' });
  if (!canHaveFriends(toUser)) throw httpError(403, { error: 'Cannot send friend request to this user' });
  if (toUser._id === fromUserId) throw httpError(400, { error: 'Cannot send friend request to yourself' });

  const existingFriendship = await FriendRequest.findOne({
    status: 'accepted',
    $or: [{ from: fromUserId, to: toUser._id }, { from: toUser._id, to: fromUserId }],
  }).lean();
  if (existingFriendship) {
    await ensureMutualFollow(fromUserId, toUser._id);
    return { message: 'Already friends', status: 'friends' };
  }

  const reversePending = await FriendRequest.findOne({ from: toUser._id, to: fromUserId, status: 'pending' });
  if (reversePending) {
    reversePending.status = 'accepted';
    reversePending.respondedAt = new Date();
    await reversePending.save();
    await ensureMutualFollow(fromUserId, toUser._id);
    return { message: 'Friend request accepted', status: 'friends', requestId: reversePending._id };
  }

  const outgoingPending = await FriendRequest.findOne({ from: fromUserId, to: toUser._id, status: 'pending' }).lean();
  if (outgoingPending) {
    await ensureFollow(fromUserId, toUser._id);
    return { message: 'Friend request already sent', status: 'pending_outgoing', requestId: outgoingPending._id };
  }

  const request = await FriendRequest.create({ from: fromUserId, to: toUser._id, status: 'pending' });
  await ensureFollow(fromUserId, toUser._id);
  await notifyFriendRequestReceived(fromUserId, toUser._id);

  User.findById(fromUserId).select('name email').then(sender => {
    sendFriendRequestEmail({ fromUser: sender, toUser }).catch(err => console.error('Error sending friend request email:', err));
  });

  return { _statusCode: 201, message: 'Friend request sent', status: 'pending_outgoing', requestId: request._id };
}

async function sendFriendRequestById(fromUserId, targetUserId) {
  const toUser = await User.findById(targetUserId).lean();
  if (!toUser) throw httpError(404, { error: 'User not found' });
  if (!canHaveFriends(toUser)) throw httpError(403, { error: 'Cannot send friend request to this user' });
  if (toUser._id === fromUserId) throw httpError(400, { error: 'Cannot send friend request to yourself' });

  const existingFriendship = await FriendRequest.findOne({
    status: 'accepted',
    $or: [{ from: fromUserId, to: toUser._id }, { from: toUser._id, to: fromUserId }],
  }).lean();
  if (existingFriendship) {
    await ensureMutualFollow(fromUserId, toUser._id);
    return { message: 'Already friends', status: 'friends' };
  }

  const reversePending = await FriendRequest.findOne({ from: toUser._id, to: fromUserId, status: 'pending' });
  if (reversePending) {
    reversePending.status = 'accepted';
    reversePending.respondedAt = new Date();
    await reversePending.save();
    await ensureMutualFollow(fromUserId, toUser._id);
    return { message: 'Friend request accepted', status: 'friends', requestId: reversePending._id };
  }

  const outgoingPending = await FriendRequest.findOne({ from: fromUserId, to: toUser._id, status: 'pending' }).lean();
  if (outgoingPending) {
    await ensureFollow(fromUserId, toUser._id);
    return { message: 'Friend request already sent', status: 'pending_outgoing', requestId: outgoingPending._id };
  }

  const request = await FriendRequest.create({ from: fromUserId, to: toUser._id, status: 'pending' });
  await ensureFollow(fromUserId, toUser._id);

  return { _statusCode: 201, message: 'Friend request sent', status: 'pending_outgoing', requestId: request._id };
}

async function acceptFriendRequest(userId, requestId) {
  const request = await FriendRequest.findOne({ _id: requestId, to: userId, status: 'pending' });
  if (!request) throw httpError(404, { error: 'Friend request not found' });

  request.status = 'accepted';
  request.respondedAt = new Date();
  await request.save();
  await ensureMutualFollow(request.from, request.to);
  await notifyFriendRequestAccepted(request.to, request.from);

  const [senderUser, recipientUser] = await Promise.all([
    User.findById(request.from).select('name email'),
    User.findById(request.to).select('name username'),
  ]);
  if (senderUser && recipientUser) {
    sendFriendRequestAcceptedEmail({ sender: senderUser, recipient: recipientUser })
      .catch(err => console.error('Failed to send friend accept email:', err));
  }

  return { message: 'Friend request accepted', status: 'friends' };
}

async function rejectFriendRequest(userId, requestId) {
  const request = await FriendRequest.findOne({ _id: requestId, to: userId, status: 'pending' });
  if (!request) throw httpError(404, { error: 'Friend request not found' });
  request.status = 'rejected';
  request.respondedAt = new Date();
  await request.save();
  return { message: 'Friend request rejected', status: 'none' };
}

async function cancelFriendRequest(userId, requestId) {
  const request = await FriendRequest.findOne({ _id: requestId, from: userId, status: 'pending' });
  if (!request) throw httpError(404, { error: 'Friend request not found' });
  request.status = 'cancelled';
  request.respondedAt = new Date();
  await request.save();
  return { message: 'Friend request cancelled' };
}

async function listFriendRequests(userId, type) {
  const queryType = String(type || 'incoming');
  const query = queryType === 'outgoing'
    ? { from: userId, status: 'pending' }
    : { to: userId, status: 'pending' };

  const requests = await FriendRequest.find(query)
    .sort({ createdAt: -1 }).limit(100)
    .populate('from', 'name username avatarUrl role')
    .populate('to', 'name username avatarUrl role');

  return {
    requests: requests.map(r => ({
      id: r._id,
      status: r.status,
      createdAt: r.createdAt,
      from: r.from ? { id: r.from._id, name: r.from.name, username: r.from.username, avatarUrl: toPublicUrl(r.from.avatarUrl), isModerator: r.from.role === 'moderator-user' } : null,
      to: r.to ? { id: r.to._id, name: r.to.name, username: r.to.username, avatarUrl: toPublicUrl(r.to.avatarUrl), isModerator: r.to.role === 'moderator-user' } : null,
    })),
  };
}

async function listAcceptedFriends(userId) {
  const requests = await FriendRequest.find({ status: 'accepted', $or: [{ from: userId }, { to: userId }] }).lean();

  const friendIds = requests.map(r => String(r.from) === String(userId) ? r.to : r.from);
  if (!friendIds.length) return { friends: [] };

  const uniqueFriendIds = [...new Set(friendIds)];
  const users = await User.find({ _id: { $in: uniqueFriendIds } })
    .select('name username avatarUrl role')
    .lean();

  const userMap = new Map(users.map(u => [String(u._id), u]));

  const friends = uniqueFriendIds.map(id => {
    const friend = userMap.get(String(id));
    if (!friend) return null;
    return {
      id: friend._id,
      name: friend.name,
      username: friend.username,
      avatarUrl: toPublicUrl(friend.avatarUrl),
      role: friend.role
    };
  }).filter(Boolean);

  return { friends };
}

module.exports = { sendFriendRequest, sendFriendRequestById, acceptFriendRequest, rejectFriendRequest, cancelFriendRequest, listFriendRequests, listAcceptedFriends };
