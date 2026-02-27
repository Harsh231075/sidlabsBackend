const User = require('../../models/User');
const Post = require('../../models/Post');
const Comment = require('../../models/Comment');
const Group = require('../../models/Group');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const DiseasePage = require('../../models/DiseasePage');
const ForumThread = require('../../models/ForumThread');
const ForumPost = require('../../models/ForumPost');
const GroupMessage = require('../../models/GroupMessage');
const ActivityLog = require('../../models/ActivityLog');

const { sanitizeUser } = require('../../utils/auth');
const { toPublicUrl } = require('../../utils/publicUrl');
const { sendRoleUpdateEmail } = require('../../services/emailService');
const storageService = require('../../services/storageService');
const { sendTestEmail, verifyEmailTransport, getEmailConfigSummary } = require('../../services/emailService');
const { httpError } = require('../../utils/httpError');

async function getStats() {
  const cache = require('../../services/cacheService');
  return cache.getOrSet('admin:stats', async () => {
    const [
      usersCount,
      postsCount,
      commentsCount,
      groupsCount,
      conversationsCount,
      messagesCount,
      diseasePagesCount,
    ] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      Comment.countDocuments(),
      Group.countDocuments(),
      Conversation.countDocuments(),
      Message.countDocuments(),
      DiseasePage.countDocuments(),
    ]);

    const reportedPostsCount = await Post.countDocuments({ reported: true, removed: false });

    return {
      users: usersCount,
      posts: postsCount,
      comments: commentsCount,
      groups: groupsCount,
      conversations: conversationsCount,
      messages: messagesCount,
      diseasePages: diseasePagesCount,
      reportedPosts: reportedPostsCount,
    };
  }, 60);
}

async function getAllUsers() {
  const users = await User.find().sort({ createdAt: -1 }).limit(5000).lean();
  return users.map(sanitizeUser);
}

async function updateUser(id, body) {
  const { role, name, email, suspended } = body || {};

  const user = await User.findById(id);
  if (!user) throw httpError(404, { error: 'User not found' });

  if (role) {
    const validRoles = ['patient-user', 'caregiver-user', 'moderator-user', 'admin-user'];
    if (!validRoles.includes(role)) throw httpError(400, { error: 'Invalid role' });
    user.role = role;
  }

  if (name) user.name = name;
  if (email) user.email = email;
  if (typeof suspended === 'boolean') user.suspended = suspended;

  user.updatedAt = new Date();
  await user.save();

  if (role) {
    console.log(`[Admin] Updating role for user ${user.email} to ${role}. Attempting to send email...`);
    sendRoleUpdateEmail({ user, newRole: role })
      .then(() => console.log(`[Admin] Role update email sent to ${user.email}`))
      .catch((err) => console.error('[Admin] Failed to send role update email:', err));
  }

  return { user: sanitizeUser(user.toObject()) };
}

async function updateUserRole(id, body) {
  const { role } = body || {};

  const validRoles = ['patient-user', 'caregiver-user', 'moderator-user', 'admin-user'];
  if (!validRoles.includes(role)) throw httpError(400, { error: 'Invalid role' });

  const user = await User.findByIdAndUpdate(id, { role, updatedAt: new Date() }, { new: true });
  if (!user) throw httpError(404, { error: 'User not found' });

  console.log(`[Admin] Role updated via dedicated endpoint for ${user.email} to ${role}. Sending email...`);
  sendRoleUpdateEmail({ user, newRole: role })
    .then(() => console.log(`[Admin] Role update email sent to ${user.email}`))
    .catch((err) => console.error('[Admin] Failed to send role update email:', err));

  return { user: sanitizeUser(user.toObject()) };
}

async function suspendUser(id) {
  const user = await User.findByIdAndUpdate(id, { suspended: true, updatedAt: new Date() }, { new: true });
  if (!user) throw httpError(404, { error: 'User not found' });
  return { message: 'User suspended', user: sanitizeUser(user.toObject()) };
}

