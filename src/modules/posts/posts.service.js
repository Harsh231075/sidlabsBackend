
const { v4: uuidv4 } = require('uuid');
const Post = require('../../models/Post');
const Comment = require('../../models/Comment');
const Group = require('../../models/Group');
const { sanitizeInput, analyzeTextForModeration } = require('../../utils/moderation');
const { scan: moderationScan } = require('../../services/moderationService');
const { checkForBadges } = require('../../utils/badges');
const { notifyPostComment, notifyPostLike, notifyGroupPost } = require('../../utils/notifications');
const { processUserAction } = require('../../services/tokenService');
const { sendModerationAlert } = require('../../services/emailService');
const { toPublicUrl } = require('../../utils/publicUrl');
const { decodeCursor, encodeCursor } = require('../../services/posts/cursor');
const {
  buildPostResponse,
  buildPostResponsesBulk,
  canViewGroupPost,
} = require('../../services/posts/postResponseBuilder');
const { httpError } = require('../../utils/httpError');

async function createPost(userId, userRole, body) {
  const content = sanitizeInput(body.content || '');
  let mediaUrl = (body.mediaUrl || '').trim();
  const image = body.image || null;
  const groupId = body.groupId || null;

  if (!content) throw httpError(400, { error: 'Content is required' });

  const analysis = analyzeTextForModeration(content);
  const userConfirmed = !!body.userConfirmedModeration;

  if (analysis.alertRequired && !userConfirmed) {
    throw httpError(409, {
      error: 'moderation_confirmation_required',
      message:
        'This post may contain PHI, spam, or promotional content. This post will be monitored. Are you sure you want to post?',
      analysis,
    });
  }

  const isPendingReview = analysis.alertRequired && userConfirmed;

  let targetGroup = null;
  if (groupId) {
    targetGroup = await Group.findById(groupId).lean();
    if (!targetGroup) throw httpError(404, { error: 'Group not found' });

    const isMember =
      targetGroup.members?.includes(userId) ||
      targetGroup.adminIds?.includes(userId) ||
      targetGroup.ownerId === userId;

    if (targetGroup.privacy !== 'public' && !isMember && userRole !== 'admin-user') {
      throw httpError(403, { error: 'Not a member of this private group' });
    }
  }

  if (image) {
    const storageService = require('../../services/storageService');
    let base64 = image;
    let mime = 'image/png';
    const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1];
      base64 = dataUrlMatch[2];
    }
    const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const filename = `${userId}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      throw httpError(400, { error: 'Server Limit Exceeded: File size must be under 5MB.' });
    }

    const folder = groupId ? 'group-posts' : 'posts';
    const uploaded = await storageService.upload({ buffer, contentType: mime, key: `${folder}/${filename}` });
    mediaUrl = uploaded.url;
  }

  const now = new Date();
  const newPost = await Post.create({
    _id: uuidv4(),
    authorId: userId,
    content,
    mediaUrl,
    groupId,
    createdAt: now,
    updatedAt: now,
    likes: [],
    reported: isPendingReview,
    reports: [],
    removed: false,
    moderation: {
      status: isPendingReview ? 'PENDING_REVIEW' : 'ALLOW',
      analysis,
      flaggedAt: isPendingReview ? now : null,
      flaggedBy: isPendingReview ? userId : null,
    },
    visible: true,
  });

  if (isPendingReview) {
    sendModerationAlert({
      contentType: 'post',
      contentId: newPost._id,
      reason: analysis.flags?.join(', ') || 'Potential policy violation',
      flaggedBy: userId,
    }).catch((err) => console.error('Failed to send moderation alert:', err));
  }

  processUserAction(userId, 'create_post', { postId: newPost._id, groupId }).catch((err) =>
    console.error('Error processing gamification for post creation:', err),
  );

  if (groupId && targetGroup) {
    notifyGroupPost(groupId, newPost._id, userId).catch((err) =>
      console.error('Error creating group post notifications:', err),
    );
  }

  const [postsCount, commentsCount] = await Promise.all([
    Post.countDocuments({ authorId: userId, removed: false }),
    Comment.countDocuments({ authorId: userId, removed: false }),
  ]);
  checkForBadges(userId, { postsCount, commentsCount, role: userRole }).catch((err) =>
    console.error('Badge check error:', err),
  );

  const response = await buildPostResponse(newPost, userId);
  return { post: response };
}

async function likePost(userId, postId) {
  const post = await Post.findById(postId);
  if (!post) throw httpError(404, { error: 'Post not found' });

  const likeList = post.likes || [];
  const idx = likeList.indexOf(userId);
  const wasLiked = idx >= 0;

  if (!wasLiked) {
    post.likes.push(userId);

    processUserAction(userId, 'like_post', { postId: post._id }).catch((err) =>
      console.error('Error processing gamification for like:', err),
    );

    if (post.authorId !== userId) {
      processUserAction(post.authorId, 'receive_like', { postId: post._id, likerId: userId }).catch((err) =>
        console.error('Error processing gamification for receive_like:', err),
      );
      notifyPostLike(userId, post.authorId, post._id, true).catch((err) =>
        console.error('Error creating like notification:', err),
      );
    }
  } else {
    post.likes.splice(idx, 1);
  }

  await post.save();
  const response = await buildPostResponse(post, userId);
  return { post: response };
}

async function reportPost(userId, userRole, postId, reason) {
  const sanitizedReason = sanitizeInput(reason || 'Not specified');
  const post = await Post.findOne({ _id: postId, removed: false });
  if (!post) throw httpError(404, { error: 'Post not found' });

  if (post.groupId) {
    const group = await Group.findById(post.groupId).lean();
    if (!canViewGroupPost(post, group, userId, userRole)) {
      throw httpError(403, { error: 'Not authorized to report this post' });
    }
  }

  post.reported = true;
  post.reports = post.reports || [];
  post.reports.push({ reporterId: userId, reason: sanitizedReason, reportedAt: new Date() });
  await post.save();

  const response = await buildPostResponse(post, userId);
  return { post: response };
}

async function removePost(userId, userRole, postId) {
  const post = await Post.findById(postId);
  if (!post) throw httpError(404, { error: 'Post not found' });

  const isAuthor = post.authorId.toString() === userId;
  const isAdmin = ['admin-user', 'moderator-user'].includes(userRole);
  if (!isAuthor && !isAdmin) throw httpError(403, { error: 'Not authorized to remove this post' });

  if (post.mediaUrl) {
    const storageService = require('../../services/storageService');
    await storageService.deleteFile(post.mediaUrl);
  }

  post.removed = true;
  post.removedBy = userId;
  post.removedAt = new Date();
  post.mediaUrl = null;
  await post.save();

  return { success: true };
}

async function getPostComments(userId, userRole, postId) {
  const post = await Post.findById(postId);
  if (!post) return [];

  if (post.groupId) {
    const group = await Group.findById(post.groupId).lean();
    if (!canViewGroupPost(post, group, userId, userRole)) {
      throw httpError(403, { error: 'Not authorized to view comments for this post' });
    }
  }

  const comments = await Comment.find({ postId, removed: false, visible: true })
    .sort({ createdAt: 1 })
    .populate('authorId', 'name role avatarUrl')
    .lean();

  return comments.map((c) => ({
    ...c,
    id: c._id,
    author: c.authorId
      ? {
        id: c.authorId._id,
        name: c.authorId.name,
        role: c.authorId.role,
        avatarUrl: toPublicUrl(c.authorId.avatarUrl),
      }
      : null,
  }));
}

async function addPostComment(userId, userRole, postId, body) {
  const content = sanitizeInput(body.content || '');
  const parentCommentId = body.parentCommentId || null;

  if (!content) throw httpError(400, { error: 'Content is required' });

  const moderationResult = await moderationScan({
    text: content,
    userId,
    context: { type: 'comment', postId },
  });

  if (moderationResult.status === 'REJECT') {
    throw httpError(400, {
      error: 'content_rejected',
      message: 'This comment cannot be published. It violates our community guidelines.',
      flags: moderationResult.flags,
      reason: 'Comment rejected due to policy violations',
    });
  }
  if (moderationResult.status === 'QUARANTINE') {
    throw httpError(400, {
      error: 'content_quarantined',
      message: 'This comment cannot be published. It contains sensitive information or requires review.',
      flags: moderationResult.flags,
      reason: 'Comment requires moderator review before publication',
    });
  }
  if (moderationResult.status === 'SOFT_BLOCK') {
    throw httpError(400, {
      error: 'content_blocked',
      message: 'This comment cannot be published. Please revise and try again.',
      flags: moderationResult.flags,
      reason: 'Comment contains potentially problematic content',
    });
  }

  const post = await Post.findOne({ _id: postId, removed: false });
  if (!post) throw httpError(404, { error: 'Post not found' });

  if (post.groupId) {
    const group = await Group.findById(post.groupId).lean();
    if (!canViewGroupPost(post, group, userId, userRole)) {
      throw httpError(403, { error: 'Not authorized to comment on this post' });
    }
  }

  const now = new Date();
  const newComment = await Comment.create({
    _id: uuidv4(),
    postId,
    authorId: userId,
    content,
    parentCommentId,
    createdAt: now,
    removed: false,
    moderation: {
      status: moderationResult.status,
      scores: moderationResult.scores,
      flags: moderationResult.flags,
      detectedSpans: moderationResult.detectedSpans,
      scannedAt: moderationResult.timestamp,
    },
    visible: true,
  });

  processUserAction(userId, 'create_comment', { postId, commentId: newComment.id }).catch((err) =>
    console.error('Error processing gamification for comment creation:', err),
  );

  notifyPostComment(userId, post.authorId, post._id, newComment._id).catch((err) =>
    console.error('Error creating comment notification:', err),
  );

  const [postsCount, commentsCount] = await Promise.all([
    Post.countDocuments({ authorId: userId, removed: false }),
    Comment.countDocuments({ authorId: userId, removed: false }),
  ]);
  checkForBadges(userId, { postsCount, commentsCount, role: userRole }).catch((err) =>
    console.error('Badge check error:', err),
  );

  await newComment.populate('authorId', 'name role avatarUrl');
  return {
    comment: {
      ...newComment.toObject(),
      id: newComment._id,
      author: newComment.authorId
        ? {
          id: newComment.authorId._id,
          name: newComment.authorId.name,
          role: newComment.authorId.role,
          avatarUrl: toPublicUrl(newComment.authorId.avatarUrl),
        }
        : null,
    },
  };
}

async function getFeedStats(userId) {
  const smartFeedService = require('../../services/smartFeedService');
  const stats = await smartFeedService.getFeedStats(userId);

  return {
    feedType: stats.hasConnections ? 'personalized' : 'cold_start',
    connections: {
      followingCount: stats.followingCount,
      friendsCount: stats.friendsCount,
      groupsCount: stats.groupsCount,
      diseasePageFollowsCount: stats.diseasePageFollowsCount,
    },
    profile: {
      location: stats.userProfile?.location || null,
      disease: stats.userProfile?.disease || null,
      healthInterests: stats.userProfile?.healthInterests || [],
    },
    tips: stats.hasConnections
      ? []
      : [
        'Follow users to see their posts',
        'Join groups to connect with communities',
        'Follow disease pages for relevant content',
        'Complete your profile for better recommendations',
      ],
  };
}

async function getPostById(userId, userRole, postId) {
  const post = await Post.findOne({ _id: postId, removed: false });
  if (!post) throw httpError(404, { error: 'Post not found' });

  if (post.groupId) {
    const group = await Group.findById(post.groupId).lean();
    if (!canViewGroupPost(post, group, userId, userRole)) {
      throw httpError(403, { error: 'Not authorized to view this post' });
    }
  }

  const response = await buildPostResponse(post, userId);
  return { post: response };
}

async function updatePost(userId, postId, body) {
  const post = await Post.findById(postId);
  if (!post) throw httpError(404, { error: 'Post not found' });
  if (post.authorId.toString() !== userId) throw httpError(403, { error: 'Not authorized' });
  if (body.content === undefined) throw httpError(400, { error: 'Content is required' });

  const content = body.content;

  if (!body.userConfirmedModeration && content.trim()) {
    const moderationResult = await moderationScan({
      text: content,
      userId,
      context: { type: 'post_edit', postId },
    });

    if (moderationResult.status === 'REJECT') {
      throw httpError(400, {
        error: 'content_moderated',
        message: 'Content violates community guidelines',
        flags: moderationResult.flags,
      });
    }
  }

  if (body.image) {
    const storageService = require('../../services/storageService');
    let base64 = body.image;
    let mime = 'image/png';
    const dataUrlMatch = String(body.image).match(/^data:(.+);base64,(.+)$/);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1];
      base64 = dataUrlMatch[2];
    }
    const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const filename = `${userId}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      throw httpError(400, { error: 'Server Limit Exceeded: File size must be under 5MB.' });
    }
    try {
      const uploaded = await storageService.upload({ buffer, contentType: mime, key: `posts/${filename}` });
      if (post.mediaUrl) await storageService.deleteFile(post.mediaUrl);
      post.mediaUrl = uploaded.url;
    } catch (err) {
      console.error('Failed to upload edited post image:', err);
    }
  } else if (body.removeImage) {
    if (post.mediaUrl) {
      const storageService = require('../../services/storageService');
      await storageService.deleteFile(post.mediaUrl);
    }
    post.mediaUrl = null;
  }

  post.content = sanitizeInput(content);
  post.updatedAt = new Date();
  await post.save();

  const enriched = await buildPostResponse(post, userId);
  return { post: enriched };
}

