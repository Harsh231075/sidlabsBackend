const User = require('../../models/User');
const Follow = require('../../models/Follow');
const Post = require('../../models/Post');
const FriendRequest = require('../../models/FriendRequest');
const { toPublicUrl } = require('../../utils/publicUrl');
const { getAllBlockedUserIds } = require('../../utils/messaging');
const storageService = require('../../services/storageService');
const { httpError } = require('../../utils/httpError');

async function getFriendStatus(currentUserId, otherUserId) {
  if (!currentUserId || !otherUserId || String(currentUserId) === String(otherUserId)) {
    return { friendStatus: 'none' };
  }

  const requests = await FriendRequest.find({
    status: { $in: ['accepted', 'pending'] },
    $or: [
      { from: currentUserId, to: otherUserId },
      { from: otherUserId, to: currentUserId },
    ],
  })
    .select('status from to')
    .lean();

  if (!requests || requests.length === 0) {
    return { friendStatus: 'none' };
  }

  if (requests.some((r) => r.status === 'accepted')) {
    return { friendStatus: 'friends' };
  }

  const outgoing = requests.find((r) => r.status === 'pending' && String(r.from) === String(currentUserId));
  if (outgoing) {
    return { friendStatus: 'pending_outgoing', friendRequestId: String(outgoing._id) };
  }

  const incoming = requests.find((r) => r.status === 'pending' && String(r.to) === String(currentUserId));
  if (incoming) {
    return { friendStatus: 'pending_incoming', friendRequestId: String(incoming._id) };
  }

  return { friendStatus: 'none' };
}

async function generateUsername(name, email) {
  let baseUsername = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15);

  if (!baseUsername) {
    baseUsername = String(email || '')
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 15);
  }

  let username = baseUsername;
  let counter = 1;

  while (await User.findOne({ username })) {
    username = `${baseUsername}${counter}`;
    counter += 1;
  }

  return username;
}

async function ensureUsername(userId) {
  const user = await User.findById(userId);
  if (user && !user.username) {
    const username = await generateUsername(user.name, user.email);
    user.username = username;
    await user.save();
    return username;
  }
  return user?.username;
}

async function getProfileByUsername(username, currentUserId) {
  const user = await User.findOne({ username })
    .select('username name bio avatarUrl coverPhotoUrl location disease healthInterests role roleType followersCount followingCount createdAt')
    .lean();

  if (!user) throw httpError(404, { error: 'Profile not found' });

  if (user.role === 'admin-user') {
    throw httpError(403, { error: 'This profile is not publicly accessible' });
  }

  const [isFollowingRaw, friendMeta] = await Promise.all([
    currentUserId && String(currentUserId) !== String(user._id)
      ? Follow.exists({ follower: currentUserId, following: user._id })
      : false,
    getFriendStatus(currentUserId, user._id),
  ]);
  const isFollowing = !!isFollowingRaw;

  const profile = {
    id: user._id,
    username: user.username,
    name: user.name,
    bio: user.bio || '',
    avatarUrl: toPublicUrl(user.avatarUrl),
    coverPhotoUrl: toPublicUrl(user.coverPhotoUrl),
    location: user.location || '',
    disease: user.disease || '',
    healthInterests: user.healthInterests || [],
    role: user.role,
    roleType: user.roleType,
    isModerator: user.role === 'moderator-user',
    followersCount: user.followersCount || 0,
    followingCount: user.followingCount || 0,
    isFollowing,
    ...friendMeta,
    isOwnProfile: currentUserId && String(currentUserId) === String(user._id),
    createdAt: user.createdAt,
  };

  return { profile };
}

async function getProfileById(userId, currentUserId) {
  let user = await User.findById(userId)
    .select('username name email bio avatarUrl coverPhotoUrl location disease healthInterests role roleType followersCount followingCount createdAt')
    .lean();

  if (!user) throw httpError(404, { error: 'Profile not found' });

  if (user.role === 'admin-user') {
    throw httpError(403, { error: 'This profile is not publicly accessible' });
  }

  if (!user.username) {
    const userDoc = await User.findById(userId);
    if (userDoc && !userDoc.username) {
      const newUsername = await generateUsername(userDoc.name, userDoc.email);
      userDoc.username = newUsername;
      await userDoc.save();
    }

    user = await User.findById(userId)
      .select('username name email bio avatarUrl coverPhotoUrl location disease healthInterests role roleType followersCount followingCount createdAt')
      .lean();

    if (!user) throw httpError(404, { error: 'Profile not found' });
  }

  const [isFollowingRaw, friendMeta] = await Promise.all([
    currentUserId && String(currentUserId) !== String(user._id)
      ? Follow.exists({ follower: currentUserId, following: user._id })
      : false,
    getFriendStatus(currentUserId, user._id),
  ]);
  const isFollowing = !!isFollowingRaw;

  const profile = {
    id: user._id,
    username: user.username,
    name: user.name,
    bio: user.bio || '',
    avatarUrl: toPublicUrl(user.avatarUrl),
    coverPhotoUrl: toPublicUrl(user.coverPhotoUrl),
    location: user.location || '',
    disease: user.disease || '',
    healthInterests: user.healthInterests || [],
    role: user.role,
    roleType: user.roleType,
    isModerator: user.role === 'moderator-user',
    followersCount: user.followersCount || 0,
    followingCount: user.followingCount || 0,
    isFollowing,
    ...friendMeta,
    isOwnProfile: currentUserId && String(currentUserId) === String(user._id),
    createdAt: user.createdAt,
  };

  return { profile };
}