async function unsuspendUser(id) {
  const user = await User.findByIdAndUpdate(id, { suspended: false, updatedAt: new Date() }, { new: true });
  if (!user) throw httpError(404, { error: 'User not found' });
  return { message: 'User unsuspended', user: sanitizeUser(user.toObject()) };
}

async function updateUserSuspendStatus(id, body) {
  const { suspended } = body || {};
  const user = await User.findByIdAndUpdate(id, { suspended, updatedAt: new Date() }, { new: true });
  if (!user) throw httpError(404, { error: 'User not found' });
  return { user: sanitizeUser(user.toObject()) };
}

async function getReportedPosts() {
  const reportedPosts = await Post.find({
    $and: [
      { removed: false },
      { $or: [{ reported: true }, { 'moderation.status': 'PENDING_REVIEW' }] },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(500)
    .populate('authorId', 'name avatarUrl')
    .lean();

  return reportedPosts.map((post) => ({
    id: post._id || post.id,
    ...post,
    mediaUrl: toPublicUrl(post.mediaUrl),
    author: post.authorId
      ? {
        id: post.authorId._id,
        name: post.authorId.name,
        avatarUrl: toPublicUrl(post.authorId.avatarUrl),
      }
      : null,
  }));
}

async function approvePost(id, reviewerUserId) {
  const post = await Post.findById(id);
  if (!post) throw httpError(404, { error: 'Post not found' });

  post.reported = false;
  if (post.moderation) {
    post.moderation.status = 'ALLOW';
    post.moderation.reviewedAt = new Date();
    post.moderation.reviewedBy = reviewerUserId;
  }
  post.markModified('moderation');

  post.reports = [];
  post.moderatedAt = new Date();
  post.moderatedBy = reviewerUserId;

  await post.save();
  return { message: 'Post approved', post: post.toObject() };
}

async function rejectPost(id, reviewerUserId) {
  const post = await Post.findByIdAndUpdate(
    id,
    {
      removed: true,
      removedAt: new Date(),
      removedBy: reviewerUserId,
    },
    { new: true },
  );

  if (!post) throw httpError(404, { error: 'Post not found' });

  return { message: 'Post removed' };
}

async function getReportedComments() {
  const reportedComments = await Comment.find({ reported: true, removed: false })
    .sort({ createdAt: -1 })
    .limit(500)
    .populate('authorId', 'name avatarUrl')
    .lean();

  return reportedComments.map((comment) => ({
    id: comment._id || comment.id,
    ...comment,
    author: comment.authorId
      ? {
        id: comment.authorId._id,
        name: comment.authorId.name,
        avatarUrl: toPublicUrl(comment.authorId.avatarUrl),
      }
      : null,
  }));
}

async function approveComment(id) {
  const comment = await Comment.findByIdAndUpdate(id, { reported: false, reports: [] }, { new: true });
  if (!comment) throw httpError(404, { error: 'Comment not found' });
  return { message: 'Comment approved' };
}

async function rejectComment(id, reviewerUserId) {
  const comment = await Comment.findByIdAndUpdate(
    id,
    {
      removed: true,
      removedAt: new Date(),
      removedBy: reviewerUserId,
    },
    { new: true },
  );

  if (!comment) throw httpError(404, { error: 'Comment not found' });
  return { message: 'Comment removed' };
}

async function getAnalytics() {
  const now = new Date();
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    usersCount,
    postsCount,
    commentsCount,
    groupsCount,
    messagesCount,
    roleDistribution,
    recentActivity,
    engagementStats,
    userGrowth,
  ] = await Promise.all([
    User.estimatedDocumentCount(),
    Post.estimatedDocumentCount(),
    Comment.estimatedDocumentCount(),
    Group.estimatedDocumentCount(),
    Message.estimatedDocumentCount(),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Promise.all([
      Post.countDocuments({ createdAt: { $gte: last7Days } }),
      Comment.countDocuments({ createdAt: { $gte: last7Days } }),
      Message.countDocuments({ createdAt: { $gte: last7Days } }),
    ]),
    Post.aggregate([
      { $project: { likeCount: { $size: { $ifNull: ['$likes', []] } } } },
      { $group: { _id: null, totalLikes: { $sum: '$likeCount' } } },
    ]),
    User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
        },
      },
      {
        $group: {
          _id: {
            month: { $month: '$createdAt' },
            year: { $year: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);

  const roles = { patients: 0, moderators: 0, admins: 0 };
  roleDistribution.forEach((r) => {
    if (r._id === 'patient-user') roles.patients = r.count;
    else if (r._id === 'moderator-user') roles.moderators = r.count;
    else if (r._id === 'admin-user') roles.admins = r.count;
  });

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const growthData = [];

  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthIndex = d.getMonth() + 1;
    const year = d.getFullYear();
    const found = userGrowth.find((g) => g._id.month === monthIndex && g._id.year === year);
    growthData.push({ month: months[d.getMonth()], users: found ? found.count : 0 });
  }

  const totalLikes = engagementStats[0]?.totalLikes || 0;
  const avgLikesPerPost = postsCount > 0 ? (totalLikes / postsCount).toFixed(1) : 0;
  const avgCommentsPerPost = postsCount > 0 ? (commentsCount / postsCount).toFixed(1) : 0;

  return {
    userGrowth: growthData,
    roleDistribution: roles,
    recentActivity: {
      posts: recentActivity[0],
      comments: recentActivity[1],
      messages: recentActivity[2],
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
  };
}

async function getAllSubGroupIds(parentId) {
  const subGroups = await Group.find({ parentGroupId: parentId }).select('_id');
  const subGroupIds = subGroups.map((g) => g._id);
  let allIds = [...subGroupIds];
  for (const id of subGroupIds) {

    const nestedIds = await getAllSubGroupIds(id);
    allIds = allIds.concat(nestedIds);
  }
  return allIds;
}

async function deleteGroup(id) {
  const group = await Group.findById(id);
  if (!group) throw httpError(404, { error: 'Group not found' });

  const subGroupIds = await getAllSubGroupIds(id);
  const allGroupIds = [id, ...subGroupIds];

  const groupsWithVisuals = await Group.find({ _id: { $in: allGroupIds } }).select('photoUrl coverPhotoUrl');

  const threads = await ForumThread.find({ groupId: { $in: allGroupIds } }).select('_id');
  const threadIds = threads.map((t) => t._id);

  const posts = await Post.find({ groupId: { $in: allGroupIds } }).select('_id mediaUrl');
  const postIds = posts.map((p) => p._id);

  await Promise.all([
    GroupMessage.deleteMany({ groupId: { $in: allGroupIds } }),
    ForumPost.deleteMany({ threadId: { $in: threadIds } }),
    ForumThread.deleteMany({ groupId: { $in: allGroupIds } }),
    Comment.deleteMany({ postId: { $in: postIds } }),
    Post.deleteMany({ groupId: { $in: allGroupIds } }),
    Group.deleteMany({ _id: { $in: allGroupIds } }),
  ]);

  const deletionPromises = [];

  for (const g of groupsWithVisuals) {
    if (g.photoUrl) deletionPromises.push(storageService.deleteFile(g.photoUrl));
    if (g.coverPhotoUrl) deletionPromises.push(storageService.deleteFile(g.coverPhotoUrl));
  }

  for (const p of posts) {
    if (p.mediaUrl) deletionPromises.push(storageService.deleteFile(p.mediaUrl));
  }

  await Promise.all(deletionPromises);

  return {
    message: 'Group and all associated content (sub-groups, posts, forums, chat) deleted successfully',
    deletedGroupIds: allGroupIds,
  };
}

async function listActivityLogs(query) {
  const page = Math.max(parseInt(query?.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query?.limit || '25', 10), 1), 100);
  const skip = (page - 1) * limit;

  const { actorUserId, action, method, path, success, q, fromDate, toDate, resource } = query || {};

  const filter = {};

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) {
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      filter.createdAt.$gte = from;
    }
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  if (actorUserId) filter.actorUserId = String(actorUserId);
  if (action) filter.action = String(action).toUpperCase();
  if (method) filter.method = String(method).toUpperCase();
  if (path) filter.path = { $regex: String(path), $options: 'i' };
  if (resource) filter.resource = { $regex: String(resource), $options: 'i' };
  if (typeof success !== 'undefined') {
    if (success === 'true' || success === true) filter.success = true;
    if (success === 'false' || success === false) filter.success = false;
  }

  if (q) {
    const queryText = String(q);
    filter.$or = [
      { path: { $regex: queryText, $options: 'i' } },
      { ip: { $regex: queryText, $options: 'i' } },
      { 'actor.email': { $regex: queryText, $options: 'i' } },
      { 'actor.name': { $regex: queryText, $options: 'i' } },
      { 'actor.username': { $regex: queryText, $options: 'i' } },
      { resource: { $regex: queryText, $options: 'i' } },
      { resourceId: { $regex: queryText, $options: 'i' } },
      { description: { $regex: queryText, $options: 'i' } },
      { targetName: { $regex: queryText, $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Object.keys(filter).length === 0
      ? ActivityLog.estimatedDocumentCount()
      : ActivityLog.countDocuments(filter),
  ]);

  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

async function deleteLogsByRange(body) {
  const { fromDate, toDate, logIds } = body || {};

  let deleteCount = 0;

  if (logIds && Array.isArray(logIds) && logIds.length > 0) {
    const result = await ActivityLog.deleteMany({ _id: { $in: logIds } });
    deleteCount = result.deletedCount;
  } else if (fromDate && toDate) {
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    const result = await ActivityLog.deleteMany({ createdAt: { $gte: from, $lte: to } });
    deleteCount = result.deletedCount;
  } else if (fromDate) {
    const from = new Date(fromDate);
    const result = await ActivityLog.deleteMany({ createdAt: { $lte: from } });
    deleteCount = result.deletedCount;
  } else {
    throw httpError(400, { error: 'Please provide date range or log IDs' });
  }

  return {
    success: true,
    deletedCount: deleteCount,
    message: `Successfully deleted ${deleteCount} log entries`,
  };
}

async function deleteLog(id) {
  const result = await ActivityLog.findByIdAndDelete(id);
  if (!result) throw httpError(404, { error: 'Log not found' });
  return { success: true, message: 'Log deleted successfully' };
}

async function getLogStats() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    total,
    last24hCount,
    last7dCount,
    last30dCount,
    byAction,
    byResource,
    failedCount,
  ] = await Promise.all([
    ActivityLog.countDocuments(),
    ActivityLog.countDocuments({ createdAt: { $gte: last24h } }),
    ActivityLog.countDocuments({ createdAt: { $gte: last7d } }),
    ActivityLog.countDocuments({ createdAt: { $gte: last30d } }),
    ActivityLog.aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    ActivityLog.aggregate([
      { $group: { _id: '$resource', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    ActivityLog.countDocuments({ success: false }),
  ]);

  return {
    total,
    last24h: last24hCount,
    last7d: last7dCount,
    last30d: last30dCount,
    byAction: byAction.reduce((acc, item) => ({ ...acc, [item._id || 'OTHER']: item.count }), {}),
    topResources: byResource.map((r) => ({ resource: r._id || 'unknown', count: r.count })),
    failedCount,
    successRate: total > 0 ? (((total - failedCount) / total) * 100).toFixed(1) : 100,
  };
}

async function getEmailHealth() {
  const verify = await verifyEmailTransport();
  return { ...verify, config: getEmailConfigSummary() };
}

async function sendEmailTest(body) {
  const { to } = body || {};
  if (!to) throw httpError(400, { error: 'to is required' });

  const verify = await verifyEmailTransport();
  if (!verify.ok) {

    throw httpError(400, { error: 'Email transport not healthy', ...verify });
  }

  const result = await sendTestEmail(String(to));
  if (!result.ok) throw httpError(500, { error: 'Failed to send test email', result });

  return { success: true, result };
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
  listActivityLogs,
  deleteLogsByRange,
  deleteLog,
  getLogStats,
  getEmailHealth,
  sendEmailTest,
};