async function reviewPost(userId, userRole, postId, action) {
  if (!['approve', 'reject'].includes(action)) {
    throw httpError(400, { error: 'Action must be either "approve" or "reject"' });
  }
  if (!['admin-user', 'moderator-user'].includes(userRole)) {
    throw httpError(403, { error: 'Only moderators and admins can review posts' });
  }

  const post = await Post.findOne({ _id: postId });
  if (!post) throw httpError(404, { error: 'Post not found' });

  if (action === 'approve') {
    post.reported = false;
    post.moderation = {
      ...post.moderation,
      status: 'APPROVED',
      reviewedBy: userId,
      reviewedAt: new Date(),
    };
  } else {
    if (post.mediaUrl) {
      const storageService = require('../../services/storageService');
      await storageService.deleteFile(post.mediaUrl);
    }
    post.removed = true;
    post.removedBy = userId;
    post.removedAt = new Date();
    post.mediaUrl = null;
    post.moderation = {
      ...post.moderation,
      status: 'REJECTED',
      reviewedBy: userId,
      reviewedAt: new Date(),
    };
  }

  await post.save();
  return {
    success: true,
    message: action === 'approve' ? 'Post approved' : 'Post rejected and removed',
    action,
  };
}

async function getReportedPosts(userRole, query) {
  if (!['admin-user', 'moderator-user'].includes(userRole)) {
    throw httpError(403, { error: 'Access denied' });
  }

  const limit = Math.min(parseInt(query.limit) || 50, 100);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const dbQuery = { reported: true, removed: false };

  if (cursor) {
    dbQuery.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }

  const posts = await Post.find(dbQuery)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('authorId', 'name role avatarUrl')
    .populate('groupId', 'name')
    .lean();

  const hasMore = posts.length > limit;
  const trimmedPosts = hasMore ? posts.slice(0, limit) : posts;

  const batch = await buildPostResponsesBulk(trimmedPosts, null, userRole);

  const enrichedPosts = batch.map((item, index) => {
    const originalPost = trimmedPosts[index];
    return {
      ...item,
      post: {
        ...item.post,
        reports: originalPost.reports || [],
        diseasePageSlug: originalPost.diseasePageSlug,
      },
    };
  });

  const nextCursor =
    hasMore && trimmedPosts.length > 0
      ? encodeCursor(trimmedPosts[trimmedPosts.length - 1].createdAt, trimmedPosts[trimmedPosts.length - 1]._id)
      : null;

  return {
    posts: enrichedPosts.map((e) => e.post),
    nextCursor,
    hasMore,
  };
}

module.exports = {
  createPost,
  likePost,
  reportPost,
  removePost,
  getPostComments,
  addPostComment,
  getFeedStats,
  getPostById,
  updatePost,
  reviewPost,
  getReportedPosts,
};
