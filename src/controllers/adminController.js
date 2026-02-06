const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Group = require('../models/Group');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const DiseasePage = require('../models/DiseasePage');
const { sanitizeUser } = require('../utils/auth');
const { toPublicUrl } = require('../utils/publicUrl');
const { sendRoleUpdateEmail } = require('../services/emailService');

/**
 * Get admin dashboard statistics
 */
async function getStats(req, res, next) {
  try {
    const [
      usersCount,
      postsCount,
      commentsCount,
      groupsCount,
      conversationsCount,
      messagesCount,
      diseasePagesCount
    ] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      Comment.countDocuments(),
      Group.countDocuments(),
      Conversation.countDocuments(),
      Message.countDocuments(),
      DiseasePage.countDocuments(),
    ]);

    // Calculate reported posts count
    const reportedPostsCount = await Post.countDocuments({ reported: true, removed: false });

    res.json({
      users: usersCount,
      posts: postsCount,
      comments: commentsCount,
      groups: groupsCount,
      conversations: conversationsCount,
      messages: messagesCount,
      diseasePages: diseasePagesCount,
      reportedPosts: reportedPostsCount,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all users (admin/moderator only)
 */
async function getAllUsers(req, res, next) {
  try {
    const users = await User.find().lean();
    res.json(users.map(sanitizeUser));
  } catch (error) {
    next(error);
  }
}

/**
 * Update user (admin only) - can update role and other fields
 */
async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { role, name, email, suspended } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update role if provided
    if (role) {
      const validRoles = ['patient-user', 'caregiver-user', 'moderator-user', 'admin-user'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      user.role = role;
    }

    // Update other fields if provided
    if (name) user.name = name;
    if (email) user.email = email;
    if (typeof suspended === 'boolean') user.suspended = suspended;

    user.updatedAt = new Date();
    await user.save();

    // eamil sending 
    if (role) {
      console.log(`[Admin] Updating role for user ${user.email} to ${role}. Attempting to send email...`);
      sendRoleUpdateEmail({ user, newRole: role })
        .then(() => console.log(`[Admin] Role update email sent to ${user.email}`))
        .catch(err => console.error('[Admin] Failed to send role update email:', err));
    }

    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Update user role (admin only)
 */
async function updateUserRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['patient-user', 'caregiver-user', 'moderator-user', 'admin-user'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role, updatedAt: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send email notification (async)
    console.log(`[Admin] Role updated via dedicated endpoint for ${user.email} to ${role}. Sending email...`);
    sendRoleUpdateEmail({ user, newRole: role })
      .then(() => console.log(`[Admin] Role update email sent to ${user.email}`))
      .catch(err => console.error('[Admin] Failed to send role update email:', err));

    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Suspend user (admin only)
 */
async function suspendUser(req, res, next) {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndUpdate(
      id,
      { suspended: true, updatedAt: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User suspended', user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Unsuspend user (admin only)
 */
async function unsuspendUser(req, res, next) {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndUpdate(
      id,
      { suspended: false, updatedAt: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User unsuspended', user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Update user suspend status via PUT (admin only) - legacy endpoint
 */
async function updateUserSuspendStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { suspended } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      { suspended, updatedAt: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: sanitizeUser(user.toObject()) });
  } catch (error) {
    next(error);
  }
}

/**
 * Get reported posts for moderation
 */
async function getReportedPosts(req, res, next) {
  try {
    // using $or to match reported or pending review status
    const reportedPosts = await Post.find({
      $and: [
        { removed: false },
        { $or: [{ reported: true }, { 'moderation.status': 'PENDING_REVIEW' }] }
      ]
    })
      .sort({ createdAt: -1 })
      .populate('authorId', 'name avatarUrl')
      .lean();

    const formatted = reportedPosts.map(post => ({
      id: post._id || post.id,
      ...post,
      author: post.authorId ? { id: post.authorId._id, name: post.authorId.name, avatarUrl: toPublicUrl(post.authorId.avatarUrl) } : null
    }));

    res.json(formatted);
  } catch (error) {
    next(error);
  }
}

/**
 * Approve reported post (clear report flag)
 */
async function approvePost(req, res, next) {
  try {
    const { id } = req.params;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    post.reported = false;
    if (post.moderation) {
      post.moderation.status = 'ALLOW';
      post.moderation.reviewedAt = new Date();
      post.moderation.reviewedBy = req.user.id;
    }
    // Mark mixed type modified if needed, though setting property usually enough
    post.markModified('moderation');

    post.reports = [];
    post.moderatedAt = new Date();
    post.moderatedBy = req.user.id; // Assuming we add these fields to schema if not present?
    // Moderation fields might need adding to Post schema if strict. 

    await post.save();
    res.json({ message: 'Post approved', post: post.toObject() });
  } catch (error) {
    next(error);
  }
}

/**
 * Reject reported post (remove it)
 */
async function rejectPost(req, res, next) {
  try {
    const { id } = req.params;

    const post = await Post.findByIdAndUpdate(
      id,
      {
        removed: true,
        removedAt: new Date(),
        removedBy: req.user.id
      },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ message: 'Post removed' });
  } catch (error) {
    next(error);
  }
}

/**
 * Get reported comments for moderation
 */
async function getReportedComments(req, res, next) {
  try {
    const reportedComments = await Comment.find({ reported: true, removed: false })
      .sort({ createdAt: -1 })
      .populate('authorId', 'name avatarUrl')
      .lean();

    const formatted = reportedComments.map(comment => ({
      id: comment._id || comment.id,
      ...comment,
      author: comment.authorId ? { id: comment.authorId._id, name: comment.authorId.name, avatarUrl: toPublicUrl(comment.authorId.avatarUrl) } : null
    }));

    res.json(formatted);
  } catch (error) {
    next(error);
  }
}

/**
 * Approve reported comment
 */
async function approveComment(req, res, next) {
  try {
    const { id } = req.params;

    const comment = await Comment.findByIdAndUpdate(
      id,
      { reported: false, reports: [] },
      { new: true }
    );

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json({ message: 'Comment approved' });
  } catch (error) {
    next(error);
  }
}

/**
 * Reject reported comment
 */
async function rejectComment(req, res, next) {
  try {
    const { id } = req.params;

    const comment = await Comment.findByIdAndUpdate(
      id,
      {
        removed: true,
        removedAt: new Date(),
        removedBy: req.user.id
      },
      { new: true }
    );

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json({ message: 'Comment removed' });
  } catch (error) {
    next(error);
  }
}

/**
 * Get analytics data
 */
async function getAnalytics(req, res, next) {
  try {
    const [
      usersCount,
      postsCount,
      commentsCount,
      groupsCount,
      messagesCount,
      allUsers,
      allPosts,
      allComments,
      allMessages
    ] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      Comment.countDocuments(),
      Group.countDocuments(),
      Message.countDocuments(),
      User.find({}).lean(),
      Post.find({}).select('createdAt likes').lean(),
      Comment.find({}).select('createdAt').lean(),
      Message.find({}).select('createdAt').lean()
    ]);

    // Calculate user growth by month (using createdAt which Mongoose handles)
    const now = new Date();
    const usersByMonth = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthUsers = allUsers.filter(u => {
        const created = new Date(u.createdAt);
        return created <= monthStart; // Logic slightly different from original but standard total accum
      }).length;

      // Original logic was cumulative users up to that month?
      // Original: 
      // const monthUsers = users.filter(u => created <= month).length; 
      // Yes, cumulative.

      usersByMonth.push({
        month: monthStart.toLocaleString('default', { month: 'short' }),
        users: monthUsers
      });
    }

    // User role distribution
    const roleDistribution = {
      patients: allUsers.filter(u => u.role === 'patient-user').length,
      moderators: allUsers.filter(u => u.role === 'moderator-user').length,
      admins: allUsers.filter(u => u.role === 'admin-user').length,
    };

    // Activity stats
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentPosts = allPosts.filter(p => new Date(p.createdAt) >= last7Days).length;
    const recentComments = allComments.filter(c => new Date(c.createdAt) >= last7Days).length;
    const recentMessages = allMessages.filter(m => new Date(m.createdAt) >= last7Days).length;

    // Engagement stats
    const totalLikes = allPosts.reduce((sum, p) => sum + (p.likes?.length || 0), 0);
    const avgLikesPerPost = postsCount > 0 ? (totalLikes / postsCount).toFixed(1) : 0;
    const avgCommentsPerPost = postsCount > 0 ? (commentsCount / postsCount).toFixed(1) : 0;

    res.json({
      userGrowth: usersByMonth,
      roleDistribution,
      recentActivity: {
        posts: recentPosts,
        comments: recentComments,
        messages: recentMessages,
      },
      engagement: {
        totalLikes,
        avgLikesPerPost: parseFloat(avgLikesPerPost),
        avgCommentsPerPost: parseFloat(avgCommentsPerPost),
        totalComments: commentsCount,
      },
      totals: {
        users: usersCount,
        posts: postsCount,
        groups: groupsCount,
        messages: messagesCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete group (admin only)
 */
async function deleteGroup(req, res, next) {
  try {
    const { id } = req.params;
    const group = await Group.findByIdAndDelete(id);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ message: 'Group deleted' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getStats,
  getAllUsers,
  updateUser,
  updateUserRole,
  suspendUser,
  unsuspendUser,
  updateUserSuspendStatus,
  getReportedPosts,
  approvePost,
  rejectPost,
  getReportedComments,
  approveComment,
  rejectComment,
  getAnalytics,
  deleteGroup,
};

