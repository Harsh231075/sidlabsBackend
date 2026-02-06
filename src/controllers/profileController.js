/**
 * Profile Controller
 * 
 * Handles profile-related operations:
 * - Get profile by username
 * - Update own profile
 * - Follow/Unfollow users
 * - Get followers/following lists
 * - Get user's posts
 */

const User = require('../models/User');
const Follow = require('../models/Follow');
const Post = require('../models/Post');
const FriendRequest = require('../models/FriendRequest');
const { toPublicUrl } = require('../utils/publicUrl');

async function getFriendStatus(currentUserId, otherUserId) {
  if (!currentUserId || !otherUserId || currentUserId === otherUserId) {
    return { friendStatus: 'none' };
  }

  const accepted = await FriendRequest.findOne({
    status: 'accepted',
    $or: [
      { from: currentUserId, to: otherUserId },
      { from: otherUserId, to: currentUserId },
    ],
  }).lean();

  if (accepted) return { friendStatus: 'friends' };

  const outgoing = await FriendRequest.findOne({
    from: currentUserId,
    to: otherUserId,
    status: 'pending',
  }).lean();

  if (outgoing) {
    return { friendStatus: 'pending_outgoing', friendRequestId: String(outgoing._id) };
  }

  const incoming = await FriendRequest.findOne({
    from: otherUserId,
    to: currentUserId,
    status: 'pending',
  }).lean();

  if (incoming) {
    return { friendStatus: 'pending_incoming', friendRequestId: String(incoming._id) };
  }

  return { friendStatus: 'none' };
}

/**
 * Generate unique username from name/email
 */
async function generateUsername(name, email) {
  // Try to create username from name first
  let baseUsername = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15);

  if (!baseUsername) {
    // Fallback to email prefix
    baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
  }

  let username = baseUsername;
  let counter = 1;

  while (await User.findOne({ username })) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  return username;
}

/**
 * Get profile by username
 * GET /api/profile/:username
 */
async function getProfileByUsername(req, res, next) {
  try {
    const { username } = req.params;
    const currentUserId = req.user?.id; // May be null if not logged in

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Don't show admin profiles publicly
    if (user.role === 'admin-user') {
      return res.status(403).json({ error: 'This profile is not publicly accessible' });
    }

    // Check if current user is following this profile
    let isFollowing = false;
    if (currentUserId && currentUserId !== user._id) {
      const followRecord = await Follow.findOne({
        follower: currentUserId,
        following: user._id
      });
      isFollowing = !!followRecord;
    }

    const friendMeta = await getFriendStatus(currentUserId, user._id);

    // Return profile data (exclude sensitive info)
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
      isOwnProfile: currentUserId === user._id,
      createdAt: user.createdAt
    };

    res.json({ profile });
  } catch (error) {
    next(error);
  }
}

/**
 * Get profile by user ID
 * GET /api/profile/id/:userId
 */
async function getProfileById(req, res, next) {
  try {
    const { userId } = req.params;
    const currentUserId = req.user?.id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Don't show admin profiles publicly
    if (user.role === 'admin-user') {
      return res.status(403).json({ error: 'This profile is not publicly accessible' });
    }

    // Legacy users may not have username yet; generate on-demand
    if (!user.username) {
      const newUsername = await generateUsername(user.name, user.email);
      user.username = newUsername;
      await user.save();
    }

    // Check if current user is following this profile
    let isFollowing = false;
    if (currentUserId && currentUserId !== user._id) {
      const followRecord = await Follow.findOne({
        follower: currentUserId,
        following: user._id
      });
      isFollowing = !!followRecord;
    }

    const friendMeta = await getFriendStatus(currentUserId, user._id);

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
      isOwnProfile: currentUserId === user._id,
      createdAt: user.createdAt
    };

    res.json({ profile });
  } catch (error) {
    next(error);
  }
}

/**
 * Update own profile
 * PUT /api/profile
 */
