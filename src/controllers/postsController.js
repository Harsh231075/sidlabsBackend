const { v4: uuidv4 } = require('uuid');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const Group = require('../models/Group');
const ForumPost = require('../models/ForumPost');
const { sanitizeInput, analyzeTextForModeration } = require('../utils/moderation');
const { scan: moderationScan } = require('../services/moderationService');
const { checkForBadges } = require('../utils/badges');
const { notifyPostComment, notifyPostLike, notifyGroupPost } = require('../utils/notifications');
const { processUserAction } = require('../services/tokenService');

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function encodeCursor(createdAt, id) {
  // Use ISO timestamp + id to keep ordering stable.
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`, 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  try {
    const decoded = Buffer.from(String(cursor), 'base64').toString('utf8');
    const [iso, id] = decoded.split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Check if user can view a group post based on group privacy
 */
function canViewGroupPost(post, group, userId, userRole) {
  if (!post.groupId) return true;
  if (!group) return false; // If post has groupId but group not found/loaded
  if (group.privacy === 'public') return true;

  const isMember =
    group.members?.includes(userId) ||
    group.adminIds?.includes(userId) ||
    group.ownerId === userId;

  if (group.privacy === 'private' || group.privacy === 'hidden') {
    return isMember || userRole === 'admin-user';
  }
  return true;
}

/**
 * Build post response with enriched data (author, likes, comments, group)
 */
async function buildPostResponse(post, currentUserId) {
  // Ensure author is populated
  if (!post.authorId || !post.authorId.name) {
    await post.populate('authorId', 'name role avatarUrl');
  }

  const likeList = post.likes || [];
  const likedByCurrentUser = likeList.includes(currentUserId);
  const commentCount = await Comment.countDocuments({ postId: post._id, removed: false });

  let group = null;
  if (post.groupId) {
    // We could simple fetch the group or rely on population if we used it.
    // Let's fetch lean group for privacy check info
    const groupDoc = await Group.findById(post.groupId).select('name privacy members adminIds ownerId').lean();
    if (groupDoc) {
      group = {
        id: groupDoc._id,
        name: groupDoc.name,
        privacy: groupDoc.privacy,
        isMember: groupDoc.members?.includes(currentUserId)
      };
    }
  }

  return {
    ...post.toObject(),
    id: post._id,
    author: post.authorId ? {
      id: post.authorId._id,
      name: post.authorId.name,
      role: post.authorId.role,
      avatarUrl: post.authorId.avatarUrl
    } : null,
    likeCount: likeList.length,
    likedByCurrentUser,
    commentCount,
    group,
  };
}

async function buildPostResponsesBulk(posts, currentUserId, currentUserRole) {
  if (!posts.length) return [];

  const postIds = posts.map((p) => p._id);
  const groupIds = [...new Set(posts.map((p) => p.groupId).filter(Boolean))];

  const [commentCountsAgg, groups] = await Promise.all([
    Comment.aggregate([
      { $match: { postId: { $in: postIds }, removed: false } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]),
    groupIds.length
      ? Group.find({ _id: { $in: groupIds } }).select('name privacy members adminIds ownerId').lean()
      : Promise.resolve([]),
  ]);

  const commentCountByPostId = commentCountsAgg.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  const groupsMap = groups.reduce((acc, g) => {
    acc[g._id] = g;
    return acc;
  }, {});

  const visible = [];
  for (const post of posts) {
    if (post.groupId) {
      const group = groupsMap[post.groupId];
      if (!canViewGroupPost(post, group, currentUserId, currentUserRole)) continue;
    }

    const { __v, _id, authorId, likes = [], ...rest } = post;
    const authorObj = authorId && typeof authorId === 'object' ? authorId : null;
    const likeList = Array.isArray(likes) ? likes : [];

    const groupDoc = post.groupId ? groupsMap[post.groupId] : null;
    const isMember =
      !!groupDoc &&
      (groupDoc.members?.includes(currentUserId) ||
        groupDoc.adminIds?.includes(currentUserId) ||
        groupDoc.ownerId === currentUserId);

    visible.push({
      cursor: encodeCursor(post.createdAt, _id),
      post: {
        ...rest,
        id: _id,
        authorId: authorObj ? authorObj._id : authorId,
        author: authorObj
          ? { id: authorObj._id, name: authorObj.name, role: authorObj.role, avatarUrl: authorObj.avatarUrl }
          : null,
        likeCount: likeList.length,
        likedByCurrentUser: likeList.includes(currentUserId),
        commentCount: commentCountByPostId[_id] || 0,
        group: groupDoc
          ? {
            id: groupDoc._id,
            name: groupDoc.name,
            privacy: groupDoc.privacy,
            isMember,
          }
          : null,
      },
    });
  }

  return visible;
}

/**
 * Get all posts (optionally filtered by groupId)
 */
async function getPosts(req, res, next) {
  try {
    const groupId = req.query.groupId;
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;

    const baseQuery = { removed: false };
    if (groupId) baseQuery.groupId = groupId;

    const results = [];
    let scanCursor = cursor;
    let exhausted = false;

    // Privacy filtering can remove items; fetch in batches to still fill the page.
    const batchSize = Math.min(Math.max(limit * 3, 30), 200);

    while (results.length < limit + 1 && !exhausted) {
      const pageQuery = { ...baseQuery };
      if (scanCursor) {
        pageQuery.$or = [
          { createdAt: { $lt: scanCursor.createdAt } },
          { createdAt: scanCursor.createdAt, _id: { $lt: scanCursor.id } },
        ];
      }

      const posts = await Post.find(pageQuery)
        .sort({ createdAt: -1, _id: -1 })
        .limit(batchSize)
        .populate('authorId', 'name role avatarUrl')
        .lean();

      if (!posts.length) {
        exhausted = true;
        break;
      }

      scanCursor = { createdAt: new Date(posts[posts.length - 1].createdAt), id: posts[posts.length - 1]._id };

      const batch = await buildPostResponsesBulk(posts, req.user.id, req.user.role);
      for (const item of batch) {
        results.push(item);
        if (results.length >= limit + 1) break;
      }

      if (posts.length < batchSize) {
        exhausted = true;
      }
    }

    const hasMore = results.length > limit;
    const trimmed = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? trimmed[trimmed.length - 1]?.cursor : null;

    res.json({ posts: trimmed.map((r) => r.post), nextCursor });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new post
 */
async function createPost(req, res, next) {
  try {
    const content = sanitizeInput(req.body.content || '');
    let mediaUrl = (req.body.mediaUrl || '').trim();
    const image = req.body.image || null; // base64 or data URL
    const groupId = req.body.groupId || null;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Lightweight word-list moderation analysis (server-side)
    const analysis = analyzeTextForModeration(content);

    // If analysis requires alert (phi/spam/promo/bad words) and client did not confirm, return soft response
    const userConfirmed = !!req.body.userConfirmedModeration;

    if (analysis.alertRequired && !userConfirmed) {
      return res.status(409).json({
        error: 'moderation_confirmation_required',
        message: 'This post may contain PHI, spam, or promotional content. This post will be monitored. Are you sure you want to post?',
        analysis,
      });
    }

    // If user confirmed and analysis had alert, treat as pending review and flag for moderators
    const isPendingReview = analysis.alertRequired && userConfirmed;

    let targetGroup = null;
    if (groupId) {
      targetGroup = await Group.findById(groupId).lean();
      if (!targetGroup) {
        return res.status(404).json({ error: 'Group not found' });
      }
      const isMember =
        targetGroup.members?.includes(req.user.id) ||
        targetGroup.adminIds?.includes(req.user.id) ||
        targetGroup.ownerId === req.user.id;

      if (targetGroup.privacy !== 'public' && !isMember && req.user.role !== 'admin-user') {
        return res.status(403).json({ error: 'Not a member of this private group' });
      }
    }

    // If an inline image is provided, upload it
    if (image) {
      const storageService = require('../services/storageService');
      let base64 = image;
      let mime = 'image/png';
      const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
      if (dataUrlMatch) {
        mime = dataUrlMatch[1];
        base64 = dataUrlMatch[2];
      }
      const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const filename = `${req.user.id}-${Date.now()}.${ext}`;
      const buffer = Buffer.from(base64, 'base64');
      const folder = groupId ? 'group-posts' : 'posts';
      const uploaded = await storageService.upload({ buffer, contentType: mime, key: `${folder}/${filename}` });
      mediaUrl = uploaded.url;
    }

    const now = new Date();
    const newPost = await Post.create({
      _id: uuidv4(),
      authorId: req.user.id,
      content,
      mediaUrl,
      groupId,
      createdAt: now,
      updatedAt: now,
      likes: [],
      reported: isPendingReview ? true : false,
      reports: [],
      removed: false,
      // Moderation data (store analysis for human review if needed)
      moderation: {
        status: isPendingReview ? 'PENDING_REVIEW' : 'ALLOW',
        analysis,
        flaggedAt: isPendingReview ? now : null,
        flaggedBy: isPendingReview ? req.user.id : null,
      },
      visible: true,
    });

    // Award tokens and check for badges (fire and forget - don't block response)
    processUserAction(req.user.id, 'create_post', { postId: newPost._id, groupId })
      .catch((err) => {
        console.error('Error processing gamification for post creation:', err);
      });

    // Notify group members about new post (if it's in a group)
    if (groupId && targetGroup) {
      notifyGroupPost(groupId, newPost._id, req.user.id).catch((err) => {
        console.error('Error creating group post notifications:', err);
      });
    }

    // Check for badges
    const userPostsCount = await Post.countDocuments({ authorId: req.user.id, removed: false });
    // Also include forum posts? Original code filtered just `posts.json`. 
    // `tokenService` awards tokens for forum reply/post differently. 
    // `badges.js` counts checks `postsCount`. 
    // The previous implementation of `forumsController` passed filtered `posts.json` length too? No, it passed forum posts.
    // The `badges.js` logic is "Create X posts". It might mean global posts. 
    // Let's sum them up or just use Posts for now to be safe.

    const userCommentsCount = await Comment.countDocuments({ authorId: req.user.id, removed: false });

    await checkForBadges(req.user.id, {
      postsCount: userPostsCount,
      commentsCount: userCommentsCount,
      role: req.user.role,
    });

    const response = await buildPostResponse(newPost, req.user.id);
    res.status(201).json({ post: response });
  } catch (error) {
    next(error);
  }
}

/**
 * Like or unlike a post
 */
async function likePost(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const likeList = post.likes || [];
    const idx2 = likeList.indexOf(req.user.id);

    const wasLiked = idx2 >= 0;
    if (!wasLiked) {
      post.likes.push(req.user.id);
      // Notify post author if not self-like (only when liking, not unliking)
      if (post.authorId !== req.user.id) {
        notifyPostLike(req.user.id, post.authorId, post._id, true).catch((err) => {
          console.error('Error creating like notification:', err);
        });
      }
    } else {
      post.likes.splice(idx2, 1);
    }

    await post.save();

    const response = await buildPostResponse(post, req.user.id);
    res.json({ post: response });
  } catch (error) {
    next(error);
  }
}

/**
 * Report a post
 */
async function reportPost(req, res, next) {
  try {
    const reason = sanitizeInput(req.body.reason || 'Not specified');
    const post = await Post.findOne({ _id: req.params.id, removed: false });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Check group privacy
    if (post.groupId) {
      const group = await Group.findById(post.groupId).lean();
      if (!canViewGroupPost(post, group, req.user.id, req.user.role)) {
        return res.status(403).json({ error: 'Not authorized to report this post' });
      }
    }

    post.reported = true;
    post.reports = post.reports || [];
    post.reports.push({
      reporterId: req.user.id,
      reason,
      reportedAt: new Date(),
    });

    await post.save();

    // Response with enriched data
    const response = await buildPostResponse(post, req.user.id);
    res.json({ post: response });
  } catch (error) {
    next(error);
  }
}

/**
 * Remove a post (admin/moderator only)
 */
async function removePost(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    post.removed = true;
    post.removedBy = req.user.id;
    post.removedAt = new Date();

    await post.save();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Get comments for a post
 */
async function getPostComments(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      // Return empty if post not found? Or 404. Original code filtered comments by postID, so if post doesn't exist, returns empty.
      // But it checked `post && ...`
      // Let's return empty if not found, or error. 
      // Original code: `const post = posts.find(...) ... if (post && post.groupId ...)`
      // If post missing, it just returns filtered list (empty).
      return res.json([]);
    }

    if (post.groupId) {
      const group = await Group.findById(post.groupId).lean();
      if (!canViewGroupPost(post, group, req.user.id, req.user.role)) {
        return res.status(403).json({ error: 'Not authorized to view comments for this post' });
      }
    }

    // visible !== false checks for quarantined
    const comments = await Comment.find({ postId: req.params.id, removed: false, visible: true })
      .sort({ createdAt: 1 })
      .populate('authorId', 'name role avatarUrl')
      .lean();

    const response = comments.map(c => ({
      ...c,
      id: c._id,
      author: c.authorId ? { id: c.authorId._id, name: c.authorId.name, role: c.authorId.role, avatarUrl: c.authorId.avatarUrl } : null
    }));

    res.json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Add a comment to a post
 */
async function addPostComment(req, res, next) {
  try {
    const content = sanitizeInput(req.body.content || '');
    const parentCommentId = req.body.parentCommentId || null;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Run comprehensive moderation scan
    const moderationResult = await moderationScan({
      text: content,
      userId: req.user.id,
      context: { type: 'comment', postId: req.params.id },
    });

    // Block submission if content is risky (REJECT, QUARANTINE, or SOFT_BLOCK)
    if (moderationResult.status === 'REJECT') {
      return res.status(400).json({
        error: 'content_rejected',
        message: 'This comment cannot be published. It violates our community guidelines.',
        flags: moderationResult.flags,
        reason: 'Comment rejected due to policy violations',
      });
    }

    if (moderationResult.status === 'QUARANTINE') {
      return res.status(400).json({
        error: 'content_quarantined',
        message: 'This comment cannot be published. It contains sensitive information or requires review.',
        flags: moderationResult.flags,
        reason: 'Comment requires moderator review before publication',
      });
    }

    if (moderationResult.status === 'SOFT_BLOCK') {
      return res.status(400).json({
        error: 'content_blocked',
        message: 'This comment cannot be published. Please revise and try again.',
        flags: moderationResult.flags,
        reason: 'Comment contains potentially problematic content',
      });
    }

    const post = await Post.findOne({ _id: req.params.id, removed: false });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (post.groupId) {
      const group = await Group.findById(post.groupId).lean();
      if (!canViewGroupPost(post, group, req.user.id, req.user.role)) {
        return res.status(403).json({ error: 'Not authorized to comment on this post' });
      }
    }

    const now = new Date();
    const newComment = await Comment.create({
      _id: uuidv4(),
      postId: req.params.id,
      authorId: req.user.id,
      content,
      parentCommentId,
      createdAt: now,
      removed: false,
      // Moderation data (should always be ALLOW at this point since we block others)
      moderation: {
        status: moderationResult.status,
        scores: moderationResult.scores,
        flags: moderationResult.flags,
        detectedSpans: moderationResult.detectedSpans,
        scannedAt: moderationResult.timestamp,
      },
      visible: true, // All allowed comments are visible
    });

    // Award tokens and check for badges (fire and forget - don't block response)
    processUserAction(req.user.id, 'create_comment', { postId: req.params.id, commentId: newComment.id })
      .catch((err) => {
        console.error('Error processing gamification for comment creation:', err);
      });

    // Notify post author about comment
    notifyPostComment(req.user.id, post.authorId, post._id, newComment._id).catch((err) => {
      console.error('Error creating comment notification:', err);
    });

    const userPostsCount = await Post.countDocuments({ authorId: req.user.id, removed: false });
    const userCommentsCount = await Comment.countDocuments({ authorId: req.user.id, removed: false });

    await checkForBadges(req.user.id, {
      postsCount: userPostsCount,
      commentsCount: userCommentsCount,
      role: req.user.role,
    });

    // Populate author for response
    await newComment.populate('authorId', 'name role avatarUrl');

    res.status(201).json({
      comment: {
        ...newComment.toObject(),
        id: newComment._id,
        author: newComment.authorId ? {
          id: newComment.authorId._id,
          name: newComment.authorId.name,
          role: newComment.authorId.role,
          avatarUrl: newComment.authorId.avatarUrl
        } : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPosts,
  createPost,
  likePost,
  reportPost,
  removePost,
  getPostComments,
  addPostComment,
};