async function updateProfile(userId, body) {
  const { name, bio, location, disease, healthInterests, avatarUrl, coverPhotoUrl, username } = body || {};

  const user = await User.findById(userId);
  if (!user) throw httpError(404, { error: 'User not found' });

  if (username && username !== user.username) {
    const existing = await User.findOne({ username, _id: { $ne: userId } });
    if (existing) throw httpError(400, { error: 'Username already taken' });

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      throw httpError(400, {
        error: 'Username must be 3-20 characters, lowercase letters, numbers, and underscores only',
      });
    }
    user.username = username;
  }

  if (name !== undefined) user.name = name;
  if (bio !== undefined) user.bio = bio;
  if (location !== undefined) user.location = location;
  if (disease !== undefined) user.disease = disease;
  if (healthInterests !== undefined) user.healthInterests = healthInterests;

  if (avatarUrl !== undefined && avatarUrl !== user.avatarUrl) {
    if (user.avatarUrl) await storageService.deleteFile(user.avatarUrl);
    user.avatarUrl = avatarUrl;
  }

  if (coverPhotoUrl !== undefined && coverPhotoUrl !== user.coverPhotoUrl) {
    if (user.coverPhotoUrl) await storageService.deleteFile(user.coverPhotoUrl);
    user.coverPhotoUrl = coverPhotoUrl;
  }

  user.updatedAt = new Date();
  await user.save();

  return {
    message: 'Profile updated successfully',
    profile: {
      id: user._id,
      username: user.username,
      name: user.name,
      bio: user.bio,
      avatarUrl: toPublicUrl(user.avatarUrl),
      coverPhotoUrl: toPublicUrl(user.coverPhotoUrl),
      location: user.location,
      disease: user.disease,
      healthInterests: user.healthInterests,
      role: user.role,
      roleType: user.roleType,
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      createdAt: user.createdAt,
    },
  };
}

async function followUser(username, followerId) {
  const userToFollow = await User.findOne({ username });
  if (!userToFollow) throw httpError(404, { error: 'User not found' });

  if (userToFollow.role === 'admin-user') throw httpError(403, { error: 'Cannot follow this user' });

  if (String(userToFollow._id) === String(followerId)) throw httpError(400, { error: 'Cannot follow yourself' });

  const existingFollow = await Follow.findOne({ follower: followerId, following: userToFollow._id });
  if (existingFollow) throw httpError(400, { error: 'Already following this user' });

  await Follow.create({ follower: followerId, following: userToFollow._id });

  await User.findByIdAndUpdate(followerId, { $inc: { followingCount: 1 } });
  await User.findByIdAndUpdate(userToFollow._id, { $inc: { followersCount: 1 } });

  return {
    message: 'Followed successfully',
    followersCount: (userToFollow.followersCount || 0) + 1,
  };
}

async function unfollowUser(username, followerId) {
  const userToUnfollow = await User.findOne({ username });
  if (!userToUnfollow) throw httpError(404, { error: 'User not found' });

  const result = await Follow.findOneAndDelete({ follower: followerId, following: userToUnfollow._id });
  if (!result) throw httpError(400, { error: 'Not following this user' });

  await User.findByIdAndUpdate(followerId, { $inc: { followingCount: -1 } });
  await User.findByIdAndUpdate(userToUnfollow._id, { $inc: { followersCount: -1 } });

  return {
    message: 'Unfollowed successfully',
    followersCount: Math.max(0, (userToUnfollow.followersCount || 0) - 1),
  };
}