async function updateProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const { name, bio, location, disease, healthInterests, avatarUrl, coverPhotoUrl, username } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If username is being changed, validate it
    if (username && username !== user.username) {
      const existing = await User.findOne({ username, _id: { $ne: userId } });
      if (existing) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      // Validate username format
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({
          error: 'Username must be 3-20 characters, lowercase letters, numbers, and underscores only'
        });
      }
      user.username = username;
    }

    // Update fields
    if (name !== undefined) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (location !== undefined) user.location = location;
    if (disease !== undefined) user.disease = disease;
    if (healthInterests !== undefined) user.healthInterests = healthInterests;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
    if (coverPhotoUrl !== undefined) user.coverPhotoUrl = coverPhotoUrl;

    user.updatedAt = new Date();
    await user.save();

    res.json({
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
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Follow a user
 * POST /api/profile/:username/follow
 */
async function followUser(req, res, next) {
  try {
    const { username } = req.params;
    const followerId = req.user.id;

    const userToFollow = await User.findOne({ username });
    if (!userToFollow) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Can't follow admins
    if (userToFollow.role === 'admin-user') {
      return res.status(403).json({ error: 'Cannot follow this user' });
    }

    // Can't follow yourself
    if (userToFollow._id === followerId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    // Check if already following
    const existingFollow = await Follow.findOne({
      follower: followerId,
      following: userToFollow._id
    });

    if (existingFollow) {
      return res.status(400).json({ error: 'Already following this user' });
    }

    // Create follow relationship
    await Follow.create({
      follower: followerId,
      following: userToFollow._id
    });

    // Update counts
    await User.findByIdAndUpdate(followerId, { $inc: { followingCount: 1 } });
    await User.findByIdAndUpdate(userToFollow._id, { $inc: { followersCount: 1 } });

    res.json({
      message: 'Followed successfully',
      followersCount: userToFollow.followersCount + 1
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Unfollow a user
 * DELETE /api/profile/:username/follow
 */
async function unfollowUser(req, res, next) {
  try {
    const { username } = req.params;
    const followerId = req.user.id;

    const userToUnfollow = await User.findOne({ username });
    if (!userToUnfollow) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete follow relationship
    const result = await Follow.findOneAndDelete({
      follower: followerId,
      following: userToUnfollow._id
    });

    if (!result) {
      return res.status(400).json({ error: 'Not following this user' });
    }

    // Update counts
    await User.findByIdAndUpdate(followerId, { $inc: { followingCount: -1 } });
    await User.findByIdAndUpdate(userToUnfollow._id, { $inc: { followersCount: -1 } });

    res.json({
      message: 'Unfollowed successfully',
      followersCount: Math.max(0, userToUnfollow.followersCount - 1)
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get followers list
 * GET /api/profile/:username/followers
 */
async function getFollowers(req, res, next) {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const followers = await Follow.find({ following: user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('follower', 'name username avatarUrl bio role');

    const total = await Follow.countDocuments({ following: user._id });

    res.json({
      followers: followers.map(f => ({
        id: f.follower._id,
        name: f.follower.name,
        username: f.follower.username,
        avatarUrl: toPublicUrl(f.follower.avatarUrl),
        bio: f.follower.bio,
        isModerator: f.follower.role === 'moderator-user',
        followedAt: f.createdAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get following list
 * GET /api/profile/:username/following
 */
async function getFollowing(req, res, next) {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const following = await Follow.find({ follower: user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('following', 'name username avatarUrl bio role');

    const total = await Follow.countDocuments({ follower: user._id });

    res.json({
      following: following.map(f => ({
        id: f.following._id,
        name: f.following.name,
        username: f.following.username,
        avatarUrl: toPublicUrl(f.following.avatarUrl),
        bio: f.following.bio,
        isModerator: f.following.role === 'moderator-user',
        followedAt: f.createdAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's posts
 * GET /api/profile/:username/posts
 */
async function getUserPosts(req, res, next) {
  try {
    const { username } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't show admin posts
    if (user.role === 'admin-user') {
      return res.status(403).json({ error: 'This profile is not publicly accessible' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await Post.find({ authorId: user._id, removed: false, visible: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('authorId', 'name username avatarUrl role');

    const total = await Post.countDocuments({ authorId: user._id, removed: false, visible: true });

    // Transform posts to include author data correctly
    const transformedPosts = posts.map(p => {
      const postObj = p.toObject();
      if (postObj.authorId) {
        postObj.author = postObj.authorId;
        delete postObj.authorId;

        if (postObj.author) {
          postObj.author.avatarUrl = toPublicUrl(postObj.author.avatarUrl);
        }
      }

      postObj.mediaUrl = toPublicUrl(postObj.mediaUrl);
      postObj.likesCount = postObj.likes ? postObj.likes.length : 0;
      return postObj;
    });

    res.json({
      posts: transformedPosts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's liked posts
 * GET /api/profile/:username/likes
 */
async function getUserLikes(req, res, next) {
  try {
    const { username } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Find posts that the user has liked
    const posts = await Post.find({
      likes: user._id,
      removed: false,
      visible: true
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('authorId', 'name username avatarUrl role');

    const total = await Post.countDocuments({ likes: user._id, removed: false, visible: true });

    // Transform posts to include author data correctly
    const transformedPosts = posts.map(p => {
      const postObj = p.toObject();
      if (postObj.authorId) {
        postObj.author = postObj.authorId;
        delete postObj.authorId;
      }
      postObj.likesCount = postObj.likes ? postObj.likes.length : 0;
      postObj.isLiked = true; // User has liked this post
      return postObj;
    });

    res.json({
      posts: transformedPosts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's comments
 * GET /api/profile/:username/comments
 */
async function getUserComments(req, res, next) {
  try {
    const { username } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const Comment = require('../models/Comment');

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Find comments by the user
    const comments = await Comment.find({
      authorId: user._id,
      removed: false,
      visible: true
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('authorId', 'name username avatarUrl role')
      .populate('postId', 'content authorId');

    const total = await Comment.countDocuments({ authorId: user._id, removed: false, visible: true });

    // Transform comments to include author and post data correctly
    const transformedComments = comments.map(c => {
      const commentObj = c.toObject();
      if (commentObj.authorId) {
        commentObj.author = commentObj.authorId;
        delete commentObj.authorId;
      }
      if (commentObj.postId) {
        commentObj.post = commentObj.postId;
        delete commentObj.postId;
      }
      return commentObj;
    });

    res.json({
      comments: transformedComments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Ensure user has a username (for existing users)
 * Called during login/auth
 */
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
  generateUsername
};