async function getFollowers(username, query, currentUserId) {
  const { page = 1, limit = 20 } = query || {};

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const user = await User.findOne({ username }).select('_id followersCount');
  if (!user) throw httpError(404, { error: 'User not found' });

  let blockedIds = [];
  if (currentUserId) blockedIds = await getAllBlockedUserIds(currentUserId);

  const skip = (pageNum - 1) * limitNum;

  const followers = await Follow.find({ following: user._id })
    .select('follower createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('follower', 'name username avatarUrl bio role')
    .lean();

  const total = typeof user.followersCount === 'number'
    ? user.followersCount
    : await Follow.countDocuments({ following: user._id });

  return {
    followers: followers
      .filter((f) => f.follower)
      .filter((f) => !blockedIds.includes(f.follower._id))
      .map((f) => ({
        id: f.follower._id,
        name: f.follower.name,
        username: f.follower.username,
        avatarUrl: toPublicUrl(f.follower.avatarUrl),
        bio: f.follower.bio,
        isModerator: f.follower.role === 'moderator-user',
        followedAt: f.createdAt,
      })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  };
}

async function getFollowing(username, query, currentUserId) {
  const { page = 1, limit = 20 } = query || {};

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const user = await User.findOne({ username }).select('_id followingCount');
  if (!user) throw httpError(404, { error: 'User not found' });

  let blockedIds = [];
  if (currentUserId) blockedIds = await getAllBlockedUserIds(currentUserId);

  const skip = (pageNum - 1) * limitNum;

  const following = await Follow.find({ follower: user._id })
    .select('following createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('following', 'name username avatarUrl bio role')
    .lean();

  const total = typeof user.followingCount === 'number'
    ? user.followingCount
    : await Follow.countDocuments({ follower: user._id });

  return {
    following: following
      .filter((f) => f.following)
      .filter((f) => !blockedIds.includes(f.following._id))
      .map((f) => ({
        id: f.following._id,
        name: f.following.name,
        username: f.following.username,
        avatarUrl: toPublicUrl(f.following.avatarUrl),
        bio: f.following.bio,
        isModerator: f.following.role === 'moderator-user',
        followedAt: f.createdAt,
      })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  };
}

async function getUserPosts(username, query) {
  const { page = 1, limit = 10 } = query || {};

  const user = await User.findOne({ username });
  if (!user) throw httpError(404, { error: 'User not found' });

  if (user.role === 'admin-user') throw httpError(403, { error: 'This profile is not publicly accessible' });

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const posts = await Post.find({ authorId: user._id, removed: false, visible: true })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('authorId', 'name username avatarUrl role');

  const total = await Post.countDocuments({ authorId: user._id, removed: false, visible: true });

  const transformedPosts = posts.map((p) => {
    const postObj = p.toObject();
    if (postObj.authorId) {
      postObj.author = postObj.authorId;
      delete postObj.authorId;
      if (postObj.author) postObj.author.avatarUrl = toPublicUrl(postObj.author.avatarUrl);
    }

    postObj.mediaUrl = toPublicUrl(postObj.mediaUrl);
    postObj.likesCount = postObj.likes ? postObj.likes.length : 0;
    return postObj;
  });

  return {
    posts: transformedPosts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  };
}

async function getUserLikes(username, query) {
  const { page = 1, limit = 10 } = query || {};

  const user = await User.findOne({ username });
  if (!user) throw httpError(404, { error: 'User not found' });

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const posts = await Post.find({ likes: user._id, removed: false, visible: true })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('authorId', 'name username avatarUrl role');

  const total = await Post.countDocuments({ likes: user._id, removed: false, visible: true });

  const transformedPosts = posts.map((p) => {
    const postObj = p.toObject();
    if (postObj.authorId) {
      postObj.author = postObj.authorId;
      delete postObj.authorId;
      if (postObj.author) postObj.author.avatarUrl = toPublicUrl(postObj.author.avatarUrl);
    }

    postObj.mediaUrl = toPublicUrl(postObj.mediaUrl);
    postObj.likesCount = postObj.likes ? postObj.likes.length : 0;
    postObj.isLiked = true;
    return postObj;
  });

  return {
    posts: transformedPosts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  };
}

async function getUserComments(username, query) {
  const { page = 1, limit = 10 } = query || {};

  const Comment = require('../../models/Comment');

  const user = await User.findOne({ username });
  if (!user) throw httpError(404, { error: 'User not found' });

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const comments = await Comment.find({ authorId: user._id, removed: false, visible: true })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('authorId', 'name username avatarUrl role')
    .populate('postId', 'content authorId');

  const total = await Comment.countDocuments({ authorId: user._id, removed: false, visible: true });

  const transformedComments = comments.map((c) => {
    const commentObj = c.toObject();
    if (commentObj.authorId) {
      commentObj.author = commentObj.authorId;
      delete commentObj.authorId;
      if (commentObj.author) commentObj.author.avatarUrl = toPublicUrl(commentObj.author.avatarUrl);
    }

    if (commentObj.postId) {
      commentObj.post = commentObj.postId;
      delete commentObj.postId;
    }

    return commentObj;
  });

  return {
    comments: transformedComments,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  };
}

module.exports = {
  getProfileByUsername,
  getProfileById,
  updateProfile,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  getUserPosts,
  getUserLikes,
  getUserComments,
  ensureUsername,
  generateUsername,
};
